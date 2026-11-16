import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull, LessThan, Not } from 'typeorm';
import {
  AffiliatePostbackEvent,
  LEAD_EVENTS,
  LeadConfirmedEvent,
  LeadErrorCode,
  LeadOutcome,
  LeadResultAcceptedDto,
  LeadStatus,
  OperatorQueueSummaryDto,
  OperatorStateDto,
  OperatorWorkState,
  OrderCreateFailedEvent,
  OutboxEvent,
  SubmitLeadResultDto,
} from '@app/common';
import { Lead, LeadAttempt, LeadHistory, OperatorState } from './entities';
import { LeadAddressService } from './lead-address.service';
import { PostbackService } from './postback.service';
import {
  bookingUntil,
  callbackGraceStart,
  isContactExhausted,
  QUEUE_RULES,
  reminderHorizon,
  retryAt,
} from './lead-schedule';

/** 1-qoida zinapoyasi shu natijalar soniga qarab yuradi; «o‘ylab ko‘radi» (vaqtsiz) ham shu zinapoyada [taklif]. */
const RETRY_OUTCOMES = [
  LeadOutcome.NO_ANSWER,
  LeadOutcome.BUSY,
  LeadOutcome.PHONE_OFF,
  LeadOutcome.THINKING,
];

/**
 * Operator navbati (BE-13; TZ 5-bo‘lim 1–8-qoidalar, OPR-1, OPR-3). Hech bir lid yo‘qolmaydi:
 * bron va qayta qo‘ng‘iroq muddati o‘tsa `sweep` navbatga qaytaradi.
 */
@Injectable()
export class LeadQueueService {
  constructor(
    private readonly db: DataSource,
    private readonly address: LeadAddressService,
    @Optional() private readonly postback?: PostbackService,
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
    row.state = state;
    await repo.save(row);
    return {
      state,
      activeBookings: await this.activeNewBookings(this.db.manager, operatorId),
      maxBookings: QUEUE_RULES.maxNewBookings,
    };
  }

  /**
   * «Keyingi lid» (5–7-qoidalar): avval vaqti kelgan qayta qo‘ng‘iroqlar (o‘ziniki; boshqa operatorniki
   * 15 daqiqadan keyin) va qayta urinishlar, keyin eng yangi lidlar. Bron 10 daqiqa. Ikki operator bitta
   * lidni ololmaydi (SKIP LOCKED); bir operator parallel bosganda ham 5 tadan oshmaydi (advisory lock).
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

      const due = await this.pick(manager, 'due', operatorId, now);
      let lead = due;
      if (!lead) {
        if (
          (await this.activeNewBookings(manager, operatorId)) >=
          QUEUE_RULES.maxNewBookings
        )
          throw new ConflictException({
            message: `Bir vaqtda ${QUEUE_RULES.maxNewBookings} tadan ortiq yangi lid bron qilinmaydi`,
            errorCode: LeadErrorCode.BOOKING_LIMIT_REACHED,
          });
        lead = await this.pick(manager, 'fresh', operatorId, now);
      }
      if (!lead)
        throw new NotFoundException({
          message: 'Navbat bo‘sh',
          errorCode: LeadErrorCode.LEAD_QUEUE_EMPTY,
        });

      const from = lead.status;
      lead.bookedFromCallback = from === LeadStatus.CALLBACK;
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

  /** Natija (OPR-3; 1, 2-qoidalar). Lid shu operatorda bron bo‘lishi kerak. */
  async submitResult(
    operatorId: string,
    leadId: string,
    dto: SubmitLeadResultDto,
  ): Promise<LeadResultAcceptedDto> {
    return this.db.transaction(async (manager) => {
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

      await manager.getRepository(LeadAttempt).save(
        manager.getRepository(LeadAttempt).create({
          leadId,
          operatorId,
          outcome: dto.outcome,
          comment: dto.comment ?? null,
          callbackAt: dto.callbackAt ? new Date(dto.callbackAt) : null,
        }),
      );
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
          note = 'Tasdiqlandi';
          await this.enqueueConfirmed(manager, lead, now);
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
          const root = await leads.findOne({
            where: { id: dto.duplicateOfLeadId!, isDeleted: false },
          });
          if (!root || root.id === lead.id)
            throw new BadRequestException({
              message: ['duplicateOfLeadId bunday lid topilmadi'],
            });
          lead.status = LeadStatus.MERGED;
          lead.mergedIntoId = root.mergedIntoId ?? root.id;
          lead.nextAttemptAt = null;
          note = `Dublikat: ${lead.mergedIntoId} lidiga qo‘shildi`;
          break;
        }
        case LeadOutcome.CALL_LATER:
        case LeadOutcome.THINKING:
          if (dto.callbackAt) {
            lead.status = LeadStatus.CALLBACK;
            lead.nextAttemptAt = new Date(dto.callbackAt);
            lead.callbackRemindedAt = null;
            note = 'Rejalashtirilgan qo‘ng‘iroq (4-qoida: operatorda qoladi)';
            break;
          }
          note = this.scheduleRetry(
            lead,
            now,
            await this.retries(manager, leadId),
          );
          break;
        default:
          note = this.scheduleRetry(
            lead,
            now,
            await this.retries(manager, leadId),
          );
      }
      await leads.save(lead);
      await this.history(manager, lead, from, operatorId, note);
      return {
        leadId: lead.id,
        status: lead.status,
        nextAttemptAt: lead.nextAttemptAt?.toISOString() ?? null,
      };
    });
  }

  /** Nazoratchi: navbat hajmi va operatorlar holati (BE-13). Ism — identity bilan (BE-05 dan keyin). */
  async summary(): Promise<OperatorQueueSummaryDto> {
    const now = new Date();
    const leads = this.db.getRepository(Lead);
    const base = {
      isDeleted: false,
      reviewReason: IsNull(),
      mergedIntoId: IsNull(),
    };
    const [newLeads, dueCallbacks, booked, states] = await Promise.all([
      leads.count({ where: { ...base, status: LeadStatus.NEW, attempts: 0 } }),
      leads
        .createQueryBuilder('l')
        .where('l.is_deleted = false AND l.review_reason IS NULL')
        .andWhere(
          `((l.status = 'CALLBACK') OR (l.status = 'NEW' AND l.attempts > 0)) AND l.next_attempt_at <= :now`,
          { now },
        )
        .getCount(),
      leads.count({ where: { ...base, status: LeadStatus.BOOKED } }),
      this.db
        .getRepository(OperatorState)
        .find({ order: { operatorId: 'ASC' } }),
    ]);
    const operators = await Promise.all(
      states.map(async (s) => ({
        operatorId: s.operatorId,
        name: `#${s.operatorId}`,
        state: s.state,
        activeBookings: await this.activeNewBookings(
          this.db.manager,
          s.operatorId,
        ),
      })),
    );
    return { newLeads, dueCallbacks, booked, operators };
  }

  /**
   * Har daqiqada: muddati o‘tgan bron navbatga (5-qoida), eslatma (8-qoida), 3 kun o‘tgan urinilgan lid
   * «Aloqa bo‘lmadi» (2-qoida). Hali umuman qo‘ng‘iroq qilinmagan lid avtomatik yopilmaydi [taklif].
   */
  async sweep(
    now = new Date(),
  ): Promise<{ released: number; reminded: number; closed: number }> {
    return this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const expired = await leads
        .createQueryBuilder('l')
        .where('l.status = :booked AND l.booked_until < :now', {
          booked: LeadStatus.BOOKED,
          now,
        })
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      for (const lead of expired) {
        const toCallback = lead.bookedFromCallback;
        lead.status = toCallback ? LeadStatus.CALLBACK : LeadStatus.NEW;
        if (!toCallback) lead.operatorId = null;
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
          callbackRemindedAt: IsNull(),
          nextAttemptAt: LessThan(reminderHorizon(now)),
          isDeleted: false,
        },
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
          status: In([LeadStatus.NEW, LeadStatus.CALLBACK]),
          attempts: Not(0),
          expiresAt: LessThan(now),
          mergedIntoId: IsNull(),
          isDeleted: false,
        },
      });
      for (const lead of exhausted) {
        const from = lead.status;
        lead.status = LeadStatus.NO_CONTACT;
        lead.nextAttemptAt = null;
        lead.operatorId = null;
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

  /** `order.create-failed` (BE-18 → BE-13): tovar band qilinmadi — lid «qoldiq yo‘q» belgisi bilan navbatga (TC8). */
  async onOrderCreateFailed(event: OrderCreateFailedEvent): Promise<void> {
    await this.db.transaction(async (manager) => {
      const leads = manager.getRepository(Lead);
      const lead = await leads.findOne({
        where: { id: event.leadId, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lead || lead.status !== LeadStatus.CONFIRMED) return; // takroriy yoki eskirgan hodisa
      const now = new Date();
      lead.status = LeadStatus.NEW;
      lead.stockShortageAt = now;
      lead.operatorId = null;
      lead.nextAttemptAt = now;
      await leads.save(lead);
      await this.history(
        manager,
        lead,
        LeadStatus.CONFIRMED,
        null,
        'Buyurtma yaratilmadi: qoldiq yo‘q — navbatga qaytdi',
      );
    });
  }

  private async pick(
    manager: EntityManager,
    kind: 'due' | 'fresh',
    operatorId: string,
    now: Date,
  ): Promise<Lead | null> {
    const qb = manager
      .getRepository(Lead)
      .createQueryBuilder('l')
      .where('l.is_deleted = false')
      .andWhere('l.review_reason IS NULL')
      .andWhere('l.merged_into_id IS NULL');
    if (kind === 'due')
      qb.andWhere(
        `(
          (l.status = 'CALLBACK' AND l.next_attempt_at <= :now
            AND (l.operator_id = :op OR l.operator_id IS NULL OR l.next_attempt_at <= :grace))
          OR (l.status = 'NEW' AND l.attempts > 0 AND l.next_attempt_at <= :now)
        )`,
        { now, op: operatorId, grace: callbackGraceStart(now) },
      ).orderBy('l.next_attempt_at', 'ASC');
    else
      qb.andWhere(
        `l.status = 'NEW' AND l.attempts = 0 AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= :now)`,
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

  private retries(manager: EntityManager, leadId: string): Promise<number> {
    return manager
      .getRepository(LeadAttempt)
      .count({ where: { leadId, outcome: In(RETRY_OUTCOMES) } });
  }

  private scheduleRetry(lead: Lead, now: Date, retries: number): string {
    if (isContactExhausted(lead.attempts, lead.expiresAt, now)) {
      lead.status = LeadStatus.NO_CONTACT;
      lead.nextAttemptAt = null;
      lead.operatorId = null;
      return 'Aloqa bo‘lmadi (2-qoida: 6 urinish yoki 3 kun)';
    }
    lead.status = LeadStatus.NEW;
    lead.operatorId = null;
    lead.nextAttemptAt = retryAt(retries, now);
    return 'Qayta qo‘ng‘iroq rejalandi (1, 3-qoidalar)';
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

  private async enqueueConfirmed(
    manager: EntityManager,
    lead: Lead,
    now: Date,
  ): Promise<void> {
    const payload: LeadConfirmedEvent = {
      eventId: randomUUID(),
      leadId: lead.id,
      source: lead.source,
      streamId: lead.streamId,
      affiliateId: lead.affiliateId,
      productId: lead.productId,
      quantity: lead.quantity,
      salePrice: Number(lead.salePrice),
      customerName: lead.name,
      customerPhone: lead.phoneE164,
      regionSoato: lead.regionSoato!,
      districtSoato: lead.districtSoato!,
      addressLine: lead.addressLine!,
      whereDeliver: lead.whereDeliver!,
      confirmedBy: lead.addressConfirmedBy ?? lead.operatorId!,
      confirmedAt: now.toISOString(),
    };
    const outbox = manager.getRepository(OutboxEvent);
    await outbox.save(
      outbox.create({
        aggregateType: 'lead',
        aggregateId: lead.id,
        eventType: LEAD_EVENTS.CONFIRMED,
        payload,
      }),
    );
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
