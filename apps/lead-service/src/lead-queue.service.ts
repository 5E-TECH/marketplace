import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import {
  AffiliatePostbackEvent,
  LEAD_EVENTS,
  LeadConfirmedVia,
  LeadErrorCode,
  LeadOutcome,
  LeadResultAcceptedDto,
  LeadStatus,
  OperatorQueueSummaryDto,
  OperatorStateDto,
  OperatorWorkState,
  OrderCreateFailedEvent,
  OrderCreateFailedReason,
  OutboxEvent,
  SubmitLeadResultDto,
} from '@app/common';
import { Lead, LeadAttempt, LeadHistory, OperatorState } from './entities';
import { LeadAddressService } from './lead-address.service';
import { LeadOutboxRelayService } from './lead-outbox-relay.service';
import { PostbackService } from './postback.service';
import { ACTIVE_CALL, CallService } from './telephony/call.service';
import { UserNamesClient } from './user-names.client';
import { contactDeadline, LEAD_RULES } from './lead-rules';
import {
  bookingUntil,
  callbackGraceStart,
  clampToCallWindow,
  isContactExhausted,
  nextDayAt,
  QUEUE_RULES,
  reminderHorizon,
  retryAt,
} from './lead-schedule';
import { enqueueLeadConfirmed } from './lead-confirmed.event';
import { LeadUpsellService } from './lead-upsell.service';

/** 1-qoida zinapoyasi faqat aloqa bo‘lmagan natijalar soniga qarab yuradi (TZ 5-bo‘lim jadvali). */
const MISSED_OUTCOMES = [
  LeadOutcome.NO_ANSWER,
  LeadOutcome.BUSY,
  LeadOutcome.PHONE_OFF,
];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Operator navbati (BE-13; TZ 5-bo‘lim 1–8-qoidalar va natijalar jadvali, OPR-1, OPR-3). Hech bir lid yo‘qolmaydi.
 *
 * «Qayta qo‘ng‘iroq» (CALLBACK) ikki xil:
 * - egasi bor (`operator_id`) — mijoz aytgan vaqt («Keyinroq», «O‘ylab ko‘radi» vaqt bilan): operatorda qoladi, 15 daqiqadan
 *   keyin boshqasiga ham beriladi (4-qoida), 5 ta chegaraga kirmaydi (6-qoida), eslatma keladi (8-qoida);
 * - egasiz — avtomatik qayta urinish («javob bermadi», «band», «o‘chiq», vaqtsiz «o‘ylab ko‘radi»): navbatdagi har
 *   operatorga, 5 ta chegaraga kiradi.
 */

@Injectable()
export class LeadQueueService {
  constructor(
    private readonly db: DataSource,
    private readonly address: LeadAddressService,
    @Optional() private readonly postback?: PostbackService,
    // BE-18 TC1: tasdiqlangan lid commit dan keyin darhol checkout’ga (cron 10 s — zaxira)
    @Optional() private readonly relay?: LeadOutboxRelayService,
    // BE-25: navbat xulosasida operator ismi
    @Optional() private readonly userNames?: UserNamesClient,
    // BE-15: telefoniya (ulanmagan bo‘lsa natija qo‘lda kiritiladi)
    @Optional() private readonly calls?: CallService,
    // BE-45: qo‘shimcha tovar narxi tasdiqdan oldin
    @Optional() private readonly upsell?: LeadUpsellService,
  ) {}

  /** «Ishda / tanaffus / chiqdi». */
  async setState(
    operatorId: string,
    state: OperatorWorkState,
  ): Promise<OperatorStateDto> {
    const repo = this.db.getRepository(OperatorState);
    const row =
      (await repo.findOne({ where: { operatorId } })) ??
      repo.create({ operatorId });
    // holat o‘zgarmasa «qachondan beri» saqlanadi (takror bosish vaqtni nolga tushirmasin)
    if (row.state !== state || !row.stateSince) row.stateSince = new Date();
    row.state = state;
    await repo.save(row);
    return this.stateView(row);
  }

  /** BE-25 (FE-08): joriy holat — sahifa yangilanganda ekran «Oflayn» dan boshlanmasin. */
  async getState(operatorId: string): Promise<OperatorStateDto> {
    const row = await this.db
      .getRepository(OperatorState)
      .findOne({ where: { operatorId } });
    return this.stateView(
      row ?? { operatorId, state: OperatorWorkState.OFFLINE, stateSince: null },
    );
  }

  private async stateView(
    row: Pick<OperatorState, 'operatorId' | 'state' | 'stateSince'>,
  ): Promise<OperatorStateDto> {
    return {
      state: row.state,
      activeBookings: await this.activeNewBookings(
        this.db.manager,
        row.operatorId,
      ),
      maxBookings: QUEUE_RULES.maxNewBookings,
      since: row.stateSince?.toISOString() ?? null,
      callEnabled: (await this.calls?.enabledFor(row.operatorId)) ?? false,
    };
  }

  /**
   * «Keyingi lid» (5–7-qoidalar): avval vaqti kelgan qayta qo‘ng‘iroqlar, keyin eng yangi lidlar. Bron 10 daqiqa.
   * Ikki operator bitta lidni ololmaydi (SKIP LOCKED); 5 ta chegara oshmaydi (operator advisory lock): chegara to‘lsa
   * faqat mijoz aytgan (egasi bor) qayta qo‘ng‘iroq beriladi.
   */
  async takeNext(operatorId: string): Promise<string> {
    return this.db.transaction(async (manager) => {
      const state = await manager
        .getRepository(OperatorState)
        .findOne({ where: { operatorId } });
      if (state?.state === OperatorWorkState.BREAK)
        throw new ConflictException({
          message: 'Tanaffusda yangi lid berilmaydi',
          errorCode: LeadErrorCode.OPERATOR_ON_BREAK,
        });
      if (state?.state !== OperatorWorkState.ONLINE)
        throw new ConflictException({
          message: 'Avval «Ishda» holatini tanlang',
          errorCode: LeadErrorCode.OPERATOR_OFFLINE,
        });
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `operator:${operatorId}`,
      ]);
      const now = new Date();
      const atLimit =
        (await this.activeNewBookings(manager, operatorId)) >=
        QUEUE_RULES.maxNewBookings;

      let lead = await this.pick(manager, 'due', operatorId, now, atLimit);
      if (!lead && atLimit)
        throw new ConflictException({
          message: `Bir vaqtda ${QUEUE_RULES.maxNewBookings} tadan ortiq yangi lid bron qilinmaydi`,
          errorCode: LeadErrorCode.BOOKING_LIMIT_REACHED,
        });
      if (!lead)
        lead = await this.pick(manager, 'fresh', operatorId, now, atLimit);
      if (!lead)
        throw new NotFoundException({
          message: 'Navbat bo‘sh',
          errorCode: LeadErrorCode.LEAD_QUEUE_EMPTY,
        });

      const from = lead.status;
      // 6-qoida: faqat mijoz aytgan (egasi bor) qayta qo‘ng‘iroq chegaraga kirmaydi.
      lead.bookedFromCallback =
        from === LeadStatus.CALLBACK && lead.operatorId !== null;
      lead.status = LeadStatus.BOOKED;
      lead.operatorId = operatorId;
      lead.bookedUntil = bookingUntil(now);
      await manager.getRepository(Lead).save(lead);
      await this.history(
        manager,
        lead,
        from,
        operatorId,
        'Operator oldi (bron 10 daqiqa)',
      );
      return lead.id;
    });
  }

  /** Natija (OPR-3; TZ 5-bo‘lim natijalar jadvali, 1–3-qoidalar). Lid shu operatorda bron bo‘lishi kerak. */
  async submitResult(
    operatorId: string,
    leadId: string,
    dto: SubmitLeadResultDto,
  ): Promise<LeadResultAcceptedDto> {
    // BE-45: qo‘shimcha tovar narxi o‘zgargan bo‘lsa — 409, operator mijozga yangi summani aytadi
    if (dto?.outcome === LeadOutcome.CONFIRMED)
      await this.upsell?.refreshPrices(operatorId, leadId);
    const accepted = await this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const lead = await leads.findOne({
        where: { id: leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !lead ||
        lead.status !== LeadStatus.BOOKED ||
        lead.operatorId !== operatorId
      )
        throw new NotFoundException('Lid topilmadi yoki bu operatorda emas');
      const now = new Date();
      this.validate(dto, now);
      if (dto.outcome === LeadOutcome.CONFIRMED)
        this.address.assertConfirmable(lead);

      // BE-15: TEL-4 — «javob bermadi», «band», «o‘chiq» server holatidan; TEL-3 — qo‘ng‘iroq urinishga bog‘lanadi
      const call = await this.calls?.checkResult(
        manager,
        lead,
        operatorId,
        dto.outcome,
      );
      const attempt = await manager.getRepository(LeadAttempt).save(
        manager.getRepository(LeadAttempt).create({
          leadId,
          operatorId,
          callId: call?.shown?.id ?? null,
          outcome: dto.outcome,
          comment: dto.comment ?? null,
          callbackAt: dto.callbackAt ? new Date(dto.callbackAt) : null,
        }),
      );
      if (call) await this.calls!.link(manager, call.calls, attempt.id);
      const from = lead.status;
      lead.attempts += 1;
      lead.bookedUntil = null;
      lead.bookedFromCallback = false;
      if (dto.quantity !== undefined) lead.quantity = dto.quantity;
      let note: string;

      switch (dto.outcome) {
        case LeadOutcome.CONFIRMED:
          lead.status = LeadStatus.CONFIRMED;
          lead.nextAttemptAt = null;
          lead.stockShortageAt = null;
          lead.confirmedAt = now; // BE-28: tasdiq kuni va operatori (statistika)
          lead.confirmedBy = operatorId;
          lead.confirmedVia = LeadConfirmedVia.OPERATOR;
          note = 'Tasdiqlandi';
          await this.enqueueConfirmed(manager, lead, operatorId, now);
          await this.postback?.enqueue(
            manager,
            lead,
            AffiliatePostbackEvent.CONFIRMED,
          );
          break;
        case LeadOutcome.REJECTED:
          lead.status = LeadStatus.REJECTED;
          lead.rejectReason = dto.rejectReason!;
          lead.nextAttemptAt = null;
          note = 'Rad etildi';
          await this.postback?.enqueue(
            manager,
            lead,
            AffiliatePostbackEvent.REJECTED,
          );
          break;
        case LeadOutcome.INVALID:
          lead.status = LeadStatus.INVALID;
          lead.nextAttemptAt = null;
          note = 'Yaroqsiz';
          break;
        case LeadOutcome.DUPLICATE: {
          const root = await this.duplicateRoot(
            manager,
            lead,
            dto.duplicateOfLeadId!,
          );
          lead.status = LeadStatus.MERGED;
          lead.mergedIntoId = root.id;
          lead.nextAttemptAt = null;
          note = `Dublikat: ${root.id} lidiga qo‘shildi`;
          break;
        }
        case LeadOutcome.CALL_LATER:
        case LeadOutcome.THINKING:
          if (dto.callbackAt) {
            // Mijoz aytgan vaqt: operatorda qoladi (4-qoida), 09:00–21:00 oynasiga suriladi (3-qoida).
            // Aloqa bo‘ldi — 3 kunlik muddat shu vaqtdan qayta boshlanadi [taklif].
            const at = clampToCallWindow(new Date(dto.callbackAt));
            lead.status = LeadStatus.CALLBACK;
            lead.nextAttemptAt = at;
            lead.callbackRemindedAt = null;
            lead.expiresAt = laterOf(lead.expiresAt, contactDeadline(at));
            note = 'Rejalashtirilgan qo‘ng‘iroq (4-qoida: operatorda qoladi)';
            break;
          }
          // «O‘ylab ko‘radi», vaqt tanlanmadi — ertasi kuni (TZ 5-bo‘lim jadvali)
          lead.status = LeadStatus.CALLBACK;
          lead.operatorId = null;
          lead.nextAttemptAt = nextDayAt(now);
          note = 'O‘ylab ko‘radi: ertasi kuni qayta qo‘ng‘iroq';
          break;
        default: {
          if (isContactExhausted(lead.attempts, lead.expiresAt, now)) {
            lead.status = LeadStatus.NO_CONTACT;
            lead.nextAttemptAt = null;
            lead.operatorId = null;
            note = 'Aloqa bo‘lmadi (2-qoida: 6 urinish yoki 3 kun)';
            break;
          }
          const missed = await this.missedInWindow(manager, lead);
          lead.status = LeadStatus.CALLBACK;
          lead.operatorId = null;
          lead.nextAttemptAt = retryAt(missed, now);
          note = 'Qayta qo‘ng‘iroq rejalandi (1, 3-qoidalar)';
        }
      }
      await leads.save(lead);
      await this.history(manager, lead, from, operatorId, note);
      return {
        leadId: lead.id,
        status: lead.status,
        nextAttemptAt: lead.nextAttemptAt?.toISOString() ?? null,
      };
    });
    if (accepted.status === LeadStatus.CONFIRMED) this.relay?.trigger();
    return accepted;
  }

  /** Nazoratchi: navbat hajmi va operatorlar holati (BE-13). Ism — identity bilan (BE-05 dan keyin). */
  async summary(
    options: { operatorView?: boolean } = {},
  ): Promise<OperatorQueueSummaryDto> {
    const now = new Date();
    const leads = this.db.getRepository(Lead);
    const base = {
      isDeleted: false,
      reviewReason: IsNull(),
      mergedIntoId: IsNull(),
    };
    const [newLeads, dueCallbacks, booked, states] = await Promise.all([
      leads.count({ where: { ...base, status: LeadStatus.NEW } }),
      leads.count({
        where: {
          ...base,
          status: LeadStatus.CALLBACK,
          nextAttemptAt: LessThan(now),
        },
      }),
      leads.count({ where: { ...base, status: LeadStatus.BOOKED } }),
      // operator ish joyida boshqa operatorlar holati ko‘rsatilmaydi (FE-08 taklifi)
      options.operatorView
        ? Promise.resolve([] as OperatorState[])
        : this.db
            .getRepository(OperatorState)
            .find({ order: { operatorId: 'ASC' } }),
    ]);
    const nameOf =
      this.userNames && states.length
        ? await this.userNames.resolve(states.map((s) => s.operatorId))
        : (id: string) => `#${id}`;
    const ids = states.map((s) => s.operatorId);
    const [scheduled, activity] = await Promise.all([
      this.scheduledCalls(ids),
      ids.length ? this.calls?.activity(ids) : undefined,
    ]);
    const operators = await Promise.all(
      states.map(async (s) => ({
        operatorId: s.operatorId,
        name: nameOf(s.operatorId),
        state: s.state,
        activeBookings: await this.activeNewBookings(
          this.db.manager,
          s.operatorId,
        ),
        maxBookings: QUEUE_RULES.maxNewBookings,
        scheduledCalls: scheduled.get(s.operatorId) ?? 0,
        activity: activity?.get(s.operatorId) ?? null,
      })),
    );
    return { newLeads, dueCallbacks, booked, operators };
  }

  /** Mijoz aytgan vaqtdagi (egasi bor) qo‘ng‘iroqlar soni — operator bo‘yicha (BE-25, FE-26). */
  private async scheduledCalls(
    operatorIds: string[],
  ): Promise<Map<string, number>> {
    if (!operatorIds.length) return new Map();
    const rows = (await this.db.query(
      `SELECT operator_id::text AS id, count(*)::int AS n FROM lead.lead
        WHERE status = 'CALLBACK' AND operator_id = ANY($1::bigint[])
          AND is_deleted = false AND review_reason IS NULL AND merged_into_id IS NULL
        GROUP BY operator_id`,
      [operatorIds],
    )) as Array<{ id: string; n: number }>;
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  /**
   * Har daqiqada: muddati o‘tgan bron navbatga (5-qoida), eslatma (8-qoida), 3 kun o‘tgan avtomatik qayta urinish
   * «Aloqa bo‘lmadi» (2-qoida). Mijoz aytgan qayta qo‘ng‘iroq va hali qo‘ng‘iroq qilinmagan lid avtomatik yopilmaydi [taklif].
   * Har qadam o‘z qatorlarini qulflaydi (SKIP LOCKED) — bir nechta nusxa bir qatorni ikki marta ishlamaydi.
   */
  async sweep(
    now = new Date(),
  ): Promise<{ released: number; reminded: number; closed: number }> {
    return this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const locked = {
        mode: 'pessimistic_write' as const,
        onLocked: 'skip_locked' as const,
      };

      // BE-15: suhbat ketayotgan lid navbatga qaytmaydi [taklif] — boshqa operator o‘sha mijozga qo‘ng‘iroq qilib qo‘ymasin
      const expired = await leads
        .createQueryBuilder('l')
        .setLock(locked.mode)
        .setOnLocked(locked.onLocked)
        .where('l.status = :booked AND l.booked_until < :now', {
          booked: LeadStatus.BOOKED,
          now,
        })
        .andWhere('l.is_deleted = false')
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM lead.call c
             WHERE c.lead_id = l.id AND c.operator_id = l.operator_id AND ${ACTIVE_CALL})`,
        )
        .getMany();
      for (const lead of expired) {
        if (lead.bookedFromCallback) {
          lead.status = LeadStatus.CALLBACK; // egasi qoladi (4-qoida)
        } else {
          lead.status =
            lead.attempts > 0 ? LeadStatus.CALLBACK : LeadStatus.NEW;
          lead.operatorId = null;
        }
        lead.bookedUntil = null;
        lead.bookedFromCallback = false;
        await leads.save(lead);
        await this.history(
          manager,
          lead,
          LeadStatus.BOOKED,
          null,
          'Bron muddati tugadi, navbatga qaytdi (5-qoida)',
        );
      }

      const remind = await leads.find({
        where: {
          status: LeadStatus.CALLBACK,
          operatorId: Not(IsNull()),
          callbackRemindedAt: IsNull(),
          nextAttemptAt: LessThan(reminderHorizon(now)),
          isDeleted: false,
        },
        lock: locked,
      });
      const outbox = manager.getRepository(OutboxEvent);
      for (const lead of remind) {
        lead.callbackRemindedAt = now;
        await leads.save(lead);
        await outbox.save(
          outbox.create({
            aggregateType: 'lead',
            aggregateId: lead.id,
            eventType: LEAD_EVENTS.CALLBACK_REMINDER,
            payload: {
              eventId: randomUUID(),
              leadId: lead.id,
              operatorId: lead.operatorId,
              callbackAt: lead.nextAttemptAt?.toISOString(),
            },
          }),
        );
      }

      const exhausted = await leads.find({
        where: {
          status: LeadStatus.CALLBACK,
          operatorId: IsNull(),
          attempts: Not(0),
          expiresAt: LessThan(now),
          mergedIntoId: IsNull(),
          isDeleted: false,
        },
        lock: locked,
      });
      for (const lead of exhausted) {
        const from = lead.status;
        lead.status = LeadStatus.NO_CONTACT;
        lead.nextAttemptAt = null;
        await leads.save(lead);
        await this.history(
          manager,
          lead,
          from,
          null,
          'Aloqa bo‘lmadi: 3 kun o‘tdi (2-qoida)',
        );
      }
      return {
        released: expired.length,
        reminded: remind.length,
        closed: exhausted.length,
      };
    });
  }

  /**
   * `order.create-failed` (BE-18 → BE-13): tovar band qilinmadi — lid «qoldiq yo‘q» belgisi bilan navbatning boshiga
   * (vaqti kelgan qayta qo‘ng‘iroq), yangi 3 kunlik aloqa oynasi bilan (TC8; YOL-04 «lid yo‘qolmaydi»).
   */
  async onOrderCreateFailed(event: OrderCreateFailedEvent): Promise<void> {
    await this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const lead = await leads.findOne({
        where: { id: event.leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead || lead.status !== LeadStatus.CONFIRMED) return; // takroriy yoki eskirgan hodisa
      // BE-28: buyurtmasi bor yoki hodisadan keyin qayta tasdiqlangan lid — eskirgan (takror yuborilgan) hodisa
      const failedAt = new Date(event.at);
      if (
        lead.orderId ||
        (lead.confirmedAt &&
          !Number.isNaN(failedAt.getTime()) &&
          failedAt < lead.confirmedAt)
      )
        return;
      const now = new Date();
      // BE-18: «qoldiq yo‘q» belgisi faqat qoldiq sababida; boshqa sabab (offer sotuvdan olingan, ma’lumot xato) —
      // lid shunchaki navbatga qaytadi [taklif]
      const outOfStock =
        (event.reason ?? OrderCreateFailedReason.OUT_OF_STOCK) ===
        OrderCreateFailedReason.OUT_OF_STOCK;
      lead.status = LeadStatus.CALLBACK;
      if (outOfStock) lead.stockShortageAt = now;
      lead.operatorId = null;
      lead.confirmedAt = null; // BE-28: buyurtma yaratilmadi — «Tasdiqlangan» ga kirmaydi
      lead.confirmedBy = null;
      lead.attempts = 0;
      lead.nextAttemptAt = clampToCallWindow(now);
      lead.expiresAt = contactDeadline(now);
      await leads.save(lead);
      await this.history(
        manager,
        lead,
        LeadStatus.CONFIRMED,
        null,
        outOfStock
          ? 'Buyurtma yaratilmadi: qoldiq yo‘q — navbatga qaytdi'
          : event.reason === OrderCreateFailedReason.OFFER_UNAVAILABLE
            ? 'Buyurtma yaratilmadi: mahsulot sotuvda emas — navbatga qaytdi'
            : event.reason === OrderCreateFailedReason.PRICE_CHANGED
              ? 'Buyurtma yaratilmadi: narx oshgan (sahifa narxi tasdiqlangan narxdan past) — navbatga qaytdi'
              : 'Buyurtma yaratilmadi: buyurtma ma’lumoti xato — navbatga qaytdi',
      );
    });
  }

  private async pick(
    manager: EntityManager,
    kind: 'due' | 'fresh',
    operatorId: string,
    now: Date,
    atLimit: boolean,
  ): Promise<Lead | null> {
    const qb = manager
      .getRepository(Lead)
      .createQueryBuilder('l')
      .where('l.is_deleted = false')
      .andWhere('l.review_reason IS NULL')
      .andWhere('l.merged_into_id IS NULL');
    if (kind === 'due') {
      qb.andWhere(
        `l.status = 'CALLBACK' AND l.next_attempt_at <= :now
          AND (l.operator_id = :op OR l.operator_id IS NULL OR l.next_attempt_at <= :grace)`,
        { now, op: operatorId, grace: callbackGraceStart(now) },
      );
      // Chegara to‘lgan: faqat mijoz aytgan (egasi bor) qayta qo‘ng‘iroq (6-qoida).
      if (atLimit) qb.andWhere('l.operator_id IS NOT NULL');
      qb.orderBy('l.next_attempt_at', 'ASC');
    } else
      qb.andWhere(
        `l.status = 'NEW' AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= :now)`,
        { now },
      ).orderBy('l.created_at', 'DESC');
    return qb
      .addOrderBy('l.id', 'DESC')
      .limit(1)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getOne();
  }

  private activeNewBookings(
    manager: EntityManager,
    operatorId: string,
  ): Promise<number> {
    return manager.getRepository(Lead).count({
      where: {
        operatorId,
        status: LeadStatus.BOOKED,
        bookedFromCallback: false,
        isDeleted: false,
      },
    });
  }

  /** Joriy aloqa oynasidagi aloqasiz natijalar (oyna — `expires_at` dan 3 kun oldin; qayta ochilganda yangilanadi). */
  private missedInWindow(manager: EntityManager, lead: Lead): Promise<number> {
    const where: Record<string, unknown> = {
      leadId: lead.id,
      outcome: In(MISSED_OUTCOMES),
    };
    if (lead.expiresAt)
      where.createdAt = MoreThanOrEqual(
        new Date(
          lead.expiresAt.getTime() - LEAD_RULES.contactWindowDays * DAY_MS,
        ),
      );
    return manager.getRepository(LeadAttempt).count({ where });
  }

  /** Dublikat: avvalgi lid shu raqam va mahsulotda bo‘lishi kerak; zanjir oxiridagi asosiy lidga qo‘shiladi. */
  private async duplicateRoot(
    manager: EntityManager,
    lead: Lead,
    duplicateOfLeadId: string,
  ): Promise<Lead> {
    const leads = manager.getRepository(Lead);
    let root = await leads.findOne({
      where: { id: duplicateOfLeadId, isDeleted: false },
    });
    if (root?.mergedIntoId)
      root = await leads.findOne({
        where: { id: root.mergedIntoId, isDeleted: false },
      });
    if (
      !root ||
      root.id === lead.id ||
      root.phoneE164 !== lead.phoneE164 ||
      root.productId !== lead.productId
    )
      throw new BadRequestException({
        message: [
          'duplicateOfLeadId shu raqam va mahsulotdagi boshqa lid bo‘lishi kerak',
        ],
      });
    return root;
  }

  private validate(dto: SubmitLeadResultDto, now: Date): void {
    if (dto.outcome === LeadOutcome.REJECTED && !dto.rejectReason)
      throw new BadRequestException({
        message: ['rejectReason rad sababi majburiy'],
      });
    if (dto.outcome === LeadOutcome.CALL_LATER && !dto.callbackAt)
      throw new BadRequestException({
        message: ['callbackAt qayta qo‘ng‘iroq vaqti majburiy'],
      });
    if (dto.callbackAt && new Date(dto.callbackAt).getTime() <= now.getTime())
      throw new BadRequestException({
        message: ['callbackAt kelajakdagi vaqt bo‘lishi kerak'],
      });
    if (dto.outcome === LeadOutcome.DUPLICATE && !dto.duplicateOfLeadId)
      throw new BadRequestException({
        message: ['duplicateOfLeadId avvalgi lid ID si majburiy'],
      });
  }

  private enqueueConfirmed(
    manager: EntityManager,
    lead: Lead,
    operatorId: string,
    now: Date,
  ): Promise<void> {
    return enqueueLeadConfirmed(manager, lead, {
      confirmedBy: operatorId,
      via: LeadConfirmedVia.OPERATOR,
      now,
    });
  }

  private async history(
    manager: EntityManager,
    lead: Lead,
    from: Lead['status'] | null,
    actorId: string | null,
    note: string,
  ): Promise<void> {
    const repo = manager.getRepository(LeadHistory);
    await repo.save(
      repo.create({
        leadId: lead.id,
        fromStatus: from,
        toStatus: lead.status,
        actorId,
        note,
      }),
    );
  }
}

const laterOf = (a: Date | null, b: Date) =>
  a && a.getTime() > b.getTime() ? a : b;
