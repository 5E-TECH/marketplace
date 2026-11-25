import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  CALL_OUTCOME,
  CallChannel,
  CallCompletedEvent,
  CallEndReason,
  CallErrorCode,
  CallListQueryDto,
  CallPageDto,
  CallRecordingState,
  CallStatus,
  CallStatusEvent,
  LeadAttemptCallDto,
  LeadCallDto,
  LeadOutcome,
  LeadStatus,
  OperatorActivityDto,
  OperatorActivityKind,
  OperatorPhoneDto,
  OperatorPhoneKind,
  RECORDING_ALL_ROLES,
  RECORDING_DOWNLOAD_ROLES,
  RecordingAccess,
  RecordingMode,
  RecordingReadyEvent,
  Role,
  SERVER_OUTCOMES,
  SetOperatorPhoneDto,
} from '@app/common';
import { Call, Lead, OperatorPhone } from '../entities';
import { QUEUE_RULES, tashkentDayStart } from '../lead-schedule';
import { UserNamesClient } from '../user-names.client';
import {
  TelephonyProvider,
  TelephonyRejectedError,
} from './telephony.provider';

const EXTENSION = /^\d{2,10}$/;
const MOBILE = /^\+998\d{9}$/;
const DEFAULT_GRACE_MINUTES = 30;
const ACTIVE_INDEX = 'uq_lead_call_operator_active';
const PHONE_INDEX = 'uq_lead_operator_phone_value';
/** Gateway javobni shuncha kutadi (`RPC_TIMEOUT_MS`): undan eski so‘rovni operator allaqachon xato deb ko‘rgan. */
const START_MAX_AGE_MS = 10_000;
/** Tugamagan va tugatish so‘ralmagan qo‘ng‘iroq; bir kundan eskisi — hodisasi yo‘qolgan. */
export const ACTIVE_CALL = `ended_at IS NULL AND hangup_requested_at IS NULL AND requested_at > now() - interval '1 day'`;
const ACTIVE_CALL_OF = (alias: string) =>
  ACTIVE_CALL.replace(
    /\b(ended_at|hangup_requested_at|requested_at)\b/g,
    `${alias}.$1`,
  );
/** Mijozgacha yetgan qo‘ng‘iroq natijasi — TEL-4 dalili. */
const REACHED: ReadonlySet<CallEndReason> = new Set([
  CallEndReason.ANSWERED,
  CallEndReason.NO_ANSWER,
  CallEndReason.BUSY,
  CallEndReason.UNREACHABLE,
]);

/** Bosqich tartibi: hodisalar navbatda almashib kelsa ham holat orqaga qaytmaydi. */
const RANK: Record<CallStatus, number> = {
  [CallStatus.REQUESTED]: 0,
  [CallStatus.RINGING_OPERATOR]: 1,
  [CallStatus.RINGING_CUSTOMER]: 2,
  [CallStatus.CONNECTED]: 3,
  [CallStatus.ENDED]: 4,
  [CallStatus.FAILED]: 4,
};

interface CallRow {
  id: string;
  leadId: string;
  operatorId: string;
  attemptId: string | null;
  customerName: string;
  channel: CallChannel;
  status: CallStatus;
  requestedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  endReason: CallEndReason | null;
  recording: CallRecordingState;
}

/**
 * Yozuv holati (TEL-3), `$1` — kutish daqiqasi. Suhbat bo‘lmagan qo‘ng‘iroqda yozuv kutilmaydi; hech qanday hodisa
 * kelmay qolgan qo‘ng‘iroq ham xato (webhook ishlamayapti — suhbat bo‘lgan-bo‘lmagani noma’lum). Tugash hodisasi
 * yo‘qolgan bo‘lsa — tugatish so‘ralgan vaqtdan yoki javobdan bir kun keyin (eng uzun qo‘ng‘iroq chegarasi) hisoblanadi.
 */
const RECORDING_STATE = `CASE
  WHEN c.recording_ready_at IS NOT NULL THEN 'READY'
  WHEN c.answered_at IS NULL AND (c.ended_at IS NOT NULL
       OR COALESCE(c.hangup_requested_at, c.requested_at) > now() - make_interval(mins => $1::int)) THEN 'NONE'
  WHEN c.answered_at IS NULL THEN 'MISSING'
  WHEN COALESCE(c.ended_at, c.hangup_requested_at) IS NULL
       AND c.answered_at > now() - interval '1 day' THEN 'LIVE'
  WHEN COALESCE(c.ended_at, c.hangup_requested_at, c.answered_at + interval '1 day')
       > now() - make_interval(mins => $1::int) THEN 'PENDING'
  ELSE 'MISSING' END`;

const CALL_SELECT = `SELECT c.id::text, c.lead_id::text AS "leadId", c.operator_id::text AS "operatorId",
    c.attempt_id::text AS "attemptId", l.name AS "customerName", c.channel, c.status,
    c.requested_at AS "requestedAt", c.answered_at AS "answeredAt", c.ended_at AS "endedAt",
    c.duration_seconds AS "durationSeconds", c.end_reason AS "endReason", ${RECORDING_STATE} AS recording
  FROM lead.call c JOIN lead.lead l ON l.id = c.lead_id`;

/**
 * Qo‘ng‘iroqlar (BE-15; TZ 6.4 TEL-1–5, TEL-7; OPR-6; T6). Provayder (EQ-02) ulanmagan bo‘lsa hammasi o‘chiq: natija
 * BE-13 dagidek qo‘lda kiritiladi.
 */
@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    private readonly db: DataSource,
    private readonly provider: TelephonyProvider,
    private readonly config: ConfigService,
    @Optional() private readonly names?: UserNamesClient,
  ) {}

  /** Operatorda «Qo‘ng‘iroq» tugmasi ishlaydimi: provayder ulangan va operatorga telefon biriktirilgan. */
  async enabledFor(
    operatorId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<boolean> {
    if (!this.provider.isConfigured()) return false;
    return manager
      .getRepository(OperatorPhone)
      .exists({ where: { operatorId } });
  }

  /**
   * OPR-6, T6: lid kartasidan qo‘ng‘iroq — provayder avval operatorga, keyin mijozga ulaydi. Raqam lid bo‘yicha shu yerda
   * olinadi, javobda yo‘q. Lid shu operatorning bronida bo‘lishi shart; bir operatorda bitta tugamagan qo‘ng‘iroq.
   */
  async start(
    operatorId: string,
    leadId: string,
    /** Operator bosgan vaqt (gateway): navbatda turib qolgan eski so‘rov kutilmaganda qo‘ng‘iroq qilmasin. */
    requestedAt: Date = new Date(),
  ): Promise<LeadCallDto> {
    if (
      !Number.isFinite(requestedAt.getTime()) ||
      Date.now() - requestedAt.getTime() > START_MAX_AGE_MS
    )
      throw new ConflictException({
        message: 'Qo‘ng‘iroq so‘rovi eskirdi — tugmani qayta bosing',
        errorCode: CallErrorCode.CALL_REQUEST_EXPIRED,
      });
    if (!this.provider.isConfigured())
      throw new ServiceUnavailableException({
        message: 'Telefoniya ulanmagan',
        errorCode: CallErrorCode.TELEPHONY_NOT_CONFIGURED,
      });
    const ref = randomUUID();
    const callerId = this.provider.callerId();
    const started = await this.db
      .transaction(async (manager) => {
        const lead = await manager.getRepository(Lead).findOne({
          where: { id: leadId, isDeleted: false },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !lead ||
          lead.status !== LeadStatus.BOOKED ||
          lead.operatorId !== operatorId ||
          !lead.bookedUntil ||
          lead.bookedUntil.getTime() <= Date.now()
        )
          throw new NotFoundException('Lid topilmadi yoki bu operatorda emas');
        // lid boshqa operatorga o‘tgan bo‘lsa ham mijoz bilan suhbat ketayotganda ikkinchi qo‘ng‘iroq boshlanmaydi
        const [busy] = (await manager.query(
          `SELECT 1 FROM lead.call WHERE lead_id = $1 AND operator_id <> $2 AND ${ACTIVE_CALL} LIMIT 1`,
          [leadId, operatorId],
        )) as unknown[];
        if (busy)
          throw new ConflictException({
            message: 'Bu mijoz bilan hozir boshqa operator gaplashmoqda',
            errorCode: CallErrorCode.CALL_ACTIVE,
          });
        const phone = await manager
          .getRepository(OperatorPhone)
          .findOne({ where: { operatorId } });
        if (!phone)
          throw new ConflictException({
            message:
              'Sizga telefon biriktirilmagan — admin ichki raqam yoki mobil raqam kiritadi',
            errorCode: CallErrorCode.OPERATOR_PHONE_MISSING,
          });
        const call = await manager.getRepository(Call).save(
          manager.getRepository(Call).create({
            ref,
            leadId,
            operatorId,
            channel:
              phone.kind === OperatorPhoneKind.MOBILE
                ? CallChannel.APP_BRIDGE
                : CallChannel.OFFICE,
            platformNumber: callerId,
            customerPhoneHash: this.phoneHash(lead.phoneE164),
            status: CallStatus.REQUESTED,
            // bron vaqti (`booked_until`) bilan bir soatda — TEL-4 dalili shu bilan solishtiriladi
            requestedAt: new Date(),
          }),
        );
        return {
          id: call.id,
          operator: { kind: phone.kind, value: phone.value },
          customer: lead.phoneE164,
        };
      })
      .catch((error: unknown) => {
        if (violates(error, ACTIVE_INDEX))
          throw new ConflictException({
            message: 'Tugamagan qo‘ng‘iroq bor — avval uni tugating',
            errorCode: CallErrorCode.CALL_ACTIVE,
          });
        throw error;
      });
    // provayderga so‘rov tranzaksiyadan tashqarida: qator qulfi HTTP kutmaydi, hodisa tez kelsa ham `ref` bazada
    try {
      const { providerCallId } = await this.provider.originate({
        callRef: ref,
        operator: started.operator,
        customer: started.customer,
        callerId,
      });
      if (providerCallId)
        await this.db
          .getRepository(Call)
          .update({ id: started.id }, { providerCallId });
    } catch (error) {
      const reason = String((error as Error)?.message ?? error).slice(0, 300);
      if (error instanceof TelephonyRejectedError) {
        await this.db.query(
          `UPDATE lead.call SET status = 'FAILED', end_reason = 'FAILED', ended_at = now(), failure = $2, updated_at = now()
            WHERE id = $1 AND ended_at IS NULL`,
          [started.id, reason],
        );
        this.logger.warn(`Qo‘ng‘iroq ${started.id} boshlanmadi: ${reason}`);
        throw new BadGatewayException({
          message: 'Telefoniya qo‘ng‘iroqni boshlamadi — qayta urinib ko‘ring',
          errorCode: CallErrorCode.TELEPHONY_FAILED,
        });
      }
      // natija noma’lum: qo‘ng‘iroq ketgan bo‘lishi mumkin — holatni provayder hodisasi hal qiladi, operator tugata oladi
      await this.db
        .getRepository(Call)
        .update({ id: started.id }, { failure: reason });
      this.logger.warn(`Qo‘ng‘iroq ${started.id} natijasi noma’lum: ${reason}`);
    }
    return this.one(started.id);
  }

  /** Operator faqat o‘z qo‘ng‘irog‘ini ko‘radi (ekran bosqichni shu yerdan so‘raydi). */
  async get(operatorId: string, callId: string): Promise<LeadCallDto> {
    const call = await this.one(callId);
    if (call.operatorId !== String(operatorId))
      throw new NotFoundException('Qo‘ng‘iroq topilmadi');
    return call;
  }

  /**
   * Operator tugatadi. Provayder `completed` yuborgach holat yopiladi; javob bermasa ham operator yangi qo‘ng‘iroq
   * boshlay oladi (`hangup_requested_at`).
   */
  async hangup(operatorId: string, callId: string): Promise<LeadCallDto> {
    const current = await this.get(operatorId, callId);
    if (current.endedAt) return current;
    await this.db.query(
      `UPDATE lead.call SET hangup_requested_at = COALESCE(hangup_requested_at, now()), updated_at = now()
        WHERE id = $1 AND ended_at IS NULL`,
      [callId],
    );
    const [{ ref }] = (await this.db.query(
      `SELECT ref FROM lead.call WHERE id = $1`,
      [callId],
    )) as Array<{ ref: string }>;
    if (this.provider.isConfigured()) await this.provider.hangup(ref);
    return this.one(callId);
  }

  // ------------------------------------------------------------------ provayder hodisalari

  /** `call.status`: bosqich faqat oldinga; tugagan qo‘ng‘iroq o‘zgarmaydi. */
  async onStatus(event: CallStatusEvent): Promise<void> {
    await this.apply(event, 'status', (call) => {
      if (call.endedAt || RANK[event.status] <= RANK[call.status]) return false;
      call.status = event.status;
      if (event.status === CallStatus.CONNECTED)
        call.answeredAt ??= new Date(event.at);
      return true;
    });
  }

  /** `call.completed` (TEL-3): javob, davomiylik, tugash sababi. Suhbat bo‘lgan bo‘lsa sabab — ANSWERED. */
  async onCompleted(event: CallCompletedEvent): Promise<void> {
    await this.apply(event, 'completed', (call) => {
      if (call.endedAt) return false;
      const answeredAt = event.answeredAt
        ? new Date(event.answeredAt)
        : call.answeredAt;
      const endedAt = new Date(event.at);
      call.status = CallStatus.ENDED;
      call.endedAt = endedAt;
      call.answeredAt = answeredAt;
      call.endReason = answeredAt ? CallEndReason.ANSWERED : event.endReason;
      call.durationSeconds = answeredAt
        ? (event.durationSeconds ??
          Math.max(
            0,
            Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000),
          ))
        : null;
      return true;
    });
  }

  /** `recording.ready`: yozuv kaliti; `completed` dan oldin ham kelishi mumkin. */
  async onRecordingReady(event: RecordingReadyEvent): Promise<void> {
    await this.apply(event, 'recording', (call) => {
      if (call.recordingReadyAt) return false;
      call.recordingRef = event.recordingRef;
      call.recordingReadyAt = new Date(event.at);
      return true;
    });
  }

  /** Bitta hodisa bir marta (`event_id`), qator qulfi bilan; noma’lum qo‘ng‘iroq — log va e’tiborsiz. */
  private async apply(
    event: { eventId: string; callRef: string },
    type: string,
    change: (call: Call) => boolean,
  ): Promise<void> {
    await this.db.transaction(async (manager) => {
      const calls = manager.getRepository(Call);
      const call = await calls.findOne({
        where: { ref: event.callRef },
        lock: { mode: 'pessimistic_write' },
      });
      if (!call) {
        this.logger.warn(
          `Noma’lum qo‘ng‘iroq hodisasi (${type}, ${event.callRef})`,
        );
        return;
      }
      const inserted = (await manager.query(
        `INSERT INTO lead.call_event (event_id, call_id, type) VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.eventId, call.id, type],
      )) as unknown[];
      if (!inserted.length) return;
      if (change(call)) await calls.save(call);
    });
  }

  // ------------------------------------------------------------------ natija (TEL-4)

  /**
   * Natija kiritilganda: shu bron davridagi qo‘ng‘iroqlar urinishga bog‘lanadi. Telefoniya ulangan operatorda «javob
   * bermadi», «band», «o‘chiq» qo‘lda kiritilmaydi — oxirgi tugagan qo‘ng‘iroqning server holati bilan bir xil bo‘lishi
   * shart (TEL-4). Javob: bog‘lanadigan qo‘ng‘iroqlar va urinishda ko‘rinadigani.
   */
  async checkResult(
    manager: EntityManager,
    lead: Pick<Lead, 'id' | 'bookedUntil'>,
    operatorId: string,
    outcome: LeadOutcome,
  ): Promise<{ calls: Call[]; shown: Call | null }> {
    const calls = await this.bookingCalls(manager, lead, operatorId);
    // urinishda ko‘rinadigan qo‘ng‘iroq: oxirgi suhbat, u yo‘q bo‘lsa mijozga yetib borgani, u ham yo‘q bo‘lsa oxirgisi
    const reached = calls.filter(
      (call) => call.endReason && REACHED.has(call.endReason),
    );
    const shown =
      calls.find((call) => call.answeredAt) ?? reached[0] ?? calls[0] ?? null;
    const result = { calls, shown };
    if (
      !SERVER_OUTCOMES.includes(outcome) ||
      !(await this.enabledFor(operatorId, manager))
    )
      return result;
    if (calls.some((call) => !call.endedAt && !call.hangupRequestedAt))
      throw new ConflictException({
        message: 'Qo‘ng‘iroq hali tugamagan',
        errorCode: CallErrorCode.CALL_ACTIVE,
      });
    // boshlanmagan, operator olmagan yoki o‘zi to‘xtatgan qo‘ng‘iroq mijoz holatini bildirmaydi
    const [latest] = reached;
    if (!latest)
      throw new ConflictException({
        message:
          'Avval qo‘ng‘iroq qiling: bu natija qo‘ng‘iroq holatidan olinadi (TEL-4)',
        errorCode: CallErrorCode.CALL_REQUIRED,
      });
    const suggested = CALL_OUTCOME[latest.endReason!] ?? null;
    if (suggested !== outcome)
      throw new ConflictException({
        message: suggested
          ? `Natija qo‘ng‘iroq holatiga mos emas: server «${suggested}» deb aniqladi`
          : 'Bu qo‘ng‘iroqda «javob bermadi», «band» yoki «o‘chiq» aniqlanmagan — boshqa natija tanlang yoki qayta qo‘ng‘iroq qiling',
        errorCode: CallErrorCode.CALL_OUTCOME_MISMATCH,
      });
    return { calls, shown: latest }; // urinish — shu holat dalili
  }

  /** Bron boshlangandan beri shu operator qilgan, hali natijaga bog‘lanmagan qo‘ng‘iroqlar, yangisi birinchi. */
  private async bookingCalls(
    manager: EntityManager,
    lead: Pick<Lead, 'id' | 'bookedUntil'>,
    operatorId: string,
  ): Promise<Call[]> {
    const since = lead.bookedUntil
      ? new Date(
          lead.bookedUntil.getTime() - QUEUE_RULES.bookingMinutes * 60_000,
        )
      : new Date(0);
    return manager
      .getRepository(Call)
      .createQueryBuilder('c')
      .setLock('pessimistic_write')
      .where('c.lead_id = :leadId AND c.operator_id = :operatorId', {
        leadId: lead.id,
        operatorId,
      })
      .andWhere('c.attempt_id IS NULL AND c.requested_at >= :since', { since })
      .orderBy('c.id', 'DESC')
      .getMany();
  }

  /** Qo‘ng‘iroqlarni saqlangan urinishga bog‘laydi. */
  async link(
    manager: EntityManager,
    calls: Call[],
    attemptId: string,
  ): Promise<void> {
    if (!calls.length) return;
    await manager.query(
      `UPDATE lead.call SET attempt_id = $1, updated_at = now() WHERE id = ANY($2::bigint[])`,
      [attemptId, calls.map((call) => call.id)],
    );
  }

  /** TEL-3: urinishlardagi qo‘ng‘iroqlar (`lead_attempt.call_id`) — lid kartasi va «Mening urinishlarim» uchun. */
  async forAttempts(
    callIds: Array<string | null>,
  ): Promise<Map<string, LeadAttemptCallDto>> {
    const ids = [...new Set(callIds.filter((id): id is string => !!id))].filter(
      (id) => /^\d+$/.test(id),
    );
    if (!ids.length) return new Map();
    const rows = (await this.db.query(
      `${CALL_SELECT} WHERE c.id = ANY($2::bigint[])`,
      [this.graceMinutes(), ids],
    )) as CallRow[];
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          startedAt: new Date(row.requestedAt).toISOString(),
          answered: row.answeredAt !== null,
          durationSeconds: row.durationSeconds,
          recording: row.recording,
        },
      ]),
    );
  }

  /**
   * Operatorlar hozir nima qilmoqda (BE-25, FE-26 o‘tkazish oynasi). Tugamagan qo‘ng‘iroq — bosqichi; shu bronda qo‘ng‘iroq
   * tugagan, natija hali kiritilmagan — WRAP_UP; aks holda IDLE. Telefoniya ulanmagan — null (noma’lum).
   */
  async activity(
    operatorIds: string[],
  ): Promise<Map<string, OperatorActivityDto> | null> {
    if (!this.provider.isConfigured()) return null;
    const rows = (await this.db.query(
      `SELECT DISTINCT ON (c.operator_id) c.operator_id::text AS "operatorId", c.lead_id::text AS "leadId", c.status,
              c.requested_at AS "requestedAt", c.answered_at AS "answeredAt", c.ended_at AS "endedAt",
              (${ACTIVE_CALL_OF('c')}) AS active
         FROM lead.call c
         LEFT JOIN lead.lead l ON l.id = c.lead_id
        WHERE c.operator_id = ANY($1::bigint[])
          AND ((${ACTIVE_CALL_OF('c')})
               OR (c.ended_at IS NOT NULL AND c.attempt_id IS NULL AND l.status = 'BOOKED'
                   AND l.operator_id = c.operator_id
                   AND c.requested_at >= l.booked_until - make_interval(mins => $2::int)))
        ORDER BY c.operator_id, active DESC, c.id DESC`,
      [operatorIds, QUEUE_RULES.bookingMinutes],
    )) as Array<{
      operatorId: string;
      leadId: string;
      status: CallStatus;
      requestedAt: Date;
      answeredAt: Date | null;
      endedAt: Date | null;
      active: boolean;
    }>;
    const result = new Map<string, OperatorActivityDto>(
      operatorIds.map((id) => [
        id,
        { kind: OperatorActivityKind.IDLE, leadId: null, since: null },
      ]),
    );
    for (const row of rows) {
      const kind = !row.active
        ? OperatorActivityKind.WRAP_UP
        : row.status === CallStatus.CONNECTED
          ? OperatorActivityKind.IN_CALL
          : row.status === CallStatus.RINGING_CUSTOMER
            ? OperatorActivityKind.RINGING
            : OperatorActivityKind.CONNECTING;
      const since =
        kind === OperatorActivityKind.WRAP_UP
          ? row.endedAt
          : kind === OperatorActivityKind.IN_CALL
            ? row.answeredAt
            : row.requestedAt;
      result.set(row.operatorId, {
        kind,
        leadId: row.leadId,
        since: since ? new Date(since).toISOString() : null,
      });
    }
    return result;
  }

  /** Lid bo‘yicha tugamagan qo‘ng‘iroq (shu operatorning): bronni bo‘shatish va kartadagi «suhbatda» uchun. */
  async activeFor(
    leadId: string,
    operatorId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<{ startedAt: Date; answeredAt: Date | null } | null> {
    const [row] = (await manager.query(
      `SELECT requested_at AS "startedAt", answered_at AS "answeredAt" FROM lead.call
        WHERE lead_id = $1 AND operator_id = $2 AND ${ACTIVE_CALL} ORDER BY id DESC LIMIT 1`,
      [leadId, operatorId],
    )) as Array<{ startedAt: Date; answeredAt: Date | null }>;
    return row
      ? {
          startedAt: new Date(row.startedAt),
          answeredAt: row.answeredAt ? new Date(row.answeredAt) : null,
        }
      : null;
  }

  // ------------------------------------------------------------------ ro‘yxat va yozuv

  /** Qo‘ng‘iroqlar (yangisi birinchi); `missingRecordings` — yozuvsizlar, hisobotda xato (TEL-3, TC5). */
  async list(query: CallListQueryDto): Promise<CallPageDto> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    if (query?.from && query?.to && query.from > query.to)
      throw new BadRequestException('from to dan katta');
    const params: unknown[] = [this.graceMinutes()];
    const param = (value: unknown) => `$${params.push(value)}`;
    const where = ['TRUE'];
    if (query?.operatorId)
      where.push(`c.operator_id = ${param(query.operatorId)}`);
    if (query?.leadId) where.push(`c.lead_id = ${param(query.leadId)}`);
    if (query?.from)
      where.push(`c.requested_at >= ${param(tashkentDayStart(query.from))}`);
    if (query?.to)
      where.push(`c.requested_at < ${param(tashkentDayStart(query.to, 1))}`);
    const base = where.join(' AND ');
    const recording = query?.recording
      ? ` AND ${RECORDING_STATE} = ${param(query.recording)}`
      : '';
    const [{ total, missing }] = (await this.db.query(
      `SELECT count(*) FILTER (WHERE TRUE${recording})::int AS total,
              count(*) FILTER (WHERE ${RECORDING_STATE} = 'MISSING')::int AS missing
         FROM lead.call c WHERE ${base}`,
      params,
    )) as Array<{ total: number; missing: number }>;
    const rows = (await this.db.query(
      `${CALL_SELECT} WHERE ${base}${recording} ORDER BY c.requested_at DESC, c.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    )) as CallRow[];
    return {
      items: await this.views(rows),
      total: Number(total),
      page,
      limit,
      missingRecordings: Number(missing),
    };
  }

  /** TEL-7: kim tinglaydi va yuklaydi. Rad — sababi bilan (gateway auditga yozadi va 403 beradi). */
  async recordingAccess(input: {
    callId: string;
    userId: string;
    role: Role;
    mode: RecordingMode;
  }): Promise<RecordingAccess> {
    const call = await this.one(input.callId);
    const target = {
      callId: call.id,
      leadId: call.leadId,
      operatorId: call.operatorId,
    };
    const all = RECORDING_ALL_ROLES.includes(input.role);
    const own = call.operatorId === String(input.userId);
    if (!all && input.role !== Role.OPERATOR_LEAD)
      return { allowed: false, reason: 'ROLE', ...target };
    if (!all && !own) return { allowed: false, reason: 'NOT_OWNER', ...target };
    if (
      input.mode === RecordingMode.DOWNLOAD &&
      !RECORDING_DOWNLOAD_ROLES.includes(input.role)
    )
      return { allowed: false, reason: 'DOWNLOAD_FORBIDDEN', ...target };
    if (call.recording !== CallRecordingState.READY)
      throw new NotFoundException({
        message: 'Yozuv yo‘q yoki hali tayyor emas',
        errorCode: CallErrorCode.RECORDING_NOT_READY,
      });
    return { allowed: true, ...target };
  }

  /** Imzolangan havola uchun (gateway): provayderdagi yozuv kaliti. */
  async recordingRef(callId: string): Promise<{ recordingRef: string }> {
    const [row] = (await this.db.query(
      `SELECT recording_ref AS "recordingRef" FROM lead.call WHERE id = $1 AND recording_ready_at IS NOT NULL`,
      [this.id(callId)],
    )) as Array<{ recordingRef: string | null }>;
    if (!row?.recordingRef)
      throw new NotFoundException({
        message: 'Yozuv yo‘q yoki hali tayyor emas',
        errorCode: CallErrorCode.RECORDING_NOT_READY,
      });
    return { recordingRef: row.recordingRef };
  }

  // ------------------------------------------------------------------ operator telefoni

  async phone(operatorId: string): Promise<OperatorPhoneDto | null> {
    const row = await this.db
      .getRepository(OperatorPhone)
      .findOne({ where: { operatorId: this.id(operatorId) } });
    return row ? this.phoneView(row) : null;
  }

  async setPhone(
    operatorId: string,
    dto: SetOperatorPhoneDto,
    actorId: string,
  ): Promise<OperatorPhoneDto> {
    const value = String(dto?.value ?? '').replace(/[\s()-]/g, '');
    const pattern = dto.kind === OperatorPhoneKind.MOBILE ? MOBILE : EXTENSION;
    if (!pattern.test(value))
      throw new BadRequestException(
        dto.kind === OperatorPhoneKind.MOBILE
          ? 'Mobil raqam +998XXXXXXXXX ko‘rinishida bo‘lishi kerak'
          : 'Ichki raqam 2–10 ta raqam bo‘lishi kerak',
      );
    try {
      await this.db.query(
        `INSERT INTO lead.operator_phone (operator_id, kind, value, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (operator_id) DO UPDATE
           SET kind = EXCLUDED.kind, value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [this.id(operatorId), dto.kind, value, this.id(actorId)],
      );
    } catch (error) {
      if (violates(error, PHONE_INDEX))
        throw new ConflictException(
          'Bu telefon boshqa operatorga biriktirilgan',
        );
      throw error;
    }
    return (await this.phone(operatorId))!;
  }

  async deletePhone(operatorId: string): Promise<{ deleted: boolean }> {
    const result = await this.db
      .getRepository(OperatorPhone)
      .delete({ operatorId: this.id(operatorId) });
    return { deleted: Boolean(result.affected) };
  }

  // ------------------------------------------------------------------ yordamchi

  private async one(callId: string): Promise<LeadCallDto> {
    const rows = (await this.db.query(`${CALL_SELECT} WHERE c.id = $2`, [
      this.graceMinutes(),
      this.id(callId),
    ])) as CallRow[];
    if (!rows.length) throw new NotFoundException('Qo‘ng‘iroq topilmadi');
    const [view] = await this.views(rows);
    return view;
  }

  private async views(rows: CallRow[]): Promise<LeadCallDto[]> {
    const nameOf =
      this.names && rows.length
        ? await this.names.resolve(rows.map((row) => row.operatorId))
        : (id: string) => `#${id}`;
    return rows.map((row) => ({
      id: row.id,
      leadId: row.leadId,
      operatorId: row.operatorId,
      operatorName: nameOf(row.operatorId),
      customerName: row.customerName,
      channel: row.channel,
      status: row.status,
      requestedAt: new Date(row.requestedAt).toISOString(),
      answeredAt: row.answeredAt
        ? new Date(row.answeredAt).toISOString()
        : null,
      endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
      durationSeconds: row.durationSeconds,
      endReason: row.endReason,
      suggestedOutcome: row.endReason
        ? (CALL_OUTCOME[row.endReason] ?? null)
        : null,
      recording: row.recording,
      attemptId: row.attemptId,
    }));
  }

  private phoneView(row: OperatorPhone): OperatorPhoneDto {
    return {
      operatorId: String(row.operatorId),
      kind: row.kind,
      value: row.value,
      updatedBy: String(row.updatedBy),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private graceMinutes(): number {
    return Number(
      this.config.get('TELEPHONY_RECORDING_GRACE_MINUTES') ??
        DEFAULT_GRACE_MINUTES,
    );
  }

  /** T4: bazada mijoz raqami emas, xeshi (kalitli — raqamlar kam, oddiy xesh topib olinadi). */
  private phoneHash(phone: string): string {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('INTEGRATION_CREDENTIAL_SECRET'),
    )
      .update(phone)
      .digest('hex');
  }

  private id(value: unknown): string {
    const id = String(value ?? '');
    if (!/^[1-9]\d{0,18}$/.test(id)) throw new NotFoundException('Topilmadi');
    return id;
  }
}

function violates(error: unknown, constraint: string): boolean {
  const driver = (error as QueryFailedError)?.driverError as
    { code?: string; constraint?: string } | undefined;
  return (
    error instanceof QueryFailedError &&
    driver?.code === '23505' &&
    driver.constraint === constraint
  );
}
