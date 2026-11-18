import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  CatalogOfferSnapshot,
  isLeadBigintId,
  LeadErrorCode,
  LeadStatus,
  LeadTransferDto,
  OperatorWorkState,
  RedListDto,
  RedListItemDto,
  RedListReason,
  TransferLeadDto,
} from '@app/common';
import { CatalogOfferClient } from './catalog-offer.client';
import { Lead, LeadHistory, OperatorState } from './entities';
import {
  bookingUntil,
  QUEUE_RULES,
  tashkentDayStart,
  tashkentParts,
} from './lead-schedule';

/** TZ 9-bo‘lim «Real vaqt»: 10 daqiqadan ortiq kutgan yangi lidlar qizil ro‘yxatga tushadi. */
export const RED_LIST_NEW_WAIT_MINUTES = 10;
const MINUTE = 60_000;
const TRANSFERABLE = [LeadStatus.NEW, LeadStatus.CALLBACK, LeadStatus.BOOKED];

/** Umumiy navbat (7-qoida tartibi, `LeadQueueService.pick` bilan bir xil): avval vaqti kelgan qayta qo‘ng‘iroqlar, keyin eng yangi lidlar. */
const QUEUE_SQL = `
  SELECT l.id, row_number() OVER (ORDER BY q.grp, q.k1, q.k2 DESC, l.id DESC) AS pos
    FROM lead.lead l
    CROSS JOIN LATERAL (
      SELECT CASE WHEN l.status = 'CALLBACK' THEN 0 ELSE 1 END AS grp,
             CASE WHEN l.status = 'CALLBACK' THEN l.next_attempt_at END AS k1,
             CASE WHEN l.status = 'NEW' THEN l.created_at END AS k2
    ) q
   WHERE l.is_deleted = false AND l.review_reason IS NULL AND l.merged_into_id IS NULL
     AND (
       (l.status = 'CALLBACK' AND l.next_attempt_at <= $1
         AND (l.operator_id IS NULL OR l.next_attempt_at <= $2))
       OR (l.status = 'NEW' AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= $1))
     )`;

/**
 * Nazoratchi paneli (OPR-8; BE-35): qizil ro‘yxat va lidni boshqa operatorga o‘tkazish.
 * Qizil ro‘yxat so‘rov paytida hisoblanadi — har daqiqadagi yangilash (OPR-8 qabul mezoni) ekran so‘rovi bilan.
 */
@Injectable()
export class LeadSupervisorService {
  constructor(
    private readonly db: DataSource,
    private readonly catalog: CatalogOfferClient,
  ) {}

  /**
   * Qizil ro‘yxat (TZ 9: vaqti o‘tgan qo‘ng‘iroqlar va 10 daqiqadan ortiq kutgan yangi lidlar; dizayn E-Nazoratchi-Qizil):
   * - yangi lid — navbatda (`NEW`), kutish boshi (ariza yoki qayta ochilish vaqti) 10 daqiqadan oldin;
   * - rejalashtirilgan qo‘ng‘iroq — mijoz aytgan vaqt (operatori bor `CALLBACK`) o‘tgan.
   * Avtomatik qayta urinishlar (javob bermadi) kirmaydi [taklif]: ular navbatning boshida turadi.
   * Tekshiruvdagi va dublikat lidlar kirmaydi. Eng uzoq kutayotgani tepada.
   */
  async redList(now = new Date()): Promise<RedListDto> {
    const grace = new Date(
      now.getTime() - QUEUE_RULES.callbackGraceMinutes * MINUTE,
    );
    const newBefore = new Date(
      now.getTime() - RED_LIST_NEW_WAIT_MINUTES * MINUTE,
    );
    const rows = (await this.db.query(
      `WITH queue AS (${QUEUE_SQL})
       SELECT l.id::text AS id, l.name, l.product_id::text AS "productId", l.status, l.attempts,
              l.operator_id::text AS "operatorId", s.state AS "operatorState", q.pos::int AS pos,
              CASE WHEN l.status = 'NEW' THEN 'NEW_WAITING' ELSE 'CALLBACK_OVERDUE' END AS reason,
              CASE WHEN l.status = 'NEW' THEN COALESCE(l.next_attempt_at, l.created_at) ELSE l.next_attempt_at END AS since
         FROM lead.lead l
         LEFT JOIN queue q ON q.id = l.id
         LEFT JOIN lead.operator_state s ON s.operator_id = l.operator_id
        WHERE l.is_deleted = false AND l.review_reason IS NULL AND l.merged_into_id IS NULL
          AND (
            (l.status = 'NEW' AND COALESCE(l.next_attempt_at, l.created_at) <= $3)
            OR (l.status = 'CALLBACK' AND l.operator_id IS NOT NULL AND l.next_attempt_at < $1)
          )
        ORDER BY since ASC, l.id ASC`,
      [now, grace, newBefore],
    )) as Array<{
      id: string;
      name: string;
      productId: string;
      status: LeadStatus;
      attempts: number;
      operatorId: string | null;
      operatorState: OperatorWorkState | null;
      pos: number | null;
      reason: RedListReason;
      since: Date;
    }>;
    const [{ size }] = (await this.db.query(
      `SELECT count(*)::int AS size FROM (${QUEUE_SQL}) queue`,
      [now, grace],
    )) as Array<{ size: number }>;
    const names = await this.productNames(rows.map((r) => r.productId));
    const items: RedListItemDto[] = rows.map((r) => {
      const since = new Date(r.since);
      const inQueue = r.pos !== null;
      return {
        leadId: r.id,
        customerName: r.name,
        productId: r.productId,
        productName: names.get(r.productId) ?? '',
        reason: r.reason,
        status: r.status,
        since,
        waitingMinutes: Math.floor((now.getTime() - since.getTime()) / MINUTE),
        operatorId: r.operatorId,
        operatorState: r.operatorId
          ? (r.operatorState ?? OperatorWorkState.OFFLINE)
          : null,
        queuePosition: inQueue ? r.pos : null,
        returnsToQueueAt:
          r.reason === RedListReason.CALLBACK_OVERDUE && !inQueue
            ? new Date(
                since.getTime() + QUEUE_RULES.callbackGraceMinutes * MINUTE,
              )
            : null,
        attempts: r.attempts,
      };
    });
    return {
      generatedAt: now,
      queueSize: size,
      newWaiting: items.filter((i) => i.reason === RedListReason.NEW_WAITING)
        .length,
      callbackOverdue: items.filter(
        (i) => i.reason === RedListReason.CALLBACK_OVERDUE,
      ).length,
      items,
    };
  }

  /**
   * Lidni boshqa operatorga o‘tkazish (TZ 3: nazoratchi va admin; dizayn E-Nazoratchi-Qizil):
   * - faqat «Ishda» holatidagi operatorga (tanaffus va oflayn — 409);
   * - lid uning bronlariga tushadi: 10 daqiqa ichida natija kiritilmasa navbatga qaytadi (5-qoida);
   *   bron 5 ta chegaraga kiradi [taklif, dizayn «1/5 → 2/5»], chegara to‘lgan bo‘lsa — 409 (6-qoida);
   * - navbatdagi, qayta qo‘ng‘iroqdagi va boshqa operator bron qilgan lid o‘tkaziladi; yopilgan, tekshiruvdagi
   *   va dublikat lid — 409;
   * - lid tarixiga kim, qachon, kimdan kimga va sabab yoziladi.
   * Qulf tartibi `takeNext` bilan bir xil: operator qulfi → lid qatori.
   */
  async transfer(
    actorId: string,
    leadId: string,
    dto: TransferLeadDto,
    now = new Date(),
  ): Promise<LeadTransferDto> {
    if (!isLeadBigintId(leadId))
      throw new BadRequestException('leadId noto‘g‘ri');
    if (!isLeadBigintId(dto?.operatorId))
      throw new BadRequestException({ message: ['operatorId noto‘g‘ri'] });
    const target = dto.operatorId;
    const reason = dto.reason?.trim() || null;
    return this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `operator:${target}`,
      ]);
      const state = await m
        .getRepository(OperatorState)
        .findOne({ where: { operatorId: target } });
      if (state?.state === OperatorWorkState.BREAK)
        throw new ConflictException({
          message: 'Tanaffusdagi operatorga o‘tkazib bo‘lmaydi',
          errorCode: LeadErrorCode.OPERATOR_ON_BREAK,
        });
      if (state?.state !== OperatorWorkState.ONLINE)
        throw new ConflictException({
          message: 'Oflayn operatorga o‘tkazib bo‘lmaydi',
          errorCode: LeadErrorCode.OPERATOR_OFFLINE,
        });
      const leads = m.getRepository(Lead);
      const lead = await leads.findOne({
        where: { id: leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead) throw new NotFoundException('Lid topilmadi');
      if (
        !TRANSFERABLE.includes(lead.status) ||
        lead.reviewReason !== null ||
        lead.mergedIntoId !== null ||
        (lead.status === LeadStatus.BOOKED && lead.operatorId === target)
      )
        throw new ConflictException({
          message:
            lead.status === LeadStatus.BOOKED && lead.operatorId === target
              ? 'Lid allaqachon shu operatorda'
              : 'Bu lidni o‘tkazib bo‘lmaydi: navbatda yoki operatorda emas',
          errorCode: LeadErrorCode.LEAD_NOT_TRANSFERABLE,
        });
      // Mijoz aytgan vaqti hali kelmagan qo‘ng‘iroq egasida qoladi (4, 8-qoidalar): o‘tkazilsa egasi va eslatmasi yo‘qolardi
      if (
        lead.status === LeadStatus.CALLBACK &&
        lead.operatorId !== null &&
        lead.nextAttemptAt !== null &&
        lead.nextAttemptAt.getTime() > now.getTime()
      )
        throw new ConflictException({
          message:
            'Rejalashtirilgan qo‘ng‘iroq vaqti hali kelmagan — lid operatorida qoladi',
          errorCode: LeadErrorCode.LEAD_NOT_TRANSFERABLE,
        });
      const active = await leads.count({
        where: {
          operatorId: target,
          status: LeadStatus.BOOKED,
          bookedFromCallback: false,
          isDeleted: false,
        },
      });
      if (active >= QUEUE_RULES.maxNewBookings)
        throw new ConflictException({
          message: `Operatorda ${QUEUE_RULES.maxNewBookings} ta bron bor — boshqasini tanlang`,
          errorCode: LeadErrorCode.BOOKING_LIMIT_REACHED,
        });

      const from = lead.status;
      const fromOperator = lead.operatorId;
      lead.status = LeadStatus.BOOKED;
      lead.operatorId = target;
      lead.bookedUntil = bookingUntil(now);
      lead.bookedFromCallback = false;
      await leads.save(lead);
      const history = m.getRepository(LeadHistory);
      const row = await history.save(
        history.create({
          leadId: lead.id,
          fromStatus: from,
          toStatus: lead.status,
          actorId,
          field: 'transfer',
          oldValue: { operatorId: fromOperator },
          newValue: { operatorId: target, reason },
          note: `Boshqa operatorga o‘tkazildi: ${fromOperator ? `#${fromOperator}` : 'navbat'} → #${target}${reason ? ` (${reason})` : ''}`,
        }),
      );
      return {
        leadId: lead.id,
        at: row.createdAt,
        fromOperatorId: fromOperator,
        toOperatorId: target,
        actorId,
        reason,
      };
    });
  }

  /** Bir kunda (Toshkent) o‘tkazilgan lidlar — dizayndagi «Bugun boshqa operatorga o‘tkazilgan». */
  async transfers(date?: string, now = new Date()): Promise<LeadTransferDto[]> {
    const day = date ?? todayIn(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new BadRequestException('date YYYY-MM-DD bo‘lishi kerak');
    const rows = (await this.db.query(
      `SELECT lead_id::text AS "leadId", created_at AS at, old_value, new_value, actor_id::text AS "actorId"
         FROM lead.lead_history
        WHERE field = 'transfer' AND created_at >= $1 AND created_at < $2
        ORDER BY created_at DESC, id DESC`,
      [tashkentDayStart(day), tashkentDayStart(day, 1)],
    )) as Array<{
      leadId: string;
      at: Date;
      old_value: { operatorId?: string | null } | null;
      new_value: { operatorId?: string; reason?: string | null } | null;
      actorId: string;
    }>;
    return rows.map((r) => ({
      leadId: r.leadId,
      at: r.at,
      fromOperatorId: r.old_value?.operatorId ?? null,
      toOperatorId: String(r.new_value?.operatorId ?? ''),
      actorId: r.actorId,
      reason: r.new_value?.reason ?? null,
    }));
  }

  private async productNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const offers = await this.catalog
      .list({ productIds: [...new Set(ids)] })
      .catch(() => [] as CatalogOfferSnapshot[]);
    return new Map(offers.map((o) => [o.productId, o.name]));
  }
}

const todayIn = (now: Date) => {
  const p = tashkentParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};
