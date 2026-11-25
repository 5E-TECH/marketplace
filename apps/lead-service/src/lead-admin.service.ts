import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  AdminLeadCardDto,
  AdminLeadCountsDto,
  AdminLeadFilterDto,
  AdminLeadSort,
  AdminLeadsPageDto,
  AdminLeadsQueryDto,
  AdminLeadTab,
  AdminLeadViewer,
  AffiliatePostbackEvent,
  AffiliatePostbackStatus,
  CatalogOfferSnapshot,
  FraudActionType,
  isLeadBigintId,
  LeadErrorCode,
  LeadExportChunk,
  LeadExportChunkInput,
  LeadExportColumn,
  LeadFilterOptionsDto,
  LeadReleasedDto,
  LeadReopenedDto,
  LeadReviewDecision,
  LeadReviewDecisionDto,
  LeadReviewedDto,
  LeadReviewResult,
  LeadStatus,
  OperatorWorkState,
} from '@app/common';
import { CapiService } from './capi.service';
import { CatalogOfferClient } from './catalog-offer.client';
import {
  Lead,
  LeadHistory,
  OperatorState,
  PostbackDelivery,
  Stream,
} from './entities';
import {
  ACTIVE_STATUSES,
  callbackAtOf,
  closedNote,
  closesAtOf,
  deviceOf,
  fullTime,
  IN_REVIEW,
  inReview,
  leadNumber,
  likeText,
  SORT_SQL,
  STATUS_LABELS,
  subsText,
  TAB_SQL,
} from './lead-admin-view';
import { FraudService } from './fraud.service';
import { LeadCardService, maskPhone } from './lead-card.service';
import { LOCK_SPACE_LEAD } from './lead-intake.service';
import { contactDeadline } from './lead-rules';
import { tashkentDayStart as dayStart } from './lead-schedule';
import { PostbackService } from './postback.service';
import { queuePositions } from './lead-supervisor.service';
import { CallService } from './telephony/call.service';
import { UserNamesClient } from './user-names.client';
import { csvCell } from './variant-report.service';

const DEFAULT_LIMIT = 20;
const EXPORT_CHUNK = 1_000;
/** Mahsulot nomi — ko‘rinish ma’lumoti: katalog javob bermasa ro‘yxat nomsiz ochiladi (ismlar bilan bir xil) [taklif]. */
const NAMES_TIMEOUT_MS = 1_500;
/** Katalog bir so‘rovda shuncha mahsulot qaytaradi (`LIST_LIMIT`). */
const NAMES_CHUNK = 500;
/** Yopilgan holatlar: karta «Kim — Shohruh M. · 13:02». */
const CLOSED = [
  LeadStatus.REJECTED,
  LeadStatus.INVALID,
  LeadStatus.MERGED,
  LeadStatus.NO_CONTACT,
];

const CSV_HEADER: Record<LeadExportColumn, string> = {
  [LeadExportColumn.LEAD]: 'Lid',
  [LeadExportColumn.CUSTOMER]: 'Mijoz',
  [LeadExportColumn.PHONE]: 'Telefon',
  [LeadExportColumn.STREAM]: 'Sahifa',
  [LeadExportColumn.PRICE]: 'Narx, so‘m',
  [LeadExportColumn.OPERATOR]: 'Operator',
  [LeadExportColumn.ATTEMPTS]: 'Urinish',
  [LeadExportColumn.STATUS]: 'Holat',
  [LeadExportColumn.CREATED_AT]: 'Keldi (Toshkent)',
  [LeadExportColumn.SUBS]: 'Sub',
};

/** Bir so‘rovdagi ID lar: faqat to‘g‘ri bigint, eksport bo‘lagidan ko‘p emas. */
const idList = (ids: unknown): string[] =>
  (Array.isArray(ids) ? ids : [])
    .map(String)
    .filter(isLeadBigintId)
    .slice(0, EXPORT_CHUNK);

const allSubs = (
  r: Pick<Lead, 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5'>,
): string =>
  [r.sub1 ? `sub1=${r.sub1}` : null, subsText(r)].filter(Boolean).join(' · ');

interface StatusChange {
  leadId: string;
  toStatus: LeadStatus;
  actorId: string | null;
  at: Date;
}

/**
 * Admin va nazoratchi uchun lidlar (BE-42; FE-26). Filtrlar FE-26 dagi bilan bir xil: yorliq, holat, sotuvchi, mahsulot,
 * operator, manba, sana (Toshkent kuni, `to` kuni ham kiradi), qidiruv. Telefon niqoblangan (TC2).
 * Sotuvchi va operator ismlari identity dan (BE-25); identity javob bermasa `#ID`.
 */
@Injectable()
export class LeadAdminService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly catalog: CatalogOfferClient,
    private readonly cards: LeadCardService,
    @Optional() private readonly userNames?: UserNamesClient,
    @Optional() private readonly calls?: CallService,
    @Optional() private readonly postback?: PostbackService,
    @Optional() private readonly capi?: CapiService,
    @Optional() private readonly fraud?: FraudService,
  ) {}

  async list(
    query: AdminLeadsQueryDto,
    viewer: AdminLeadViewer = { admin: true },
    now = new Date(),
  ): Promise<AdminLeadsPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    this.assertTab(query.tab, viewer);
    const sort = SORT_SQL[query.sort ?? AdminLeadSort.CREATED_DESC];
    const filtered = this.filtered(query);
    // nazoratchiga tekshiruvdagi arizalar umuman ko‘rinmaydi: ro‘yxat, sonlar va qidiruvda ham
    if (!viewer.admin) filtered.andWhere(`NOT ${IN_REVIEW}`);
    const [[rows, total], counts, review] = await Promise.all([
      this.byTab(filtered.clone(), query)
        .orderBy(sort.by, sort.direction)
        .addOrderBy('l.id', sort.direction)
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount(),
      this.counts(filtered.clone(), viewer),
      viewer.admin ? this.reviewBanner() : Promise.resolve(null),
    ]);

    const ids = rows.map((r) => r.id);
    const [names, resolved, changes, positions, codes, geo] = await Promise.all(
      [
        this.productNames(rows.map((r) => r.productId)),
        this.names([
          ...rows.flatMap((r) => [r.affiliateId, r.operatorId]),
          review?.affiliateId,
        ]),
        this.lastChanges(ids),
        queuePositions(this.leads.manager, ids, now),
        this.streamCodes(rows.map((r) => r.streamId)),
        rows.some((r) => r.regionSoato)
          ? this.cards.geoNames()
          : Promise.resolve(new Map<string, string>()),
      ],
    );
    const nameOf = (id: string | null) => (id ? resolved(id) : null);
    return {
      items: rows.map((r) => {
        const statusAt = changes.get(r.id)?.at ?? r.createdAt;
        return {
          id: r.id,
          createdAt: r.createdAt,
          status: r.status,
          source: r.source,
          customerName: r.name,
          phoneMasked: maskPhone(r.phoneE164),
          productId: r.productId,
          productName: names.get(r.productId) ?? '',
          affiliateName: nameOf(r.affiliateId),
          operatorName: nameOf(r.operatorId),
          operatorId: r.operatorId,
          orderId: r.orderId,
          regionName: r.regionSoato ? (geo.get(r.regionSoato) ?? null) : null,
          streamCode: r.streamId ? (codes.get(r.streamId) ?? null) : null,
          salePrice: Number(r.salePrice),
          attemptsCount: r.attempts,
          rejectReason: r.rejectReason,
          closedNote: closedNote(r, statusAt),
          rejectedAt:
            r.status === LeadStatus.REJECTED ? statusAt.toISOString() : null,
          callbackAt: callbackAtOf(r)?.toISOString() ?? null,
          queuePosition: positions.get(r.id) ?? null,
          statusAt: statusAt.toISOString(),
          inReview: inReview(r),
          ip: viewer.admin && inReview(r) ? r.ip : null,
          device: viewer.admin && inReview(r) ? deviceOf(r.userAgent) : null,
        };
      }),
      counts,
      review: review
        ? {
            count: review.count,
            streamCode: review.code,
            affiliateName: resolved(review.affiliateId),
            from: review.from.toISOString(),
            to: review.to.toISOString(),
          }
        : null,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Lid kartasi admin va nazoratchi uchun: operator egaligi tekshirilmaydi (rol gateway'da). */
  async card(
    leadId: string,
    viewer: AdminLeadViewer = { admin: true },
    now = new Date(),
  ): Promise<AdminLeadCardDto> {
    const lead = await this.leads.findOne({
      where: { id: leadId, isDeleted: false },
    });
    if (!lead || (!viewer.admin && inReview(lead)))
      throw new NotFoundException('Lid topilmadi');
    const m = this.leads.manager;
    const held =
      lead.operatorId !== null &&
      [LeadStatus.BOOKED, LeadStatus.CALLBACK].includes(lead.status);
    const [
      base,
      offer,
      stream,
      changes,
      reopen,
      postbacks,
      merged,
      sameNumber,
      positions,
      state,
      call,
    ] = await Promise.all([
      this.cards.build(lead),
      this.catalog.get(lead.productId).catch(() => null),
      lead.streamId
        ? m.getRepository(Stream).findOne({ where: { id: lead.streamId } })
        : null,
      this.lastChanges([lead.id]),
      m.getRepository(LeadHistory).findOne({
        where: { leadId: lead.id, field: 'reopen' },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
      m.getRepository(PostbackDelivery).find({
        where: { leadId: lead.id },
        order: { id: 'ASC' },
      }),
      lead.mergedIntoId
        ? this.leads.findOne({ where: { id: lead.mergedIntoId } })
        : null,
      this.leads.count({
        where: {
          phoneE164: lead.phoneE164,
          id: Not(lead.id),
          isDeleted: false,
        },
      }),
      queuePositions(m, [lead.id], now),
      held
        ? m
            .getRepository(OperatorState)
            .findOne({ where: { operatorId: lead.operatorId! } })
        : null,
      held ? this.calls?.activeFor(lead.id, lead.operatorId!) : null,
    ]);
    const [nameOf, names, mergedCodes] = await Promise.all([
      this.names([
        lead.operatorId,
        lead.affiliateId,
        changes.get(lead.id)?.actorId,
        reopen?.actorId,
        merged?.affiliateId,
        merged?.operatorId,
      ]),
      merged
        ? this.productNames([merged.productId])
        : new Map<string, string>(),
      this.streamCodes([merged?.streamId ?? null]),
    ]);
    const change = changes.get(lead.id);
    const statusAt = change?.at ?? lead.createdAt;
    const affiliateName = lead.affiliateId ? nameOf(lead.affiliateId) : null;
    return {
      ...base,
      operator: held
        ? {
            id: lead.operatorId!,
            name: nameOf(lead.operatorId!),
            state: state?.state ?? OperatorWorkState.OFFLINE,
            since: state?.stateSince?.toISOString() ?? null,
            inCall: !!call,
            callStartedAt: call
              ? (call.answeredAt ?? call.startedAt).toISOString()
              : null,
          }
        : null,
      bookedAt:
        lead.status === LeadStatus.BOOKED ? statusAt.toISOString() : null,
      queuePosition: positions.get(lead.id) ?? null,
      closesAt: closesAtOf(lead)?.toISOString() ?? null,
      rejectedAt:
        lead.status === LeadStatus.REJECTED ? statusAt.toISOString() : null,
      consentAt: lead.consentAt?.toISOString() ?? null,
      closedBy:
        change && CLOSED.includes(lead.status)
          ? {
              name: change.actorId ? nameOf(change.actorId) : 'Tizim',
              at: change.at.toISOString(),
            }
          : null,
      sameNumberLeads: sameNumber,
      affiliateName,
      productInfo: offer
        ? {
            category: offer.categoryName,
            weightGrams: offer.weightGrams,
            deliveryMode: base.price?.deliveryMode ?? null,
            options: {
              CENTER: offer.centerDeliveryFee,
              ADDRESS: offer.addressDeliveryFee,
            },
          }
        : null,
      stream: stream
        ? {
            code: stream.code,
            productName: base.product.name,
            createdAt: stream.createdAt.toISOString(),
            affiliateName: nameOf(stream.affiliateId),
            affiliateId: stream.affiliateId,
            sub1: viewer.admin ? lead.sub1 : null,
            subs: viewer.admin ? subsText(lead) : null,
            utmSource: lead.utmSource,
            fbclid: !!lead.fbclid,
            ip: viewer.admin ? lead.ip : null,
            device: viewer.admin ? deviceOf(lead.userAgent) : null,
          }
        : null,
      postbacks: postbacks.map((d) => ({
        at: (d.deliveredAt ?? d.createdAt).toISOString(),
        event: d.event,
        attempt: d.attempts,
        code: d.responseCode,
        state: d.deliveredAt
          ? AffiliatePostbackStatus.SENT
          : d.nextAttemptAt
            ? AffiliatePostbackStatus.PENDING
            : AffiliatePostbackStatus.FAILED,
      })),
      mergedInto: merged
        ? {
            id: merged.id,
            productName: names.get(merged.productId) ?? '',
            status: merged.status,
            createdAt: merged.createdAt.toISOString(),
            streamCode: merged.streamId
              ? (mergedCodes.get(merged.streamId) ?? null)
              : null,
            affiliateName: merged.affiliateId
              ? nameOf(merged.affiliateId)
              : null,
            operatorName: merged.operatorId ? nameOf(merged.operatorId) : null,
            attemptsCount: merged.attempts,
          }
        : null,
      reopened: reopen
        ? {
            at: reopen.createdAt.toISOString(),
            by: reopen.actorId ? nameOf(reopen.actorId) : 'Tizim',
            reason: String(reopen.newValue?.reason ?? ''),
          }
        : null,
      order: null, // gateway checkout dan to‘ldiradi
    };
  }

  /** FE-26: filtr variantlari — lidlarda uchragan mahsulot, operator va sotuvchilar (nazoratchiga ham). */
  async filterOptions(): Promise<LeadFilterOptionsDto> {
    const m = this.leads.manager;
    const distinct = async (column: string) =>
      (
        (await m.query(
          `SELECT DISTINCT ${column}::text AS id FROM lead.lead WHERE is_deleted = false AND ${column} IS NOT NULL`,
        )) as Array<{ id: string }>
      ).map((r) => r.id);
    const [productIds, leadOperators, affiliateIds, states] = await Promise.all(
      [
        distinct('product_id'),
        distinct('operator_id'),
        distinct('affiliate_id'),
        m.getRepository(OperatorState).find({ select: { operatorId: true } }),
      ],
    );
    const operatorIds = [
      ...new Set([...leadOperators, ...states.map((s) => s.operatorId)]),
    ];
    const [products, nameOf] = await Promise.all([
      this.productNames(productIds),
      this.names([...operatorIds, ...affiliateIds]),
    ]);
    const sorted = (options: LeadFilterOptionsDto['products']) =>
      options.sort((a, b) => a.name.localeCompare(b.name, 'uz'));
    const people = (ids: string[]) =>
      sorted(ids.map((id) => ({ id, name: nameOf(id) })));
    return {
      products: sorted(
        productIds.map((id) => ({ id, name: products.get(id) ?? `#${id}` })),
      ),
      operators: people(operatorIds),
      affiliates: people(affiliateIds),
    };
  }

  /**
   * «Bronni bo‘shatish» (dizayn admin-lid-karta; amal TZ da yo‘q — p-a6 9-savol [taklif]): faqat admin, sabab bilan.
   * Lid bron muddati tugagandagi kabi (5-qoida) navbatga qaytadi: mijoz aytgan qo‘ng‘iroq — egasida qayta qo‘ng‘iroq
   * bo‘lib, boshqasi — navbatga egasiz. Suhbat ketayotgan bo‘lsa — 409.
   */
  async release(
    actorId: string,
    leadId: string,
    reason: string,
  ): Promise<LeadReleasedDto> {
    if (!isLeadBigintId(leadId))
      throw new BadRequestException('leadId noto‘g‘ri');
    const why = String(reason ?? '').trim();
    if (!why)
      throw new BadRequestException({
        message: ['reason bo‘shatish sababi majburiy'],
      });
    return this.leads.manager.transaction(async (m) => {
      const leads = m.getRepository(Lead);
      const lead = await leads.findOne({
        where: { id: leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead) throw new NotFoundException('Lid topilmadi');
      if (lead.status !== LeadStatus.BOOKED || lead.operatorId === null)
        throw new ConflictException({
          message: 'Lid hech kimning bronida emas',
          errorCode: LeadErrorCode.LEAD_NOT_BOOKED,
        });
      if (await this.calls?.activeFor(lead.id, lead.operatorId, m))
        throw new ConflictException({
          message: 'Operator hozir mijoz bilan gaplashmoqda — suhbat tugasin',
          errorCode: LeadErrorCode.LEAD_CALL_ACTIVE,
        });
      const fromOperator = lead.operatorId;
      if (lead.bookedFromCallback) lead.status = LeadStatus.CALLBACK;
      else {
        lead.status = lead.attempts > 0 ? LeadStatus.CALLBACK : LeadStatus.NEW;
        lead.operatorId = null;
      }
      lead.bookedUntil = null;
      lead.bookedFromCallback = false;
      await leads.save(lead);
      const history = m.getRepository(LeadHistory);
      await history.save(
        history.create({
          leadId: lead.id,
          fromStatus: LeadStatus.BOOKED,
          toStatus: lead.status,
          actorId,
          field: 'release',
          oldValue: { operatorId: fromOperator },
          newValue: { operatorId: lead.operatorId, reason: why },
          note: `Admin bronni bo‘shatdi: ${why}`,
        }),
      );
      return { leadId: lead.id, status: lead.status };
    });
  }

  /**
   * LID-5 tekshiruvidagi arizalar bo‘yicha qaror (dizayn admin-tekshiruvdagi-lidlar): navbatga yoki spam. Har ariza o‘z
   * tranzaksiyasida — bittasi o‘tmasa qolganlariga ta’sir qilmaydi. Kim, qachon, sabab — lid tarixida va choralar tarixida.
   */
  async review(
    actorId: string,
    dto: LeadReviewDecisionDto,
    now = new Date(),
  ): Promise<LeadReviewedDto> {
    const reason = String(dto?.reason ?? '').trim();
    const ids = Array.isArray(dto?.leadIds) ? dto.leadIds.map(String) : [];
    if (
      !reason ||
      !ids.length ||
      !ids.every(isLeadBigintId) ||
      !Object.values(LeadReviewDecision).includes(dto.decision)
    )
      throw new BadRequestException({
        message: ['leadIds, decision va reason majburiy'],
      });
    const items: LeadReviewedDto['items'] = [];
    for (const leadId of ids)
      items.push(
        await this.reviewOne(actorId, leadId, dto.decision, reason, now),
      );
    return {
      done: items.filter((i) => i.result === LeadReviewResult.DONE).length,
      items,
    };
  }

  private reviewOne(
    actorId: string,
    leadId: string,
    decision: LeadReviewDecision,
    reason: string,
    now: Date,
  ): Promise<LeadReviewedDto['items'][number]> {
    return this.leads.manager.transaction(async (m) => {
      const leads = m.getRepository(Lead);
      const head = await leads.findOne({
        where: { id: leadId, isDeleted: false },
      });
      if (!head)
        return { leadId, result: LeadReviewResult.NOT_FOUND, status: null };
      await this.lockIntake(m, head);
      const lead = await leads.findOneOrFail({
        where: { id: leadId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!inReview(lead))
        return {
          leadId,
          result: LeadReviewResult.NOT_IN_REVIEW,
          status: lead.status,
        };
      const from = lead.status;
      let note = `Spam deb yopildi: ${reason}`;
      if (decision === LeadReviewDecision.QUEUE) {
        // LID-4: navbatdagi yoki operatordagi boshqa lid; tekshiruvdagisi hisobga olinmaydi (ikkalasi bir-birini to‘sardi).
        // Saytdan ko‘p tovarli buyurtma alohida lid (BE-34) — bloklanmaydi, dublikatni operator belgilaydi.
        const other = await this.otherActive(m, lead, true);
        if (other && !(await this.multiItem(m, [lead.id, other.id])))
          return {
            leadId,
            result: LeadReviewResult.ACTIVE_LEAD_EXISTS,
            status: lead.status,
          };
        note = `Tekshiruvdan navbatga qo‘yildi: ${reason}${other ? `. Shu raqamda boshqa lid bor: #${other.id} — dublikatni operator belgilaydi` : ''}`;
        lead.reviewReason = null;
        lead.nextAttemptAt = now;
        lead.expiresAt = contactDeadline(now); // aloqa oynasi (2-qoida) qarordan boshlanadi
        await leads.save(lead);
        // SOT-5, BE-31: «lid» hodisalari ko‘rib chiqilguncha ushlab turilgan edi; takrori yozilmaydi (lid + hodisa unikal)
        await this.postback?.enqueue(m, lead, AffiliatePostbackEvent.LEAD);
        await this.capi?.enqueueLead(m, lead);
      } else {
        // oddiy IP dan qo‘shilgan ariza bor — mijoz haqiqiy bo‘lishi mumkin, spam bilan birga jim yopilmaydi
        const clean = await leads.count({
          where: {
            mergedIntoId: lead.id,
            reviewReason: IsNull(),
            isDeleted: false,
          },
        });
        if (clean)
          return {
            leadId,
            result: LeadReviewResult.HAS_CLEAN_APPLICATION,
            status: lead.status,
          };
        lead.status = LeadStatus.INVALID;
        lead.nextAttemptAt = null;
        lead.operatorId = null;
        lead.bookedUntil = null;
        lead.bookedFromCallback = false;
        await leads.save(lead); // `review_reason` qoladi: statistikada «yaroqli» ga kirmaydi
      }
      const history = m.getRepository(LeadHistory);
      await history.save(
        history.create({
          leadId: lead.id,
          fromStatus: from,
          toStatus: lead.status,
          actorId,
          field: 'review',
          newValue: { decision, reason },
          note,
        }),
      );
      await this.fraud?.onReviewDecision(
        m,
        lead,
        decision === LeadReviewDecision.QUEUE
          ? FraudActionType.REVIEW_QUEUE
          : FraudActionType.REVIEW_SPAM,
        actorId,
        reason,
      );
      return { leadId, result: LeadReviewResult.DONE, status: lead.status };
    });
  }

  /** Lid qabul qilish bilan bir xil qulf (raqam + mahsulot). */
  private lockIntake(
    m: EntityManager,
    lead: Pick<Lead, 'phoneE164' | 'productId'>,
  ): Promise<unknown> {
    return m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      LOCK_SPACE_LEAD,
      `${lead.phoneE164}:${lead.productId}`,
    ]);
  }

  /** LID-4: shu raqam va mahsulotdagi boshqa faol lid; `queuedOnly` — tekshiruvdagisi hisobga olinmaydi. */
  private otherActive(
    m: EntityManager,
    lead: Lead,
    queuedOnly = false,
  ): Promise<Lead | null> {
    return m.getRepository(Lead).findOne({
      where: {
        id: Not(lead.id),
        phoneE164: lead.phoneE164,
        productId: lead.productId,
        status: In(ACTIVE_STATUSES),
        mergedIntoId: IsNull(),
        isDeleted: false,
        ...(queuedOnly ? { reviewReason: IsNull() } : {}),
      },
    });
  }

  /** Lidlardan birortasi ko‘p tovarli (BE-34). */
  private async multiItem(m: EntityManager, ids: string[]): Promise<boolean> {
    const rows = (await m.query(
      `SELECT 1 FROM lead.lead_item WHERE lead_id = ANY($1::bigint[])
        GROUP BY lead_id HAVING count(*) > 1 LIMIT 1`,
      [ids],
    )) as unknown[];
    return rows.length > 0;
  }

  /** Eksportga tushadigan qatorlar soni (so‘ralgan vaqtgacha kelganlar). */
  async exportCount(
    filters: AdminLeadFilterDto,
    until: Date,
  ): Promise<{ rows: number }> {
    return {
      rows: await this.byTab(this.filtered(filters), filters)
        .andWhere('l.created_at <= :until', { until })
        .getCount(),
    };
  }

  /** CSV bo‘lagi: birinchi bo‘lakda sarlavha. Telefon — faqat oxirgi 4 raqam (134-savol). */
  async exportChunk(input: LeadExportChunkInput): Promise<LeadExportChunk> {
    const columns = input.columns.filter((c) => c in CSV_HEADER);
    const qb = this.byTab(this.filtered(input.filters), input.filters)
      .andWhere('l.created_at <= :until', { until: new Date(input.until) })
      .orderBy('l.id', 'DESC')
      .take(EXPORT_CHUNK);
    if (input.afterId) qb.andWhere('l.id < :after', { after: input.afterId });
    const rows = await qb.getMany();
    const [nameOf, codes] = await Promise.all([
      this.names(rows.map((r) => r.operatorId)),
      this.streamCodes(rows.map((r) => r.streamId)),
    ]);
    const cell: Record<LeadExportColumn, (r: Lead) => string> = {
      [LeadExportColumn.LEAD]: (r) => `L-${r.id}`,
      [LeadExportColumn.CUSTOMER]: (r) => r.name,
      [LeadExportColumn.PHONE]: (r) => `****${r.phoneE164.slice(-4)}`,
      [LeadExportColumn.STREAM]: (r) =>
        r.streamId ? (codes.get(r.streamId) ?? '') : '',
      [LeadExportColumn.PRICE]: (r) => String(Number(r.salePrice)),
      [LeadExportColumn.OPERATOR]: (r) =>
        r.operatorId ? nameOf(r.operatorId) : '',
      [LeadExportColumn.ATTEMPTS]: (r) => String(r.attempts),
      [LeadExportColumn.STATUS]: (r) => STATUS_LABELS[r.status] ?? r.status,
      [LeadExportColumn.CREATED_AT]: (r) => fullTime(r.createdAt),
      [LeadExportColumn.SUBS]: allSubs,
    };
    const line = (values: string[]) => values.map(csvCell).join(';');
    return {
      lines: [
        ...(input.afterId ? [] : [line(columns.map((c) => CSV_HEADER[c]))]),
        ...rows.map((r) => line(columns.map((c) => cell[c](r)))),
      ],
      nextAfterId:
        rows.length === EXPORT_CHUNK ? rows[rows.length - 1].id : null,
    };
  }

  /** Sahifa kodlari: id → kod (checkout buyurtmalar ro‘yxati). */
  async streamCodesOf(ids: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(await this.streamCodes(idList(ids)));
  }

  /** Lid sub lari: lid ID → «sub1=… · sub2=…» (checkout CSV). */
  async subsOf(ids: string[]): Promise<Record<string, string>> {
    const rows = await this.leads.find({
      where: { id: In(idList(ids)) },
      select: {
        id: true,
        sub1: true,
        sub2: true,
        sub3: true,
        sub4: true,
        sub5: true,
      },
    });
    return Object.fromEntries(
      rows.map((r) => [r.id, allSubs(r)] as const).filter(([, text]) => !!text),
    );
  }

  /** Hamma filtr, yorliq va holatdan tashqari (yorliqdagi sonlar shularsiz sanaladi). */
  private filtered(query: AdminLeadFilterDto): SelectQueryBuilder<Lead> {
    const qb = this.leads.createQueryBuilder('l').where('l.is_deleted = false');
    if (query.affiliateId)
      qb.andWhere('l.affiliate_id = :affiliateId', {
        affiliateId: query.affiliateId,
      });
    if (query.productId)
      qb.andWhere('l.product_id = :productId', { productId: query.productId });
    if (query.operatorId)
      qb.andWhere('l.operator_id = :operatorId', {
        operatorId: query.operatorId,
      });
    if (query.source)
      qb.andWhere('l.source = :source', { source: query.source });
    if (query.from)
      qb.andWhere('l.created_at >= :from', { from: dayStart(query.from) });
    if (query.to)
      qb.andWhere('l.created_at < :to', { to: dayStart(query.to, 1) });
    const text = query.search?.trim();
    if (text) {
      const number = leadNumber(text);
      qb.andWhere(
        `(l.name ILIKE :like
          OR EXISTS (SELECT 1 FROM lead.stream s WHERE s.id = l.stream_id AND s.code ILIKE :like)
          ${number ? 'OR l.id = :number' : ''})`,
        { like: likeText(text), ...(number ? { number } : {}) },
      );
    }
    return qb;
  }

  private byTab(
    qb: SelectQueryBuilder<Lead>,
    query: AdminLeadFilterDto,
  ): SelectQueryBuilder<Lead> {
    if (query.status)
      qb.andWhere('l.status = :status', { status: query.status });
    // «Hammasi» va yorliqsiz ro‘yxat: tekshiruvdagi arizalar alohida yorliqda (dizayn p-a6)
    qb.andWhere(
      query.tab && query.tab !== AdminLeadTab.ALL
        ? TAB_SQL[query.tab]
        : `NOT ${IN_REVIEW}`,
    );
    return qb;
  }

  private assertTab(tab: AdminLeadTab | undefined, viewer: AdminLeadViewer) {
    if (tab === AdminLeadTab.REVIEW && !viewer.admin)
      throw new ForbiddenException('Tekshiruvdagi arizalar faqat adminga');
  }

  private async counts(
    qb: SelectQueryBuilder<Lead>,
    viewer: AdminLeadViewer,
  ): Promise<AdminLeadCountsDto> {
    const tabs = Object.entries(TAB_SQL) as Array<[AdminLeadTab, string]>;
    const row = await tabs
      .reduce(
        (q, [tab, sql]) =>
          q.addSelect(`count(*) FILTER (WHERE ${sql})::int`, tab),
        qb.select(
          `count(*) FILTER (WHERE NOT ${IN_REVIEW})::int`,
          AdminLeadTab.ALL,
        ),
      )
      .getRawOne<Record<AdminLeadTab, number>>();
    const n = (tab: AdminLeadTab) => Number(row?.[tab] ?? 0);
    return {
      ALL: n(AdminLeadTab.ALL),
      ACTIVE: n(AdminLeadTab.ACTIVE),
      CONFIRMED: n(AdminLeadTab.CONFIRMED),
      REJECTED: n(AdminLeadTab.REJECTED),
      CLOSED: n(AdminLeadTab.CLOSED),
      ...(viewer.admin ? { REVIEW: n(AdminLeadTab.REVIEW) } : {}),
    };
  }

  /** Tekshiruvda eng ko‘p ariza turgan sahifa (BE-12, BE-35). */
  private async reviewBanner(): Promise<{
    count: number;
    code: string;
    affiliateId: string;
    from: Date;
    to: Date;
  } | null> {
    const [row] = (await this.leads.manager.query(
      `SELECT s.code, s.affiliate_id::text AS "affiliateId", count(*)::int AS count,
              min(l.created_at) AS "from", max(l.created_at) AS "to"
         FROM lead.lead l JOIN lead.stream s ON s.id = l.stream_id
        WHERE l.is_deleted = false AND ${TAB_SQL[AdminLeadTab.REVIEW]}
        GROUP BY s.id, s.code, s.affiliate_id
        ORDER BY count(*) DESC, max(l.created_at) DESC LIMIT 1`,
    )) as Array<{
      code: string;
      affiliateId: string;
      count: number;
      from: Date;
      to: Date;
    }>;
    return row
      ? { ...row, from: new Date(row.from), to: new Date(row.to) }
      : null;
  }

  /** Har lid holatining oxirgi o‘zgarishi (manzil tuzatish va rejali o‘tkazish holatni o‘zgartirmaydi). */
  private async lastChanges(ids: string[]): Promise<Map<string, StatusChange>> {
    if (!ids.length) return new Map();
    const rows = (await this.leads.manager.query(
      `SELECT DISTINCT ON (lead_id) lead_id::text AS "leadId", to_status AS "toStatus", actor_id::text AS "actorId",
              created_at AS at
         FROM lead.lead_history
        WHERE lead_id = ANY($1::bigint[])
          AND (from_status IS DISTINCT FROM to_status OR field = 'transfer' AND to_status = 'BOOKED')
        ORDER BY lead_id, created_at DESC, id DESC`,
      [ids],
    )) as StatusChange[];
    return new Map(rows.map((r) => [r.leadId, { ...r, at: new Date(r.at) }]));
  }

  private async streamCodes(
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const streams = await this.leads.manager.getRepository(Stream).find({
      where: { id: In(unique) },
      select: { id: true, code: true },
    });
    return new Map(streams.map((s) => [s.id, s.code]));
  }

  private async productNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += NAMES_CHUNK)
      chunks.push(unique.slice(i, i + NAMES_CHUNK));
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<CatalogOfferSnapshot[]>((resolve) => {
      timer = setTimeout(() => resolve([]), NAMES_TIMEOUT_MS);
    });
    const offers = await Promise.race([
      Promise.all(
        chunks.map((productIds) =>
          this.catalog
            .list({ productIds })
            .catch(() => [] as CatalogOfferSnapshot[]),
        ),
      ).then((parts) => parts.flat()),
      late,
    ]).finally(() => clearTimeout(timer));
    return new Map(offers.map((o) => [o.productId, o.name]));
  }

  private async names(
    ids: Array<string | null | undefined>,
  ): Promise<(id: string) => string> {
    return this.userNames
      ? this.userNames.resolve(ids)
      : (id: string) => `#${id}`;
  }

  /**
   * Admin «Rad etildi» lidni qayta ochadi (TZ 3-bo‘lim ruxsatlar jadvali: faqat admin; 5-bo‘lim 10-qoida: «3 kun
   * ichida faqat admin ochadi»; BE-35 TC4). Sabab majburiy; lid tarixiga kim, qachon va sabab (11-qoida).
   * Lid navbatga yangi lid sifatida qaytadi: urinishlar 0 dan, yangi 3 kunlik aloqa oynasi (2-qoida) [taklif].
   * Admin uchun 3 kunlik chegara yo‘q [taklif]. Shu raqam va mahsulotda faol lid bo‘lsa — 409 (LID-4: ikkita faol
   * lid ochilmaydi). Qulf — lid qabul qilish bilan bir xil (raqam + mahsulot).
   */
  async reopen(
    actorId: string,
    leadId: string,
    reason: string,
    now = new Date(),
  ): Promise<LeadReopenedDto> {
    if (!isLeadBigintId(leadId))
      throw new BadRequestException('leadId noto‘g‘ri');
    const why = String(reason ?? '').trim();
    if (!why)
      throw new BadRequestException({
        message: ['reason qayta ochish sababi majburiy'],
      });
    return this.leads.manager.transaction(async (m) => {
      const leads = m.getRepository(Lead);
      const head = await leads.findOne({
        where: { id: leadId, isDeleted: false },
      });
      if (!head) throw new NotFoundException('Lid topilmadi');
      await this.lockIntake(m, head);
      const lead = await leads.findOne({
        where: { id: leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead || lead.status !== LeadStatus.REJECTED || lead.mergedIntoId)
        throw new ConflictException({
          message: 'Faqat «Rad etildi» holatidagi lid qayta ochiladi',
          errorCode: LeadErrorCode.LEAD_NOT_REJECTED,
        });
      const active = await this.otherActive(m, lead);
      if (active)
        throw new ConflictException({
          message: `Shu raqam va mahsulotda faol lid bor (#${active.id})`,
          errorCode: LeadErrorCode.ACTIVE_LEAD_EXISTS,
        });
      const reject = lead.rejectReason;
      lead.status = LeadStatus.NEW;
      lead.rejectReason = null;
      lead.attempts = 0;
      lead.operatorId = null;
      lead.bookedUntil = null;
      lead.bookedFromCallback = false;
      lead.nextAttemptAt = now;
      lead.expiresAt = contactDeadline(now);
      await leads.save(lead);
      const history = m.getRepository(LeadHistory);
      await history.save(
        history.create({
          leadId: lead.id,
          fromStatus: LeadStatus.REJECTED,
          toStatus: LeadStatus.NEW,
          actorId,
          field: 'reopen',
          oldValue: { rejectReason: reject },
          newValue: { reason: why },
          note: `Admin qayta ochdi: ${why}`,
        }),
      );
      return { leadId: lead.id, status: lead.status };
    });
  }
}
