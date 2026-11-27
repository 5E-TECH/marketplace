import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CatalogOfferSnapshot,
  LeadCardDto,
  LeadSource,
  LeadStatus,
  LeadUpsellDto,
  LeadUpsellOfferDto,
  LeadUpsellWindowDto,
  MAX_LEAD_LINES,
} from '@app/common';
import { Lead, LeadHistory, LeadItem } from './entities';
import { CatalogOfferClient } from './catalog-offer.client';
import { LeadCardService } from './lead-card.service';
import { tashkentParts } from './lead-schedule';

/** Lid tarixidagi belgilar (`lead_history.field`). */
export const UPSELL_ADDED = 'upsell_item';
export const UPSELL_REMOVED = 'upsell_item_removed';
export const UPSELL_DECLINED = 'upsell_declined';

/** 12-qoida oynasi: `UPSELL_WINDOW=09:00-18:00` (Toshkent). Bo‘sh — qoida yoqilmagan; noto‘g‘ri yozilgan — yopiq. */
export interface UpsellWindow {
  from: number;
  to: number;
  label: { from: string; to: string };
  invalid?: boolean;
}

export function parseUpsellWindow(
  raw: string | undefined,
): UpsellWindow | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(
    value,
  );
  if (
    !m ||
    Number(m[1]) * 60 + Number(m[2]) >= Number(m[3]) * 60 + Number(m[4])
  )
    return { from: 0, to: 0, label: { from: '—', to: '—' }, invalid: true };
  return {
    from: Number(m[1]) * 60 + Number(m[2]),
    to: Number(m[3]) * 60 + Number(m[4]),
    label: { from: `${m[1]}:${m[2]}`, to: `${m[3]}:${m[4]}` },
  };
}

/** Oyna ichidami: [from, to) — 18:00 ning o‘zi tashqarida («faqat 09:00–18:00»). */
export function isInsideWindow(window: UpsellWindow, at: Date): boolean {
  if (window.invalid) return false;
  const { hour, minute } = tashkentParts(at);
  const now = hour * 60 + minute;
  return now >= window.from && now < window.to;
}

const money = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * BE-45 (OPR-4): operator tasdiqlash qo‘ng‘irog‘ida lidga qo‘shimcha tovar qo‘shadi.
 * - Narx — tovarning tasdiqlangan narxi (BE-09), ustamasiz; mijoz narxni yubormaydi (TC3).
 * - Qoldig‘i yetmasa — 400 (TC2); qoldiq noma’lum (ombor javob bermadi) — 503 [taklif].
 * - 12-qoida yoqilgan bo‘lsa — oynadan tashqarida 400 (TC4); qoida «Taklif — tasdiqlash kerak», sukutda o‘chiq.
 * - Tasdiqlanganda `lead.confirmed` hamma qatorlar bilan ketadi, qo‘shimchalari `upsell` (TC1; BE-34 dagi tartib).
 * - Lid tovarisiz lidda (sotuvchi sahifasi, API) birinchi qo‘shishda 0-qator lid tovaridan yaratiladi;
 *   oxirgi qo‘shimcha olib tashlansa — o‘chiriladi (lid avvalgi bitta tovarli shaklga qaytadi).
 */
@Injectable()
export class LeadUpsellService {
  private readonly logger = new Logger(LeadUpsellService.name);

  constructor(
    private readonly db: DataSource,
    private readonly catalog: CatalogOfferClient,
    private readonly cards: LeadCardService,
  ) {}

  window(): UpsellWindow | null {
    const window = parseUpsellWindow(process.env.UPSELL_WINDOW);
    if (window?.invalid)
      this.logger.error(
        `UPSELL_WINDOW noto‘g‘ri («HH:MM-HH:MM» kerak) — qo‘shimcha taklif yopiq`,
      );
    return window;
  }

  async get(operatorId: string, leadId: string): Promise<LeadUpsellDto> {
    const card = await this.cards.forOperator(operatorId, leadId);
    const lead = await this.db
      .getRepository(Lead)
      .findOneByOrFail({ id: leadId });
    const items = await this.items(this.db.manager, leadId);
    const main = await this.catalog.get(lead.productId).catch(() => null);
    const pairId = main?.upsellProductId ?? null;
    let pair: LeadUpsellOfferDto | null = null;
    if (pairId) {
      const offer = await this.catalog.get(pairId).catch(() => undefined);
      if (offer !== undefined)
        pair = offer
          ? this.offerView(offer, [
              lead.productId,
              ...items.map((i) => String(i.productId)),
            ])
          : null;
    }
    const window = this.window();
    const [declined] = await this.db.getRepository(LeadHistory).find({
      where: { leadId, field: UPSELL_DECLINED },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 1,
    });
    return {
      pair,
      window: window ? this.windowView(window, new Date()) : null,
      lines: card.items
        .filter((item) => item.upsell)
        .map(({ itemId, productId, name, quantity, unitPrice, lineTotal }) => ({
          itemId,
          productId,
          name,
          quantity,
          unitPrice,
          lineTotal,
        })),
      declinedAt: declined ? new Date(declined.createdAt).toISOString() : null,
    };
  }

  async add(
    operatorId: string,
    leadId: string,
    productId: string,
    quantity: number,
  ): Promise<LeadCardDto> {
    const now = new Date();
    this.assertWindow(now);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000)
      throw new BadRequestException('Soni 1 dan 1000 gacha bo‘lishi kerak');
    // egalik — katalogga so‘rovdan oldin (begona lid uchun katalog chaqirilmaydi)
    const lead = await this.ownedBooked(this.db.manager, operatorId, leadId);
    if (String(lead.productId) === String(productId))
      throw new ConflictException(
        'Bu tovar lidda bor — sonini buyurtma formasida o‘zgartiring',
      );
    const offer = await this.fetch(productId);
    if (!offer) throw new NotFoundException('Mahsulot topilmadi');
    if (offer.withdrawn || !offer.cpaAvailable)
      throw new BadRequestException(
        'Bu tovar sotuvda emas — qo‘shib bo‘lmaydi',
      );
    if (offer.approvedPrice == null)
      throw new BadRequestException(
        'Tovar narxi tasdiqlanmagan — qo‘shib bo‘lmaydi',
      );
    if (offer.stock === null)
      throw new ServiceUnavailableException(
        'Qoldiq tekshirilmadi (ombor javob bermadi) — keyinroq urinib ko‘ring',
      );
    if (offer.stock < quantity)
      throw new BadRequestException(
        offer.stock > 0
          ? `Qoldiq yetarli emas: omborda ${offer.stock} dona`
          : 'Qoldiq tugagan — taklif qilinmaydi',
      );
    const mainName = await this.catalog
      .get(lead.productId)
      .then((main) => main?.name ?? null)
      .catch(() => null);

    try {
      await this.db.transaction(async (manager) => {
        const locked = await this.ownedBooked(
          manager,
          operatorId,
          leadId,
          true,
        );
        const repo = manager.getRepository(LeadItem);
        const items = await this.items(manager, leadId);
        if (items.some((item) => String(item.productId) === String(productId)))
          throw new ConflictException('Bu tovar lidda allaqachon bor');
        if (Math.max(items.length, 1) + 1 > MAX_LEAD_LINES)
          throw new BadRequestException(
            `Bitta buyurtmada ${MAX_LEAD_LINES} tadan ko‘p tovar bo‘lmaydi`,
          );
        if (!items.length)
          await repo.save(
            repo.create({
              leadId,
              position: 0,
              productId: locked.productId,
              productName: (mainName ?? `#${locked.productId}`).slice(0, 255),
              quantity: locked.quantity,
              salePrice: String(locked.salePrice),
              isUpsell: false,
              addedBy: null,
              addedAt: null,
            }),
          );
        const position = items.length
          ? Math.max(...items.map((item) => item.position)) + 1
          : 1;
        const price = offer.approvedPrice!;
        await repo.save(
          repo.create({
            leadId,
            position,
            productId: String(productId),
            productName: offer.name.slice(0, 255),
            quantity,
            salePrice: String(price),
            isUpsell: true,
            addedBy: operatorId,
            addedAt: now,
          }),
        );
        await this.note(
          manager,
          locked,
          operatorId,
          UPSELL_ADDED,
          `Qo‘shimcha tovar qo‘shildi: ${offer.name} × ${quantity}, ${money(price)} so‘m`,
          { productId: String(productId), quantity, price },
        );
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505')
        throw new ConflictException('Bu tovar lidda allaqachon bor');
      throw error;
    }
    return this.cards.forOperator(operatorId, leadId);
  }

  async remove(
    operatorId: string,
    leadId: string,
    itemId: string,
  ): Promise<LeadCardDto> {
    await this.db.transaction(async (manager) => {
      const lead = await this.ownedBooked(manager, operatorId, leadId, true);
      const repo = manager.getRepository(LeadItem);
      const item = await repo.findOne({ where: { id: itemId, leadId } });
      if (!item) throw new NotFoundException('Qator topilmadi');
      if (!item.isUpsell)
        throw new BadRequestException(
          'Bu qator qo‘shimcha tovar emas — olib tashlanmaydi',
        );
      await repo.delete({ id: item.id });
      const left = await this.items(manager, leadId);
      // saytdan bo‘lmagan lid: qo‘shimcha qolmasa — 0-qator ham (lid bitta tovarli shaklga qaytadi)
      if (lead.source !== LeadSource.SITE && !left.some((i) => i.isUpsell))
        await repo.delete({ leadId });
      await this.note(
        manager,
        lead,
        operatorId,
        UPSELL_REMOVED,
        `Qo‘shimcha tovar olib tashlandi: ${item.productName} × ${item.quantity}`,
        { productId: String(item.productId), quantity: item.quantity },
      );
    });
    return this.cards.forOperator(operatorId, leadId);
  }

  async decline(operatorId: string, leadId: string): Promise<LeadUpsellDto> {
    await this.db.transaction(async (manager) => {
      const lead = await this.ownedBooked(manager, operatorId, leadId, true);
      await this.note(
        manager,
        lead,
        operatorId,
        UPSELL_DECLINED,
        'Qo‘shimcha taklif: mijoz olmadi',
        null,
      );
    });
    return this.get(operatorId, leadId);
  }

  /**
   * «Tasdiqlandi» dan oldin: qo‘shimcha tovar narxi hali tasdiqlangan narxga tengmi (narx qarori o‘zgargan bo‘lishi
   * mumkin). O‘zgargan bo‘lsa — qator yangi narx bilan yangilanadi va 409: operator mijozga yangi summani aytadi.
   * Katalog javob bermasa — tekshiruv checkout’da (narx teng bo‘lmasa buyurtma PRICE_CHANGED bilan yaratilmaydi).
   */
  async refreshPrices(operatorId: string, leadId: string): Promise<void> {
    // begona yoki bronda bo‘lmagan lid — tekshiruv yo‘q (natija o‘zi 404 beradi)
    const lead = await this.db
      .getRepository(Lead)
      .findOne({ where: { id: leadId, isDeleted: false } });
    if (
      !lead ||
      lead.status !== LeadStatus.BOOKED ||
      lead.operatorId !== operatorId
    )
      return;
    const repo = this.db.getRepository(LeadItem);
    const upsells = await repo.find({ where: { leadId, isUpsell: true } });
    const changed: string[] = [];
    for (const item of upsells) {
      const offer = await this.catalog
        .get(String(item.productId))
        .catch(() => undefined);
      if (!offer || offer.approvedPrice == null) continue;
      if (offer.approvedPrice !== Number(item.salePrice)) {
        await repo.update(
          { id: item.id },
          { salePrice: String(offer.approvedPrice) },
        );
        changed.push(
          `${item.productName}: ${money(Number(item.salePrice))} → ${money(offer.approvedPrice)} so‘m`,
        );
      }
    }
    if (changed.length)
      throw new ConflictException(
        `Qo‘shimcha tovar narxi o‘zgardi (${changed.join('; ')}). Mijozga yangi summani ayting va qayta tasdiqlang`,
      );
  }

  private assertWindow(now: Date): void {
    const window = this.window();
    if (!window || isInsideWindow(window, now)) return;
    const { hour, minute } = tashkentParts(now);
    const pad = (n: number) => String(n).padStart(2, '0');
    throw new BadRequestException(
      window.invalid
        ? 'Qo‘shimcha taklif vaqti noto‘g‘ri sozlangan — qo‘shib bo‘lmaydi'
        : `Qo‘shimcha taklif faqat ${window.label.from}–${window.label.to} (12-qoida); hozir ${pad(hour)}:${pad(minute)}`,
    );
  }

  private windowView(window: UpsellWindow, now: Date): LeadUpsellWindowDto {
    return {
      from: window.label.from,
      to: window.label.to,
      open: isInsideWindow(window, now),
    };
  }

  private offerView(
    offer: CatalogOfferSnapshot,
    inLead: string[],
  ): LeadUpsellOfferDto {
    const reason: LeadUpsellOfferDto['unavailableReason'] = inLead.includes(
      String(offer.productId),
    )
      ? 'IN_LEAD'
      : offer.withdrawn || !offer.cpaAvailable
        ? 'UNAVAILABLE'
        : offer.approvedPrice == null
          ? 'NO_PRICE'
          : offer.stock !== null && offer.stock <= 0
            ? 'OUT_OF_STOCK'
            : null;
    return {
      productId: String(offer.productId),
      name: offer.name,
      price: offer.approvedPrice,
      stock: offer.stock,
      weightGrams: offer.weightGrams,
      image: offer.images[0] ?? null,
      unavailableReason: reason,
    };
  }

  private async fetch(productId: string): Promise<CatalogOfferSnapshot | null> {
    try {
      return await this.catalog.get(String(productId));
    } catch (error) {
      this.logger.warn(`Katalog javob bermadi: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'Katalog javob bermadi — qo‘shilmadi',
      );
    }
  }

  private items(manager: EntityManager, leadId: string): Promise<LeadItem[]> {
    return manager.getRepository(LeadItem).find({
      where: { leadId },
      order: { position: 'ASC', id: 'ASC' },
    });
  }

  /** Qo‘shish va olib tashlash — faqat bronlagan operator, faol suhbatda (BOOKED; natija kiritilgach yopiq). */
  private async ownedBooked(
    manager: EntityManager,
    operatorId: string,
    leadId: string,
    lock = false,
  ): Promise<Lead> {
    const lead = await manager.getRepository(Lead).findOne({
      where: { id: leadId, isDeleted: false },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (
      !lead ||
      lead.status !== LeadStatus.BOOKED ||
      lead.operatorId !== operatorId
    )
      throw new NotFoundException('Lid topilmadi yoki bu operatorda emas');
    return lead;
  }

  private async note(
    manager: EntityManager,
    lead: Lead,
    actorId: string,
    field: string,
    note: string,
    value: Record<string, unknown> | null,
  ): Promise<void> {
    const repo = manager.getRepository(LeadHistory);
    await repo.save(
      repo.create({
        leadId: lead.id,
        fromStatus: lead.status,
        toStatus: lead.status,
        actorId,
        field,
        oldValue: null,
        newValue: value,
        note,
      }),
    );
  }
}
