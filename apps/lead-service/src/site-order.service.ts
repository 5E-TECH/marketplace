import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, MoreThanOrEqual } from 'typeorm';
import {
  CatalogOfferSnapshot,
  isLeadBigintId,
  LEAD_EVENTS,
  LeadConfirmedVia,
  LeadErrorCode,
  LeadReviewReason,
  LeadSource,
  LeadStatus,
  OutboxEvent,
  SITE_ORDER_MAX_LINES,
  SiteConfirmMode,
  SiteConfirmSmsEvent,
  SiteOrderConfirmedDto,
  SiteOrderCreatedDto,
  SiteOrderDto,
  SiteOrderLine,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead, LeadHistory, LeadItem } from './entities';
import { LeadAddressService } from './lead-address.service';
import { enqueueLeadConfirmed } from './lead-confirmed.event';
import {
  HONEYPOT_LEAD_ID,
  LeadIntakeService,
  LOCK_SPACE_IP,
  LOCK_SPACE_LEAD,
} from './lead-intake.service';
import {
  contactDeadline,
  duplicateDecision,
  ipWindowStart,
  isHoneypotFilled,
  LEAD_RULES,
  phoneOperatorAllowed,
} from './lead-rules';

/**
 * SMS havola amal qiladigan vaqt, daqiqa: shu vaqt ichida bosilmasa lid operator navbatiga o‘tadi (TC7). Muddat —
 * ega qarori (karta) [taklif].
 */
export const SMS_CONFIRM_WINDOW_MIN = 30;
/** SMS dagi tovarlar ro‘yxati uzunligi (bitta SMS sig‘imi uchun qisqartiriladi) [taklif]. */
const SMS_ITEMS_MAX_CHARS = 80;
/** Bitta raqamga SMS yuborish qulfi (bir vaqtda bitta amaldagi havola). */
const LOCK_SPACE_SITE_SMS = 2103;

/** Saytda sotiladi: sotuvdan olinmagan, sotuvchilarga ochiq, narxi tasdiqlangan (katalog `isOnSite` bilan bir xil). */
function onSite(
  offer: CatalogOfferSnapshot | undefined,
): offer is CatalogOfferSnapshot & { approvedPrice: number } {
  return (
    !!offer &&
    !offer.withdrawn &&
    offer.cpaAvailable &&
    offer.approvedPrice !== null
  );
}

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const money = (value: number) =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * BE-34: asosiy saytdan mehmon buyurtmasi (TZ SAYT-1, SAYT-2; ega qarori 2026-11-10).
 * Savatdagi hamma tovar bitta lidga (source = SITE, sahifa, variant va sotuvchi yo‘q; sotuvchi haqi platformaga).
 * Narx — katalogdagi tasdiqlangan narx. Tasdiqlash usulini mijoz tanlaydi: CALL — umumiy operator navbati; SMS —
 * havola bosilgach buyurtma operatorsiz. Qora ro‘yxat, dublikat (LID-4) yoki tekshiruvga tushgan arizada SMS yo‘q.
 */
@Injectable()
export class SiteOrderService {
  private readonly logger = new Logger(SiteOrderService.name);

  constructor(
    private readonly db: DataSource,
    private readonly catalog: CatalogOfferClient,
    private readonly address: LeadAddressService,
    private readonly intake: LeadIntakeService,
    private readonly config: ConfigService,
  ) {}

  async create(input: {
    order: SiteOrderDto;
    lines: SiteOrderLine[];
    ip: string | null;
    userAgent: string | null;
  }): Promise<SiteOrderCreatedDto> {
    const dto = input.order;
    if (isHoneypotFilled(dto.website))
      return { leadId: HONEYPOT_LEAD_ID, confirmMode: SiteConfirmMode.CALL };
    if (!phoneOperatorAllowed(dto.phone, this.operatorCodes()))
      throw new BadRequestException({
        message: ['phone O‘zbekiston operator kodi bilan bo‘lishi kerak'],
      });
    const lines = this.normalize(input.lines);

    const offers = new Map(
      (
        await this.catalog.list({
          productIds: lines.map((line) => line.productId),
        })
      ).map((offer) => [String(offer.productId), offer]),
    );
    const priced = lines.map((line) => {
      const offer = offers.get(line.productId);
      if (!onSite(offer))
        throw new ConflictException({
          message: `Mahsulot saytda sotuvda emas: ${offer?.name ?? line.productId}`,
          errorCode: LeadErrorCode.SITE_PRODUCT_UNAVAILABLE,
        });
      return { ...line, name: offer.name, salePrice: offer.approvedPrice };
    });

    // Geo va katalog so‘rovlari tranzaksiyadan oldin (RPC paytida qulf ushlanmaydi)
    const address = await this.address.resolve(dto);
    const confirmUrl = this.confirmUrl();
    let delivery: number | null = null;
    if (dto.confirmMode === SiteConfirmMode.SMS && confirmUrl)
      try {
        const snapshot = await this.catalog.orderSnapshotMany(
          lines,
          dto.whereDeliver,
        );
        delivery = snapshot?.delivery?.shown ?? null;
      } catch (error) {
        // SMS da jami summa aytilmasa — operator qo‘ng‘iroq qiladi
        this.logger.warn(
          `Sayt buyurtmasi: yetkazish hisoblanmadi, SMS o‘rniga qo‘ng‘iroq: ${(error as Error).message}`,
        );
      }
    const now = new Date();

    return this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const history = manager.getRepository(LeadHistory);
      // Qulflar tartibi sotuvchi sahifasidagidek: IP, keyin raqam + mahsulot
      if (input.ip)
        await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
          LOCK_SPACE_IP,
          input.ip,
        ]);
      const [first] = priced;
      // Raqam + har mahsulot (sotuvchi sahifasi bilan bir xil kalit; tartiblangan — o‘zaro kutish yo‘q)
      for (const productId of priced.map((line) => line.productId).sort())
        await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
          LOCK_SPACE_LEAD,
          `${dto.phone}:${productId}`,
        ]);
      const decisionOf = async (productId: string) => {
        const previous = await this.intake.previousLead(
          manager,
          dto.phone,
          productId,
          now,
        );
        return duplicateDecision(
          previous && {
            id: previous.id,
            status: previous.status,
            rejectedAt:
              previous.status === LeadStatus.REJECTED
                ? await this.intake.rejectedAt(manager, previous)
                : null,
          },
          now,
        );
      };
      const firstDecision = await decisionOf(first.productId);
      // Ko‘p tovarli savatda biror tovar bo‘yicha faol yoki yaqindagi lid bor — birlashtirilmaydi (yangi tovarlar
      // yo‘qolmasin): yangi lid, faqat qo‘ng‘iroq, operator dublikatni o‘zi belgilaydi (LID-4) [taklif]
      const related: string[] = [];
      const relate = (id: string) => {
        if (!related.includes(id)) related.push(id);
      };
      if (priced.length > 1)
        for (const line of priced) {
          const found =
            line === first ? firstDecision : await decisionOf(line.productId);
          if (found.kind !== 'NEW') relate(found.rootId);
        }
      // boshqa ko‘p tovarli sayt lidida shu tovar qatori bor (lid mahsuloti emas) — o‘sha lid faol bo‘lsa
      for (const line of priced) {
        const [active] = (await manager.query(
          `SELECT l.id::text AS id FROM lead.lead l
             JOIN lead.lead_item i ON i.lead_id = l.id
            WHERE l.phone_e164 = $1 AND i.product_id = $2 AND l.merged_into_id IS NULL
              AND l.is_deleted = FALSE AND l.status IN ('NEW', 'BOOKED', 'CALLBACK')
            ORDER BY l.id DESC LIMIT 1`,
          [dto.phone, line.productId],
        )) as Array<{ id: string }>;
        if (
          active &&
          !(firstDecision.kind !== 'NEW' && firstDecision.rootId === active.id)
        )
          relate(active.id);
      }
      const decision = related.length
        ? ({ kind: 'NEW' } as const)
        : firstDecision;
      // Bitta raqamga bir vaqtda bitta amaldagi SMS havola (SMS yuborishni suiiste’mol qilmaslik uchun)
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        LOCK_SPACE_SITE_SMS,
        dto.phone,
      ]);
      const [pendingSms] = (await manager.query(
        `SELECT 1 FROM lead.lead
          WHERE phone_e164 = $1 AND confirm_mode = 'SMS' AND status = 'NEW'
            AND sms_expires_at > now() AND is_deleted = FALSE
          LIMIT 1`,
        [dto.phone],
      )) as unknown[];
      const ipLeads = input.ip
        ? await leads.count({
            where: {
              ip: input.ip,
              createdAt: MoreThanOrEqual(ipWindowStart(now)),
            },
          })
        : 0;
      const heldForReview = ipLeads >= LEAD_RULES.ipMaxLeads;
      const blacklisted =
        (await this.intake.rejectionsOf(manager, dto.phone)) >=
        LEAD_RULES.blacklistRejections;
      const sms =
        dto.confirmMode === SiteConfirmMode.SMS &&
        !!confirmUrl &&
        delivery !== null &&
        decision.kind === 'NEW' &&
        !related.length &&
        !pendingSms &&
        !blacklisted &&
        !heldForReview;
      const token = sms ? randomBytes(32).toString('base64url') : null;
      const smsExpiresAt = sms
        ? new Date(now.getTime() + SMS_CONFIRM_WINDOW_MIN * 60_000)
        : null;

      const submission = leads.create({
        source: LeadSource.SITE,
        apiKeyId: null,
        idempotencyKey: null,
        streamId: null,
        clickId: null,
        affiliateId: null,
        productId: first.productId,
        name: dto.name,
        phoneE164: dto.phone,
        regionSoato: address.regionSoato,
        districtSoato: address.districtSoato,
        addressLine: dto.addressLine,
        whereDeliver: dto.whereDeliver,
        variant: null,
        quantity: first.quantity,
        salePrice: String(first.salePrice),
        ip: input.ip,
        userAgent: input.userAgent,
        consentVersion: dto.consentVersion,
        consentAt: now,
        reviewReason: heldForReview ? LeadReviewReason.IP_RATE : null,
        confirmMode: sms ? SiteConfirmMode.SMS : SiteConfirmMode.CALL,
        smsTokenHash: token ? tokenHash(token) : null,
        smsExpiresAt,
      });
      const summary = `Saytdan buyurtma: ${priced.length} xil tovar, tasdiqlash — ${sms ? 'SMS havola' : 'qo‘ng‘iroq'}`;

      let resultLead: Lead;
      let target: Lead;
      if (decision.kind === 'NEW') {
        submission.status = LeadStatus.NEW;
        // SMS: havola muddati tugaguncha navbatda ko‘rinmaydi, keyin operatorga (TC7)
        const queueAt = smsExpiresAt ?? now;
        submission.nextAttemptAt = queueAt;
        submission.expiresAt = contactDeadline(queueAt);
        resultLead = await leads.save(submission);
        await history.save(
          history.create({
            leadId: resultLead.id,
            fromStatus: null,
            toStatus: LeadStatus.NEW,
            note: [
              summary,
              heldForReview ? 'tekshiruvga: bir IP dan ko‘p ariza' : null,
              related.length
                ? `shu raqamda boshqa lid bor: ${related.map((id) => `#${id}`).join(', ')} — dublikatni operator belgilaydi`
                : null,
            ]
              .filter(Boolean)
              .join('. '),
          }),
        );
        target = resultLead;
      } else {
        const root = await leads.findOneOrFail({
          where: { id: decision.rootId },
        });
        submission.status = LeadStatus.MERGED;
        submission.mergedIntoId = root.id;
        resultLead = await leads.save(submission);
        await history.save([
          history.create({
            leadId: resultLead.id,
            fromStatus: null,
            toStatus: LeadStatus.MERGED,
            note: `${summary}. Dublikat: ${root.id} lidiga qo‘shildi (9-qoida)`,
          }),
          history.create({
            leadId: root.id,
            fromStatus: root.status,
            toStatus: root.status,
            field: 'duplicate',
            newValue: { leadId: resultLead.id, source: LeadSource.SITE },
            note: 'Shu raqam va mahsulotdan saytdan yana buyurtma (9-qoida)',
          }),
        ]);
        if (decision.kind === 'REOPEN_AND_MERGE') {
          const from = root.status;
          root.status = LeadStatus.NEW;
          root.reviewReason = heldForReview ? LeadReviewReason.IP_RATE : null;
          root.attempts = 0;
          root.nextAttemptAt = now;
          root.expiresAt = contactDeadline(now);
          root.operatorId = null;
          root.bookedUntil = null;
          await leads.save(root);
          await history.save(
            history.create({
              leadId: root.id,
              fromStatus: from,
              toStatus: LeadStatus.NEW,
              note: 'Qayta ochildi: mijoz saytdan yana buyurtma berdi (10-qoida)',
            }),
          );
        }
        target = root;
      }

      const items = manager.getRepository(LeadItem);
      await items.save(
        priced.map((line, position) =>
          items.create({
            leadId: resultLead.id,
            position,
            productId: line.productId,
            productName: line.name.slice(0, 255),
            quantity: line.quantity,
            salePrice: String(line.salePrice),
          }),
        ),
      );
      if (sms)
        await this.enqueueSms(manager, resultLead, {
          // mijoz yozgan matn (ko‘cha/uy) SMS ga kirmaydi — faqat rasmiy tuman nomi (soxta havola yozib bo‘lmasin)
          text: this.smsText(
            priced,
            delivery!,
            address.districtName,
            `${confirmUrl}/${token}`,
          ),
          expiresAt: smsExpiresAt!,
        });
      await this.intake.markBlacklisted(manager, dto.phone, target);
      return {
        leadId: resultLead.id,
        confirmMode: sms ? SiteConfirmMode.SMS : SiteConfirmMode.CALL,
      };
    });
  }

  /**
   * SMS havola bosildi (TC6): lid «Tasdiqlandi», tasdiqlovchi — mijoz (`confirmed_via = SMS`), buyurtma operatorsiz
   * (BUY-1). Takror bosish — o‘sha javob. Muddat o‘tgan yoki lidni operator olgan bo‘lsa — 409 (operator qo‘ng‘iroq
   * qiladi, TC7).
   */
  async confirm(token: string): Promise<SiteOrderConfirmedDto> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(token ?? '')))
      throw new NotFoundException('Havola noto‘g‘ri');
    const now = new Date();
    return this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const lead = await leads.findOne({
        where: { smsTokenHash: tokenHash(token), isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead) throw new NotFoundException('Havola noto‘g‘ri');
      if (
        lead.status === LeadStatus.CONFIRMED &&
        lead.confirmedVia === LeadConfirmedVia.SMS
      )
        return { status: 'CONFIRMED' as const };
      if (
        lead.status !== LeadStatus.NEW ||
        lead.operatorId !== null ||
        lead.reviewReason !== null ||
        !lead.smsExpiresAt ||
        lead.smsExpiresAt.getTime() <= now.getTime()
      )
        throw new ConflictException({
          message:
            'Havola muddati o‘tgan — buyurtmani operator qo‘ng‘iroq qilib tasdiqlaydi',
          errorCode: LeadErrorCode.SITE_CONFIRM_EXPIRED,
        });
      lead.status = LeadStatus.CONFIRMED;
      lead.nextAttemptAt = null;
      lead.stockShortageAt = null;
      lead.confirmedAt = now;
      lead.confirmedBy = null;
      lead.confirmedVia = LeadConfirmedVia.SMS;
      await leads.save(lead);
      await manager.getRepository(LeadHistory).save(
        manager.getRepository(LeadHistory).create({
          leadId: lead.id,
          fromStatus: LeadStatus.NEW,
          toStatus: LeadStatus.CONFIRMED,
          actorId: null,
          note: 'Tasdiqlandi: mijoz SMS havola orqali',
        }),
      );
      await enqueueLeadConfirmed(manager, lead, {
        confirmedBy: null,
        via: LeadConfirmedVia.SMS,
        now,
      });
      return { status: 'CONFIRMED' as const };
    });
  }

  /** Savat qatorlari: bir xil mahsulot birlashadi; 1…SITE_ORDER_MAX_LINES qator, 1…1000 dona (BE-18 chegarasi). */
  private normalize(input: SiteOrderLine[] | undefined): SiteOrderLine[] {
    const merged = new Map<string, number>();
    for (const line of Array.isArray(input) ? input : []) {
      const productId = String(line?.productId ?? '');
      const quantity = Number(line?.quantity);
      if (!isLeadBigintId(productId) || !Number.isSafeInteger(quantity))
        throw new BadRequestException({
          message: ['Savat qatori noto‘g‘ri'],
        });
      merged.set(productId, (merged.get(productId) ?? 0) + quantity);
    }
    if (!merged.size)
      throw new BadRequestException({
        message: 'Savat bo‘sh',
        errorCode: LeadErrorCode.SITE_CART_EMPTY,
      });
    if (merged.size > SITE_ORDER_MAX_LINES)
      throw new BadRequestException({
        message: [`Savatda ${SITE_ORDER_MAX_LINES} xildan ko‘p tovar`],
      });
    return [...merged].map(([productId, quantity]) => {
      if (quantity < 1 || quantity > 1000)
        throw new BadRequestException({
          message: ['Tovar soni 1 dan 1000 gacha'],
        });
      return { productId, quantity };
    });
  }

  /** SMS matni [taklif]: summa (tovarlar + yetkazish), tovarlar (katalog nomi), tuman (geo nomi) va havola. */
  private smsText(
    lines: Array<{ name: string; quantity: number; salePrice: number }>,
    delivery: number,
    district: string,
    url: string,
  ): string {
    const total =
      lines.reduce((sum, line) => sum + line.salePrice * line.quantity, 0) +
      delivery;
    let goods = lines
      .map((line) => `${line.name} ×${line.quantity}`)
      .join(', ');
    if (goods.length > SMS_ITEMS_MAX_CHARS)
      goods = `${goods.slice(0, SMS_ITEMS_MAX_CHARS - 1).trimEnd()}…`;
    return (
      `Elchi Market: buyurtma ${money(total)} so‘m (${goods}), ${district}. ` +
      `Tasdiqlash: ${url}`
    );
  }

  private async enqueueSms(
    manager: EntityManager,
    lead: Lead,
    sms: { text: string; expiresAt: Date },
  ): Promise<void> {
    const payload: SiteConfirmSmsEvent = {
      eventId: randomUUID(),
      leadId: lead.id,
      phone: lead.phoneE164,
      text: sms.text,
      expiresAt: sms.expiresAt.toISOString(),
    };
    const outbox = manager.getRepository(OutboxEvent);
    await outbox.save(
      outbox.create({
        aggregateType: 'lead',
        aggregateId: lead.id,
        eventType: LEAD_EVENTS.SITE_CONFIRM_SMS,
        payload: payload as unknown as Record<string, unknown>,
      }),
    );
  }

  /** Tasdiq sahifasi manzili (sayt, SF-04): `SITE_ORDER_CONFIRM_URL`; berilmasa SMS tanlovi o‘chiq — CALL. */
  private confirmUrl(): string | null {
    const url = (this.config.get<string>('SITE_ORDER_CONFIRM_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return /^https:\/\/\S+$/.test(url) ? url : null;
  }

  private operatorCodes(): string[] {
    return (this.config.get<string>('LEAD_PHONE_OPERATOR_CODES') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^\d{2}$/.test(c));
  }
}
