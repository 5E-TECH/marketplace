import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom, timeout } from 'rxjs';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  CatalogOfferQuote,
  CatalogOfferSnapshot,
  CheckoutDeliveryDestination,
  DeliveryDisplayMode,
  LEAD_CATALOG_RPC,
  LeadAddressDto,
  LeadAddressResolution,
  LeadCardDto,
  LeadHistoryChangeDto,
  LeadHistoryEntryDto,
  LeadOutcome,
  LeadPriceDto,
  LeadRegionGroupDto,
  LeadStatus,
  OperatorLeadListItemDto,
  RmqClient,
  sendRpc,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import {
  Lead,
  LeadAttempt,
  LeadHistory,
  LeadItem,
  OfferContent,
} from './entities';
import { LEAD_RULES } from './lead-rules';
import { reminderHorizon } from './lead-schedule';
import { UserNamesClient } from './user-names.client';

const ADDRESS_FIELDS = [
  'region_soato',
  'district_soato',
  'address_line',
  'where_deliver',
];
const ADDRESS_CONFIRMED = 'address_confirmed_at';
const CHANGE_FIELD: Record<string, LeadHistoryChangeDto['field']> = {
  region_soato: 'region',
  district_soato: 'district',
  address_line: 'addressLine',
  where_deliver: 'whereDeliver',
};
/** Viloyat/tuman nomlarini kutish: javob bo‘lmasa tarixda SOATO kodi qoladi [taklif]. */
const GEO_TIMEOUT_MS = 1_500;
const PREVIOUS_LIMIT = 10;

/** Operatorga ko‘rinadigan raqam: «+998 90 *** ** 67» (EQ-02 javobiga qadar niqoblangan). */
export const maskPhone = (p: string) =>
  `+998 ${p.slice(4, 6)} *** ** ${p.slice(-2)}`;

/**
 * Lid kartasi (OPR-2, BE-13; mijoz tarixi BE-42): mahsulot, narx obyekti, suhbat skripti, manzil «formadan»,
 * urinishlar, tarix va shu raqamdagi oldingi lidlar. Variant chiqmaydi (LID-8).
 * Ismlar identity dan (BE-25); identity javob bermasa `#ID`.
 */
@Injectable()
export class LeadCardService {
  private readonly logger = new Logger(LeadCardService.name);

  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(LeadAttempt)
    private readonly attempts: Repository<LeadAttempt>,
    @InjectRepository(LeadHistory)
    private readonly history: Repository<LeadHistory>,
    @InjectRepository(OfferContent)
    private readonly contents: Repository<OfferContent>,
    private readonly catalog: CatalogOfferClient,
    @Inject(RmqClient.CATALOG) private readonly catalogClient: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Optional() private readonly names?: UserNamesClient,
  ) {}

  /** Operator faqat o‘zidagi (bron yoki rejalashtirilgan) lidni ko‘radi; aks holda 404. */
  async forOperator(operatorId: string, leadId: string): Promise<LeadCardDto> {
    const lead = await this.leads.findOne({
      where: { id: leadId, isDeleted: false },
    });
    if (
      !lead ||
      lead.operatorId !== operatorId ||
      ![LeadStatus.BOOKED, LeadStatus.CALLBACK].includes(lead.status)
    )
      throw new NotFoundException('Lid topilmadi yoki bu operatorda emas');
    return this.build(lead);
  }

  /** «Mening bronlarim va rejalashtirilgan qo‘ng‘iroqlar» (OPR-1). */
  async listMine(operatorId: string): Promise<OperatorLeadListItemDto[]> {
    const rows = await this.leads.find({
      where: {
        operatorId,
        status: In([LeadStatus.BOOKED, LeadStatus.CALLBACK]),
        isDeleted: false,
      },
      order: { status: 'ASC', nextAttemptAt: 'ASC', id: 'ASC' },
    });
    const offers = rows.length
      ? await this.catalog
          .list({ productIds: [...new Set(rows.map((r) => r.productId))] })
          .catch(() => [] as CatalogOfferSnapshot[])
      : [];
    const names = new Map(offers.map((o) => [o.productId, o.name]));
    // BE-25 (FE-08): har lidning oxirgi urinishi — «O‘ylab ko‘radi «…»» sababi ro‘yxatda
    const lastAttempts = rows.length
      ? ((await this.attempts.query(
          `SELECT DISTINCT ON (lead_id) lead_id::text AS "leadId", outcome, comment, created_at AS "at"
             FROM lead.lead_attempt WHERE lead_id = ANY($1::bigint[])
            ORDER BY lead_id, created_at DESC, id DESC`,
          [rows.map((r) => r.id)],
        )) as Array<{
          leadId: string;
          outcome: LeadOutcome;
          comment: string | null;
          at: Date;
        }>)
      : [];
    const last = new Map(lastAttempts.map((a) => [a.leadId, a]));
    const horizon = reminderHorizon(new Date());
    return rows.map((r) => {
      const callbackAt =
        r.status === LeadStatus.CALLBACK || r.bookedFromCallback
          ? r.nextAttemptAt
          : null;
      return {
        id: r.id,
        status: r.status,
        customerName: r.name,
        productName: names.get(r.productId) ?? '',
        bookedUntil: r.bookedUntil?.toISOString() ?? null,
        callbackAt: callbackAt?.toISOString() ?? null,
        reminderDue: !!callbackAt && callbackAt.getTime() <= horizon.getTime(),
        lastOutcome: last.get(r.id)?.outcome ?? null,
        lastComment: last.get(r.id)?.comment ?? null,
        lastAttemptAt: last.has(r.id)
          ? new Date(last.get(r.id)!.at).toISOString()
          : null,
      };
    });
  }

  async build(lead: Lead): Promise<LeadCardDto> {
    const [
      offer,
      content,
      attempts,
      history,
      previous,
      address,
      rejections,
      lines,
    ] = await Promise.all([
      this.catalog.get(lead.productId).catch(() => null),
      this.contents.findOne({
        where: { productId: lead.productId, isDeleted: false },
      }),
      this.attempts.find({
        where: { leadId: lead.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.history.find({
        where: { leadId: lead.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.previousLeads(lead),
      this.address(lead),
      this.leads.count({
        where: {
          phoneE164: lead.phoneE164,
          status: LeadStatus.REJECTED,
          mergedIntoId: IsNull(),
          isDeleted: false,
        },
      }),
      this.leads.manager.getRepository(LeadItem).find({
        where: { leadId: lead.id },
        order: { position: 'ASC', id: 'ASC' },
      }),
    ]);
    // birinchi qator soni — lidning o‘z soni (operator o‘zgartirishi mumkin)
    const items = lines.map((line, index) => {
      const quantity = index === 0 ? lead.quantity : line.quantity;
      const unitPrice = Number(line.salePrice);
      return {
        productId: String(line.productId),
        name: line.productName,
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity,
      };
    });
    const nameOf = this.names
      ? await this.names.resolve([
          ...attempts.map((a) => a.operatorId),
          ...history.map((h) => h.actorId),
        ])
      : (id: string) => `#${id}`;
    const actorName = (id: string | null) => (id ? nameOf(id) : 'Tizim');
    return {
      id: lead.id,
      status: lead.status,
      source: lead.source,
      customerName: lead.name,
      phoneMasked: maskPhone(lead.phoneE164),
      product: {
        id: lead.productId,
        name: offer?.name ?? '',
        salePrice: Number(lead.salePrice),
      },
      quantity: lead.quantity,
      items: items.length > 1 ? items : [],
      confirmMode: lead.confirmMode ?? 'CALL',
      address,
      price: !lead.whereDeliver
        ? null
        : items.length > 1
          ? await this.parcelPrice(items, lead.whereDeliver)
          : await this.price(lead, offer, lead.quantity, lead.whereDeliver),
      rejectReason: lead.rejectReason,
      callScript: content?.callScript ?? null,
      stockShortage: !!lead.stockShortageAt,
      blacklistRejections:
        rejections >= LEAD_RULES.blacklistRejections ? rejections : null,
      attemptsCount: lead.attempts,
      bookedUntil: lead.bookedUntil?.toISOString() ?? null,
      nextAttemptAt: lead.nextAttemptAt?.toISOString() ?? null,
      orderId: lead.orderId,
      attempts: attempts.map((a) => ({
        at: a.createdAt,
        operatorName: actorName(a.operatorId),
        outcome: a.outcome,
        comment: a.comment,
      })),
      history: await this.historyView(history, actorName),
      previousLeads: previous,
      createdAt: lead.createdAt,
    };
  }

  /**
   * Tarix. BE-25 (FE-09 TC5): bitta manzil saqlash (tuzatilgan maydonlar va tasdiq — bitta tranzaksiya, bir xil vaqt va
   * odam) bitta yozuv, eski va yangi qiymat bilan; o‘zgarishsiz tasdiq — `changes: []`.
   */
  private async historyView(
    history: LeadHistory[],
    actorName: (id: string | null) => string,
  ): Promise<LeadHistoryEntryDto[]> {
    const isAddress = (h: LeadHistory) =>
      h.field !== null &&
      (h.field in CHANGE_FIELD || h.field === ADDRESS_CONFIRMED);
    const keyOf = (h: LeadHistory) =>
      `${h.actorId ?? ''}|${new Date(h.createdAt).getTime()}`;
    const geo = history.some(
      (h) => h.field === 'region_soato' || h.field === 'district_soato',
    )
      ? await this.geoNames()
      : new Map<string, string>();
    const text = (h: LeadHistory, value: Record<string, unknown> | null) => {
      const raw = value?.value;
      if (typeof raw !== 'string' || !raw) return null;
      return h.field === 'region_soato' || h.field === 'district_soato'
        ? (geo.get(raw) ?? raw)
        : raw;
    };
    const saves = new Map<string, LeadHistoryEntryDto>();
    const view: LeadHistoryEntryDto[] = [];
    for (const h of history) {
      const base = {
        at: h.createdAt,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actor: actorName(h.actorId),
        note: h.note,
      };
      if (!isAddress(h)) {
        view.push({ ...base, changes: null });
        continue;
      }
      let entry = saves.get(keyOf(h));
      if (!entry) {
        entry = { ...base, changes: [] };
        saves.set(keyOf(h), entry);
        view.push(entry);
      }
      const field = CHANGE_FIELD[h.field!];
      if (!field) continue;
      entry.note = h.note; // «Operator manzilni tuzatdi» — tasdiq izohidan ustun
      entry.changes!.push({
        field,
        from: text(h, h.oldValue),
        to: text(h, h.newValue),
      });
    }
    return view;
  }

  /** Viloyat va tuman nomlari SOATO bo‘yicha; geo keshi javob bermasa — bo‘sh (kod ko‘rsatiladi). */
  private async geoNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      const tree = await firstValueFrom(
        this.integration
          .send<LeadRegionGroupDto[]>(
            { cmd: 'integration.geo.region-tree' },
            {},
          )
          .pipe(timeout(GEO_TIMEOUT_MS)),
      );
      for (const region of Array.isArray(tree) ? tree : []) {
        names.set(region.satoCode, region.name);
        for (const district of region.districts)
          names.set(district.satoCode, district.name);
      }
    } catch (error) {
      this.logger.warn(
        `Lid tarixi: viloyat/tuman nomlari olinmadi — ${(error as Error).message}`,
      );
    }
    return names;
  }

  /** Narx obyekti (FE-09): yetkazish og‘irlikka qarab katalogdan (BE-09); bitta dona — sahifadagi ko‘rinadigan yetkazish. */
  async price(
    lead: Pick<Lead, 'productId' | 'salePrice'>,
    offer: CatalogOfferSnapshot | null,
    quantity: number,
    whereDeliver: CheckoutDeliveryDestination,
  ): Promise<LeadPriceDto | null> {
    const unitPrice = Number(lead.salePrice);
    let deliveryFee: number | null = null;
    let quote: CatalogOfferQuote | null = null;
    try {
      quote = await sendRpc<CatalogOfferQuote>(
        this.catalogClient,
        { cmd: LEAD_CATALOG_RPC.OFFER_QUOTE },
        { productId: lead.productId, quantity, whereDeliver },
      );
      deliveryFee = quote.deliveryFee;
    } catch {
      if (offer && quantity === 1)
        deliveryFee =
          whereDeliver === CheckoutDeliveryDestination.CENTER
            ? offer.centerDeliveryFee
            : offer.addressDeliveryFee;
    }
    if (deliveryFee === null) return null;
    const subtotal = unitPrice * quantity;
    return {
      unitPrice,
      quantity,
      subtotal,
      whereDeliver,
      deliveryFee,
      totalAmount: subtotal + deliveryFee,
      // BE-25 (FE-09): hisob izohi — katalogdan (yo‘q bo‘lsa null)
      deliveryMode: quote?.deliveryMode ?? null,
      weightGrams: quote?.weightGrams ?? null,
      deliveryOptions: quote?.deliveryOptions ?? null,
      deliveryFormula: quote?.deliveryFormula ?? null,
    };
  }

  /** BE-34: ko‘p tovarli sayt lidi — butun posilka (buyurtma bilan bir xil hisob, `catalog.order.snapshot-many`). */
  async parcelPrice(
    items: Array<{ productId: string; quantity: number; unitPrice: number }>,
    whereDeliver: CheckoutDeliveryDestination,
  ): Promise<LeadPriceDto | null> {
    let deliveryFee: number | null = null;
    let deliveryMode: DeliveryDisplayMode | null = null;
    let weightGrams: number | null = null;
    try {
      const snapshot = await this.catalog.orderSnapshotMany(
        items.map(({ productId, quantity }) => ({ productId, quantity })),
        whereDeliver,
      );
      deliveryFee = snapshot?.delivery?.shown ?? null;
      deliveryMode =
        (snapshot?.delivery?.mode as DeliveryDisplayMode | undefined) ?? null;
      const lines = snapshot?.items ?? [];
      if (lines.length === items.length && lines.every(Boolean))
        weightGrams = lines.reduce(
          (sum, line, index) => sum + line!.weightGrams * items[index].quantity,
          0,
        );
    } catch {
      deliveryFee = null;
    }
    if (deliveryFee === null) return null;
    const subtotal = items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    return {
      unitPrice: items[0].unitPrice,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal,
      whereDeliver,
      deliveryFee,
      totalAmount: subtotal + deliveryFee,
      deliveryMode,
      weightGrams,
      deliveryOptions: null,
      deliveryFormula: null,
    };
  }

  /** POST /operator/leads/:id/quote: miqdor yoki yetkazish turi o‘zgarganda (FE-09 TC2, TC3). Bo‘sh — hisoblab bo‘lmadi. */
  async priceFor(
    productId: string,
    salePrice: number,
    quantity: number,
    whereDeliver: CheckoutDeliveryDestination,
  ): Promise<LeadPriceDto | null> {
    const offer = await this.catalog.get(productId).catch(() => null);
    return this.price(
      { productId, salePrice: String(salePrice) },
      offer,
      quantity,
      whereDeliver,
    );
  }

  private async address(lead: Lead): Promise<LeadAddressDto | null> {
    if (
      !lead.regionSoato ||
      !lead.districtSoato ||
      !lead.addressLine ||
      !lead.whereDeliver
    )
      return null;
    let names = {
      regionName: lead.regionSoato,
      districtName: lead.districtSoato,
    };
    try {
      const r = await sendRpc<LeadAddressResolution>(
        this.integration,
        { cmd: 'integration.geo.resolve-address' },
        { regionSoato: lead.regionSoato, districtSoato: lead.districtSoato },
      );
      if (r.ok)
        names = { regionName: r.regionName, districtName: r.districtName };
    } catch {
      // Geo kesh ishlamasa ham karta ochiladi: nom o‘rnida SOATO kodi.
    }
    const edits = await this.history.count({
      where: {
        leadId: lead.id,
        field: In(ADDRESS_FIELDS),
        actorId: Not(IsNull()),
      },
    });
    return {
      regionSoato: lead.regionSoato,
      districtSoato: lead.districtSoato,
      addressLine: lead.addressLine,
      whereDeliver: lead.whereDeliver,
      confirmedAt: lead.addressConfirmedAt?.toISOString() ?? null,
      editedByOperator: edits > 0,
      ...names,
    };
  }

  private async previousLeads(
    lead: Lead,
  ): Promise<LeadCardDto['previousLeads']> {
    const rows = await this.leads.find({
      where: {
        phoneE164: lead.phoneE164,
        id: Not(lead.id),
        mergedIntoId: IsNull(),
        isDeleted: false,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: PREVIOUS_LIMIT,
    });
    if (!rows.length) return [];
    const offers = await this.catalog
      .list({ productIds: [...new Set(rows.map((r) => r.productId))] })
      .catch(() => [] as CatalogOfferSnapshot[]);
    const names = new Map(offers.map((o) => [o.productId, o.name]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      productName: names.get(r.productId) ?? '',
      status: r.status,
      orderId: r.orderId,
      orderStatus: null,
      rejectReason: r.rejectReason,
    }));
  }
}
