import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  AffiliateStreamStatus,
  CreateFraudIncidentDto,
  FRAUD_DECISIONS,
  FraudActionDto,
  FraudActionPageDto,
  FraudActionQueryDto,
  FraudActionType,
  FraudDecisionDto,
  FraudFeeEvent,
  FraudIncidentDetailDto,
  FraudIncidentDto,
  FraudIncidentPageDto,
  FraudIncidentQueryDto,
  FraudIncidentStatus,
  FraudMeasureEvent,
  FraudRule,
  isLeadBigintId,
  LEAD_EVENTS,
  LeadErrorCode,
  OutboxEvent,
} from '@app/common';
import { AffiliateIdentityClient, phoneKey } from './affiliate-identity.client';
import {
  FraudAction,
  FraudIncident,
  Lead,
  LeadHistory,
  Stream,
} from './entities';
import { maskPhone } from './lead-card.service';
import { tashkentDayStart } from './lead-schedule';

/** Firibgarlik qoidalari raqamlari. Manba yonida; TZ da yo‘q chegara qo‘yilmagan (savollar.md). */
export const FRAUD_RULES = {
  /** TZ 7: «Oqimda yaroqli lid < 60% yoki tasdiq < 25% (kamida 50 lidda)». */
  qualityMinLeads: 50,
  qualityMinValidPercent: 60,
  qualityMinConfirmPercent: 25,
  /** [taklif] Sifat davri 7 kun — dizayn E-Admin-Firibgarlik («Davr: 08.01–14.01.2027», «7 kunda»). */
  qualityWindowDays: 7,
  /** [taklif] «Sotuvchining o‘z raqami» tekshiruvi oxirgi 24 soat lidlarini ko‘radi (soatbay ish; identity vaqtincha ishlamasa ham lid qolmaydi). */
  selfOrderLookbackHours: 24,
} as const;

/** Qora ro‘yxat yozuvi bir raqamga bir marta (bir vaqtda ikki ariza kelsa ham) [taklif]: 2104 — BE-35. */
const LOCK_SPACE_FRAUD = 2104;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;

type Target = FraudAction['targetType'];

interface IncidentInput {
  rule: FraudRule;
  subjectKey: string;
  affiliateId?: string | null;
  streamId?: string | null;
  leadId?: string | null;
  operatorId?: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  proposedAction?: FraudActionType | null;
  detectedBy?: string | null;
}

/**
 * Firibgarlik markazi (ADM-4, TZ 7-bo‘lim; BE-35). Har qoida avtomatik tekshiriladi: hodisa qoidaning o‘z chorasi
 * bilan ochiladi, qolgan qarorni admin sabab va dalil bilan qiladi (dizayn E-Admin-Firibgarlik). Har chora
 * `fraud_action` da (faqat qo‘shiladi). Pul choralari moliyaga outbox orqali (`fraud.fee.*`).
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly db: DataSource,
    @Optional() private readonly identity?: AffiliateIdentityClient,
  ) {}

  // ------------------------------------------------------------ lid qabul qilishdagi tizim choralari

  /** BE-12 bir IP dan ko‘p ariza → tekshiruvga: hodisa (bir IP — bitta ochiq) va «Lidlar tekshiruvga olindi». */
  async onIpReview(
    m: EntityManager,
    lead: Pick<Lead, 'id' | 'ip' | 'affiliateId' | 'streamId'>,
    leadsInWindow: number,
    windowMinutes: number,
  ): Promise<void> {
    if (!lead.ip) return;
    const { id, inserted } = await this.upsertOpen(m, {
      rule: FraudRule.SPAM_IP,
      subjectKey: `ip:${lead.ip}`,
      affiliateId: lead.affiliateId,
      streamId: lead.streamId,
      summary: `Bir IP dan ${windowMinutes} daqiqada ${leadsInWindow} ta ariza`,
      evidence: {
        ip: lead.ip,
        windowMinutes,
        leadsInWindow,
        lastLeadId: lead.id,
      },
    });
    if (inserted)
      await this.record(m, {
        incidentId: id,
        action: FraudActionType.REVIEW_HOLD,
        rule: FraudRule.SPAM_IP,
        targetType: 'IP',
        targetId: lead.ip,
        affiliateId: lead.affiliateId,
        reason: `Bir IP dan ${windowMinutes} daqiqada ${leadsInWindow} ta ariza — lidlar tekshiruvga olindi (BE-12)`,
        evidence: { leadId: lead.id },
      });
  }

  /**
   * Qora ro‘yxat (TZ 7: bir raqam 2 marta rad etgan). Chorasi EQ-04 javobida: «yetkazish puli oldindan» onlayn
   * to‘lovsiz bo‘lmaydi (BE-34). Hozir [taklif]: lid kartasida belgi va choralar tarixida bir marta yozuv.
   */
  async onBlacklisted(
    m: EntityManager,
    lead: Pick<Lead, 'id' | 'phoneE164' | 'affiliateId'>,
    rejections: number,
  ): Promise<void> {
    await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      LOCK_SPACE_FRAUD,
      `phone:${lead.phoneE164}`,
    ]);
    const [done] = (await m.query(
      `SELECT 1 FROM lead.fraud_action WHERE action = 'BLACKLIST' AND target_type = 'PHONE' AND target_id = $1 LIMIT 1`,
      [lead.phoneE164],
    )) as unknown[];
    if (done) return;
    await this.record(m, {
      incidentId: null,
      action: FraudActionType.BLACKLIST,
      rule: FraudRule.BLACKLIST,
      targetType: 'PHONE',
      targetId: lead.phoneE164,
      affiliateId: lead.affiliateId,
      reason: `Ketma-ket rad etuvchi mijoz: ${rejections} marta rad etgan. Keyingi buyurtma chorasi — EQ-04 javobidan keyin; hozir lid kartasida belgi`,
      evidence: { leadId: lead.id, rejections },
    });
  }

  // ------------------------------------------------------------ avtomatik tekshiruv (soatbay)

  async runDetectors(
    now = new Date(),
  ): Promise<{ quality: number; selfOrder: number }> {
    const quality = await this.detectQuality(now);
    const selfOrder = await this.detectSelfOrders(now);
    return { quality, selfOrder };
  }

  /**
   * Sifatsiz trafik (TZ 7): faol sahifada natijasi kiritilgan lidlar ≥ 50 bo‘lsa — yaroqli < 60% yoki tasdiq < 25%.
   * - lid soni — natijasi bor lidlar (urinish bo‘lgan yoki dublikat); navbat va brondagi yangi lidlar natijadan
   *   keyin qo‘shiladi (dizayn); tekshiruvdagi lidlar kirmaydi;
   * - yaroqli = lidlar − yaroqsiz − dublikat; tasdiq = tasdiqlangan / yaroqli (BE-28 bilan bir xil ta’rif);
   * - davr — 7 kun [taklif], lekin sahifaning oldingi qaroridan keyin boshlanadi: ogohlantirishdan keyin faqat
   *   yangi trafik o‘lchanadi («keyin to‘xtatish») [taklif];
   * - taklif qilinadigan chora: avval ogohlantirish, ogohlantirilgan sahifaga — to‘xtatish (TZ 7).
   */
  async detectQuality(now = new Date()): Promise<number> {
    const windowStart = new Date(
      now.getTime() - FRAUD_RULES.qualityWindowDays * DAY_MS,
    );
    const rows = (await this.db.query(
      `WITH last AS (
         SELECT stream_id, max(closed_at) AS at FROM lead.fraud_incident
          WHERE rule = 'QUALITY' AND status <> 'OPEN' AND stream_id IS NOT NULL GROUP BY stream_id
       )
       SELECT s.id::text AS "streamId", s.affiliate_id::text AS "affiliateId", s.code,
              GREATEST($1::timestamptz, COALESCE(last.at, $1::timestamptz)) AS "from",
              count(*)::int AS leads,
              count(*) FILTER (WHERE l.status = 'INVALID')::int AS invalid,
              count(*) FILTER (WHERE l.status = 'MERGED')::int AS duplicate,
              count(*) FILTER (WHERE l.status = 'CONFIRMED')::int AS confirmed,
              count(*) FILTER (WHERE l.status = 'REJECTED')::int AS rejected,
              count(*) FILTER (WHERE l.status = 'NO_CONTACT')::int AS "noContact",
              count(*) FILTER (WHERE l.status IN ('NEW','BOOKED','CALLBACK'))::int AS callback
         FROM lead.stream s
         LEFT JOIN last ON last.stream_id = s.id
         JOIN lead.lead l ON l.stream_id = s.id AND l.is_deleted = false AND l.review_reason IS NULL
              AND l.created_at >= GREATEST($1::timestamptz, COALESCE(last.at, $1::timestamptz))
              AND l.created_at < $2
              AND (l.attempts > 0 OR l.status IN ('MERGED','INVALID','CONFIRMED','REJECTED','NO_CONTACT'))
        WHERE s.is_deleted = false AND s.status = $4
        GROUP BY s.id, s.affiliate_id, s.code, last.at
       HAVING count(*) >= $3
        ORDER BY s.id`,
      [
        windowStart,
        now,
        FRAUD_RULES.qualityMinLeads,
        AffiliateStreamStatus.ACTIVE,
      ],
    )) as Array<{
      streamId: string;
      affiliateId: string;
      code: string;
      from: Date;
      leads: number;
      invalid: number;
      duplicate: number;
      confirmed: number;
      rejected: number;
      noContact: number;
      callback: number;
    }>;
    let opened = 0;
    for (const r of rows) {
      const valid = r.leads - r.invalid - r.duplicate;
      const lowValid =
        valid * 100 < FRAUD_RULES.qualityMinValidPercent * r.leads;
      const lowConfirm =
        valid === 0 ||
        r.confirmed * 100 < FRAUD_RULES.qualityMinConfirmPercent * valid;
      if (!lowValid && !lowConfirm) continue;
      const validRate = Math.round((valid * 100) / r.leads);
      const confirmRate = valid ? Math.round((r.confirmed * 100) / valid) : 0;
      await this.db.transaction(async (m) => {
        const [warned] = (await m.query(
          `SELECT 1 FROM lead.fraud_action WHERE action = 'WARN' AND target_type = 'STREAM' AND target_id = $1 LIMIT 1`,
          [r.streamId],
        )) as unknown[];
        await this.upsertOpen(m, {
          rule: FraudRule.QUALITY,
          subjectKey: `stream:${r.streamId}`,
          affiliateId: r.affiliateId,
          streamId: r.streamId,
          summary: `Sahifa ${r.code}: yaroqli lid ${validRate}%, tasdiq ${confirmRate}% (${r.leads} lid)`,
          evidence: {
            from: new Date(r.from).toISOString(),
            to: now.toISOString(),
            leads: r.leads,
            valid,
            invalid: r.invalid,
            duplicate: r.duplicate,
            confirmed: r.confirmed,
            rejected: r.rejected,
            noContact: r.noContact,
            callback: r.callback,
            validRate,
            confirmRate,
            thresholds: {
              minLeads: FRAUD_RULES.qualityMinLeads,
              validPercent: FRAUD_RULES.qualityMinValidPercent,
              confirmPercent: FRAUD_RULES.qualityMinConfirmPercent,
            },
          },
          proposedAction: warned
            ? FraudActionType.STOP_STREAM
            : FraudActionType.WARN,
        });
      });
      opened++;
    }
    return opened;
  }

  /**
   * Sotuvchining o‘z buyurtmasi (TZ 7: «sotuvchi raqami mijoz sifatida» → «haq tekshiruvgacha ushlab turiladi»):
   * mijoz raqami sotuvchi profilidagi raqam bilan bir xil bo‘lsa — hodisa va haq avtomatik ushlanadi.
   * «Bir qurilma yoki IP dan ko‘p lid» va «bir manzilga ko‘p buyurtma» — TZ da «ko‘p» chegarasi yo‘q (savollar.md):
   * hozircha admin qo‘lda hodisa ochadi.
   */
  async detectSelfOrders(now = new Date()): Promise<number> {
    if (!this.identity) return 0;
    const since = new Date(
      now.getTime() - FRAUD_RULES.selfOrderLookbackHours * HOUR_MS,
    );
    const leads = (await this.db.query(
      `SELECT l.id::text AS id, l.affiliate_id::text AS "affiliateId", l.stream_id::text AS "streamId",
              l.phone_e164 AS phone
         FROM lead.lead l
        WHERE l.created_at >= $1 AND l.created_at < $2 AND l.affiliate_id IS NOT NULL
          AND l.merged_into_id IS NULL AND l.is_deleted = false
          AND NOT EXISTS (SELECT 1 FROM lead.fraud_incident i
                           WHERE i.rule = 'SELF_ORDER' AND i.subject_key = 'lead:' || l.id)
        ORDER BY l.id`,
      [since, now],
    )) as Array<{
      id: string;
      affiliateId: string;
      streamId: string | null;
      phone: string;
    }>;
    const phones = new Map<string, string | null>();
    let found = 0;
    for (const lead of leads) {
      if (!phones.has(lead.affiliateId)) {
        try {
          phones.set(
            lead.affiliateId,
            phoneKey(await this.identity.phoneOf(lead.affiliateId)),
          );
        } catch (e) {
          this.logger.warn(
            `Sotuvchi #${lead.affiliateId} telefoni olinmadi: ${(e as Error).message}; keyingi tekshiruvda`,
          );
          phones.set(lead.affiliateId, null);
        }
      }
      const own = phones.get(lead.affiliateId);
      if (!own || own !== phoneKey(lead.phone)) continue;
      await this.db.transaction(async (m) => {
        const { id, inserted } = await this.upsertOpen(m, {
          rule: FraudRule.SELF_ORDER,
          subjectKey: `lead:${lead.id}`,
          affiliateId: lead.affiliateId,
          streamId: lead.streamId,
          leadId: lead.id,
          summary: `Lid #${lead.id}: mijoz raqami sotuvchi profilidagi raqam bilan bir xil`,
          evidence: { leadId: lead.id, match: 'AFFILIATE_PHONE' },
        });
        if (inserted)
          await this.holdFee(
            m,
            id,
            lead.id,
            lead.affiliateId,
            null,
            'Mijoz raqami sotuvchi profilidagi raqam bilan bir xil; haq tekshiruvgacha ushlab turiladi (TZ 7)',
          );
      });
      found++;
    }
    return found;
  }

  // ------------------------------------------------------------ admin

  async list(query: FraudIncidentQueryDto): Promise<FraudIncidentPageDto> {
    const q = query ?? {};
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const qb = this.db.getRepository(FraudIncident).createQueryBuilder('i');
    if (q.state === 'OPEN')
      qb.andWhere('i.status = :s', { s: FraudIncidentStatus.OPEN });
    if (q.state === 'CLOSED')
      qb.andWhere('i.status <> :s', { s: FraudIncidentStatus.OPEN });
    if (q.rule) qb.andWhere('i.rule = :rule', { rule: q.rule });
    if (q.from)
      qb.andWhere('i.detected_at >= :from', { from: tashkentDayStart(q.from) });
    if (q.to)
      qb.andWhere('i.detected_at < :to', { to: tashkentDayStart(q.to, 1) });
    const [rows, total] = await qb
      .orderBy('i.detected_at', 'DESC')
      .addOrderBy('i.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const open = await this.db
      .getRepository(FraudIncident)
      .count({ where: { status: FraudIncidentStatus.OPEN } });
    return {
      items: rows.map(toIncidentDto),
      total,
      open,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async get(id: string): Promise<FraudIncidentDetailDto> {
    if (!isLeadBigintId(id)) throw new BadRequestException('id noto‘g‘ri');
    const incident = await this.db
      .getRepository(FraudIncident)
      .findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Hodisa topilmadi');
    const actions = (await this.db.query(
      `SELECT * FROM lead.fraud_action
        WHERE incident_id = $1 OR ($2::text IS NOT NULL AND target_type = 'STREAM' AND target_id = $2)
        ORDER BY id DESC LIMIT 50`,
      [id, incident.streamId],
    )) as RawAction[];
    return { ...toIncidentDto(incident), actions: actions.map(toActionDto) };
  }

  async actions(query: FraudActionQueryDto): Promise<FraudActionPageDto> {
    const q = query ?? {};
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const where: string[] = ['true'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.incidentId) add('incident_id = ?', q.incidentId);
    if (q.streamId) add(`target_type = 'STREAM' AND target_id = ?`, q.streamId);
    if (q.affiliateId) add('affiliate_id = ?', q.affiliateId);
    if (q.by === 'SYSTEM') where.push('actor_id IS NULL');
    if (q.by === 'ADMIN') where.push('actor_id IS NOT NULL');
    if (q.from) add('created_at >= ?', tashkentDayStart(q.from));
    if (q.to) add('created_at < ?', tashkentDayStart(q.to, 1));
    const cond = where.join(' AND ');
    const [{ total }] = (await this.db.query(
      `SELECT count(*)::int AS total FROM lead.fraud_action WHERE ${cond}`,
      params,
    )) as Array<{ total: number }>;
    const rows = (await this.db.query(
      `SELECT * FROM lead.fraud_action WHERE ${cond} ORDER BY id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    )) as RawAction[];
    return {
      items: rows.map(toActionDto),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Admin hodisani qo‘lda ochadi: TZ da avtomatik chegara yo‘q xavflar (soxta tasdiq — «o‘rtachadan ancha yuqori»,
   * mijoz bazasini o‘g‘irlash, aldovli reklama, bir qurilma/manzildan ko‘p buyurtma) va shikoyatlar uchun [taklif].
   */
  async create(
    actorId: string,
    dto: CreateFraudIncidentDto,
  ): Promise<FraudIncidentDetailDto> {
    if (!Object.values(FraudRule).includes(dto?.rule))
      throw new BadRequestException({ message: ['rule noto‘g‘ri'] });
    const reason = String(dto.reason ?? '').trim();
    if (!reason)
      throw new BadRequestException({
        message: ['reason dalil va sabab majburiy'],
      });
    for (const k of [
      'affiliateId',
      'streamId',
      'leadId',
      'operatorId',
    ] as const)
      if (dto[k] !== undefined && !isLeadBigintId(dto[k]))
        throw new BadRequestException({ message: [`${k} noto‘g‘ri`] });
    let { affiliateId = null, streamId = null } = dto;
    const { leadId = null, operatorId = null } = dto;
    if (leadId) {
      const lead = await this.db
        .getRepository(Lead)
        .findOne({ where: { id: leadId, isDeleted: false } });
      if (!lead) throw new NotFoundException('Lid topilmadi');
      affiliateId ??= lead.affiliateId;
      streamId ??= lead.streamId;
    }
    if (streamId && !affiliateId) {
      const stream = await this.db
        .getRepository(Stream)
        .findOne({ where: { id: streamId, isDeleted: false } });
      if (!stream) throw new NotFoundException('Sahifa topilmadi');
      affiliateId = stream.affiliateId;
    }
    const subjectKey = leadId
      ? `lead:${leadId}`
      : streamId
        ? `stream:${streamId}`
        : operatorId
          ? `operator:${operatorId}`
          : affiliateId
            ? `affiliate:${affiliateId}`
            : null;
    if (!subjectKey)
      throw new BadRequestException({
        message: [
          'Kim yoki nima: affiliateId, streamId, leadId yoki operatorId kerak',
        ],
      });
    const id = await this.db.transaction(async (m) => {
      const res = await this.upsertOpen(
        m,
        {
          rule: dto.rule,
          subjectKey,
          affiliateId,
          streamId,
          leadId,
          operatorId,
          summary: reason,
          evidence: { note: reason },
          detectedBy: actorId,
        },
        false,
      );
      if (!res.inserted)
        throw new ConflictException(
          `Bu qoida bo‘yicha ochiq hodisa bor (#${res.id})`,
        );
      return res.id;
    });
    return this.get(id);
  }

  /**
   * Admin qarori (dizayn: chora — sabab va dalil bilan; «Asossiz — hodisani yopish»). Jazo zinasi TZ 7:
   * ogohlantirish → haqni ushlab turish → bloklash va ushlab turilgan haqni bekor qilish.
   * - WARN, STOP_STREAM, RELEASE_FEE, BLOCK_AFFILIATE, REVOKE_BONUS — hodisa yopiladi (RESOLVED);
   * - HOLD_FEE — hodisa ochiq qoladi (tekshiruv davom etadi), keyingi qaror — RELEASE_FEE yoki BLOCK_AFFILIATE;
   * - DISMISS — «Asossiz»: DISMISSED, ushlangan haq bo‘lsa qo‘yib yuboriladi.
   * Sotuvchi akkauntini bloklash identity da (gateway BLOCK_AFFILIATE da chaqiradi); bu yerda sahifalar to‘xtaydi
   * va ushlangan haq bekor qilinadi. Operator bonusi (14-qoida) hali hisoblanmaydi — REVOKE_BONUS faqat yoziladi.
   */
  async decide(
    actorId: string,
    incidentId: string,
    dto: FraudDecisionDto,
    now = new Date(),
  ): Promise<FraudIncidentDetailDto> {
    if (!isLeadBigintId(incidentId))
      throw new BadRequestException('id noto‘g‘ri');
    if (!(FRAUD_DECISIONS as readonly string[]).includes(dto?.action))
      throw new BadRequestException({ message: ['action noto‘g‘ri'] });
    const reason = String(dto.reason ?? '').trim();
    if (!reason)
      throw new BadRequestException({
        message: ['reason sabab va dalil majburiy'],
      });
    await this.db.transaction(async (m) => {
      const repo = m.getRepository(FraudIncident);
      const incident = await repo.findOne({
        where: { id: incidentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!incident) throw new NotFoundException('Hodisa topilmadi');
      if (incident.status !== FraudIncidentStatus.OPEN)
        throw new ConflictException({
          message: 'Hodisa allaqachon yopilgan',
          errorCode: LeadErrorCode.FRAUD_INCIDENT_CLOSED,
        });
      const need = (value: string | null, what: string): string => {
        if (!value)
          throw new BadRequestException({
            message: `Bu chora uchun hodisada ${what} yo‘q`,
            errorCode: LeadErrorCode.FRAUD_ACTION_NOT_APPLICABLE,
          });
        return value;
      };
      const base = {
        incidentId,
        rule: incident.rule,
        affiliateId: incident.affiliateId,
        actorId,
        reason,
      };
      let status = FraudIncidentStatus.RESOLVED;
      switch (dto.action) {
        case FraudActionType.WARN: {
          const affiliateId = need(incident.affiliateId, 'sotuvchi');
          await this.record(m, {
            ...base,
            action: FraudActionType.WARN,
            targetType: incident.streamId ? 'STREAM' : 'AFFILIATE',
            targetId: incident.streamId ?? affiliateId,
            evidence: incident.evidence,
          });
          await this.measure(
            m,
            incidentId,
            affiliateId,
            incident.streamId,
            dto.action,
            reason,
            now,
          );
          break;
        }
        case FraudActionType.STOP_STREAM: {
          const streamId = need(incident.streamId, 'sahifa');
          await m
            .getRepository(Stream)
            .update(
              { id: streamId, isDeleted: false },
              { status: AffiliateStreamStatus.STOPPED, fraudStoppedAt: now },
            );
          await this.record(m, {
            ...base,
            action: dto.action,
            targetType: 'STREAM',
            targetId: streamId,
            evidence: incident.evidence,
          });
          await this.measure(
            m,
            incidentId,
            need(incident.affiliateId, 'sotuvchi'),
            streamId,
            dto.action,
            reason,
            now,
          );
          break;
        }
        case FraudActionType.HOLD_FEE: {
          const leadId = need(incident.leadId, 'lid');
          const affiliateId = need(incident.affiliateId, 'sotuvchi');
          await this.holdFee(
            m,
            incidentId,
            leadId,
            affiliateId,
            actorId,
            reason,
          );
          status = FraudIncidentStatus.OPEN;
          break;
        }
        case FraudActionType.RELEASE_FEE: {
          const leadId = need(incident.leadId, 'lid');
          if (!(await this.releaseFee(m, incidentId, leadId, actorId, reason)))
            throw new BadRequestException({
              message: 'Bu lid bo‘yicha ushlangan haq yo‘q',
              errorCode: LeadErrorCode.FRAUD_ACTION_NOT_APPLICABLE,
            });
          break;
        }
        case FraudActionType.BLOCK_AFFILIATE: {
          const affiliateId = need(incident.affiliateId, 'sotuvchi');
          const stopped = await m.query(
            `UPDATE lead.stream SET status = $2, fraud_stopped_at = COALESCE(fraud_stopped_at, $3), updated_at = now()
              WHERE affiliate_id = $1 AND is_deleted = false RETURNING id::text`,
            [affiliateId, AffiliateStreamStatus.STOPPED, now],
          );
          const held = await this.activeHolds(m, { affiliateId });
          await this.record(m, {
            ...base,
            action: dto.action,
            targetType: 'AFFILIATE',
            targetId: affiliateId,
            evidence: {
              streamsStopped: rowsOf(stopped).length,
              cancelledLeadIds: held,
            },
          });
          if (held.length)
            await this.outbox(m, LEAD_EVENTS.FRAUD_FEE_CANCEL, incidentId, {
              eventId: randomUUID(),
              incidentId,
              affiliateId,
              leadIds: held,
              reason,
              at: now.toISOString(),
            } satisfies FraudFeeEvent);
          await this.measure(
            m,
            incidentId,
            affiliateId,
            null,
            dto.action,
            reason,
            now,
          );
          break;
        }
        case FraudActionType.REVOKE_BONUS: {
          const operatorId = need(incident.operatorId, 'operator');
          await this.record(m, {
            ...base,
            action: dto.action,
            targetType: 'OPERATOR',
            targetId: operatorId,
            evidence: {
              note: 'Operator bonusi (14-qoida) hali hisoblanmaydi — EQ-04; qaror yozib qo‘yildi',
            },
          });
          break;
        }
        case FraudActionType.DISMISS: {
          if (incident.leadId)
            await this.releaseFee(
              m,
              incidentId,
              incident.leadId,
              actorId,
              `Asossiz: ${reason}`,
            );
          const [targetType, targetId] = targetOf(incident);
          await this.record(m, {
            ...base,
            action: dto.action,
            targetType,
            targetId,
            evidence: {},
          });
          status = FraudIncidentStatus.DISMISSED;
          break;
        }
      }
      if (status !== FraudIncidentStatus.OPEN) {
        incident.status = status;
        incident.closedAt = now;
        incident.closedBy = actorId;
        await repo.save(incident);
      }
    });
    return this.get(incidentId);
  }

  // ------------------------------------------------------------ yordamchilar

  /** Ushlangan haq (oxirgi chorasi HOLD_FEE, keyin qo‘yib yuborilmagan va sotuvchi bloklanmagan) lidlari. */
  async activeHolds(
    m: EntityManager,
    by: { leadId?: string; affiliateId?: string },
  ): Promise<string[]> {
    const rows = (await m.query(
      `SELECT h.target_id AS "leadId" FROM lead.fraud_action h
        WHERE h.action = 'HOLD_FEE' AND h.target_type = 'LEAD'
          AND ($1::text IS NULL OR h.target_id = $1) AND ($2::bigint IS NULL OR h.affiliate_id = $2)
          AND NOT EXISTS (SELECT 1 FROM lead.fraud_action r WHERE r.target_type = 'LEAD' AND r.target_id = h.target_id
                           AND r.action IN ('HOLD_FEE','RELEASE_FEE') AND r.id > h.id)
          AND NOT EXISTS (SELECT 1 FROM lead.fraud_action b WHERE b.action = 'BLOCK_AFFILIATE'
                           AND b.affiliate_id = h.affiliate_id AND b.id > h.id)
        ORDER BY h.id`,
      [by.leadId ?? null, by.affiliateId ?? null],
    )) as Array<{ leadId: string }>;
    return rows.map((r) => r.leadId);
  }

  private async holdFee(
    m: EntityManager,
    incidentId: string,
    leadId: string,
    affiliateId: string,
    actorId: string | null,
    reason: string,
  ): Promise<void> {
    await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      LOCK_SPACE_FRAUD,
      `fee:${leadId}`,
    ]);
    if ((await this.activeHolds(m, { leadId })).length) return;
    await this.record(m, {
      incidentId,
      action: FraudActionType.HOLD_FEE,
      rule: null,
      targetType: 'LEAD',
      targetId: leadId,
      affiliateId,
      actorId,
      reason,
      evidence: {},
    });
    await this.outbox(m, LEAD_EVENTS.FRAUD_FEE_HOLD, incidentId, {
      eventId: randomUUID(),
      incidentId,
      affiliateId,
      leadIds: [leadId],
      reason,
      at: new Date().toISOString(),
    } satisfies FraudFeeEvent);
    await this.leadNote(
      m,
      leadId,
      actorId,
      'Sotuvchi haqi tekshiruvgacha ushlab turildi (TZ 7)',
      { incidentId },
    );
  }

  private async releaseFee(
    m: EntityManager,
    incidentId: string,
    leadId: string,
    actorId: string,
    reason: string,
  ): Promise<boolean> {
    await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      LOCK_SPACE_FRAUD,
      `fee:${leadId}`,
    ]);
    if (!(await this.activeHolds(m, { leadId })).length) return false;
    const [lead] = (await m.query(
      `SELECT affiliate_id::text AS a FROM lead.lead WHERE id = $1`,
      [leadId],
    )) as Array<{ a: string | null }>;
    const affiliateId = lead?.a ?? '';
    await this.record(m, {
      incidentId,
      action: FraudActionType.RELEASE_FEE,
      rule: null,
      targetType: 'LEAD',
      targetId: leadId,
      affiliateId: affiliateId || null,
      actorId,
      reason,
      evidence: {},
    });
    await this.outbox(m, LEAD_EVENTS.FRAUD_FEE_RELEASE, incidentId, {
      eventId: randomUUID(),
      incidentId,
      affiliateId,
      leadIds: [leadId],
      reason,
      at: new Date().toISOString(),
    } satisfies FraudFeeEvent);
    await this.leadNote(
      m,
      leadId,
      actorId,
      'Ushlab turilgan sotuvchi haqi qo‘yib yuborildi',
      { incidentId },
    );
    return true;
  }

  private async leadNote(
    m: EntityManager,
    leadId: string,
    actorId: string | null,
    note: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    const lead = await m.getRepository(Lead).findOne({ where: { id: leadId } });
    if (!lead) return;
    const history = m.getRepository(LeadHistory);
    await history.save(
      history.create({
        leadId,
        fromStatus: lead.status,
        toStatus: lead.status,
        actorId,
        field: 'fraud',
        newValue: value,
        note,
      }),
    );
  }

  private async measure(
    m: EntityManager,
    incidentId: string,
    affiliateId: string,
    streamId: string | null,
    action: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.outbox(m, LEAD_EVENTS.FRAUD_MEASURE, incidentId, {
      eventId: randomUUID(),
      incidentId,
      affiliateId,
      streamId,
      action,
      reason,
      at: now.toISOString(),
    } satisfies FraudMeasureEvent);
  }

  private async outbox(
    m: EntityManager,
    eventType: string,
    aggregateId: string,
    payload: object,
  ): Promise<void> {
    const repo = m.getRepository(OutboxEvent);
    await repo.save(
      repo.create({
        aggregateType: 'fraud',
        aggregateId,
        eventType,
        payload: payload as Record<string, unknown>,
      }),
    );
  }

  private async record(
    m: EntityManager,
    a: {
      incidentId: string | null;
      action: FraudActionType;
      rule: FraudRule | null;
      targetType: Target;
      targetId: string;
      affiliateId: string | null;
      actorId?: string | null;
      reason: string;
      evidence: Record<string, unknown>;
    },
  ): Promise<void> {
    const repo = m.getRepository(FraudAction);
    await repo.save(
      repo.create({
        incidentId: a.incidentId,
        action: a.action,
        rule: a.rule,
        targetType: a.targetType,
        targetId: a.targetId,
        affiliateId: a.affiliateId,
        reason: a.reason,
        evidence: a.evidence,
        actorId: a.actorId ?? null,
      }),
    );
  }

  /** Bir qoida + obyekt uchun bitta ochiq hodisa: bor bo‘lsa dalil yangilanadi (`update = false` — tegilmaydi). */
  private async upsertOpen(
    m: EntityManager,
    i: IncidentInput,
    update = true,
  ): Promise<{ id: string; inserted: boolean }> {
    const rows = rowsOf(
      await m.query(
        `INSERT INTO lead.fraud_incident
           (rule, subject_key, affiliate_id, stream_id, lead_id, operator_id, summary, evidence, proposed_action, detected_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (rule, subject_key) WHERE status = 'OPEN'
         DO UPDATE SET ${
           update
             ? `summary = EXCLUDED.summary, evidence = EXCLUDED.evidence, proposed_action = EXCLUDED.proposed_action,
                affiliate_id = COALESCE(EXCLUDED.affiliate_id, fraud_incident.affiliate_id),
                stream_id = COALESCE(EXCLUDED.stream_id, fraud_incident.stream_id), updated_at = now()`
             : 'rule = fraud_incident.rule'
         }
         RETURNING id::text AS id, (xmax = 0) AS inserted`,
        [
          i.rule,
          i.subjectKey,
          i.affiliateId ?? null,
          i.streamId ?? null,
          i.leadId ?? null,
          i.operatorId ?? null,
          i.summary,
          JSON.stringify(i.evidence),
          i.proposedAction ?? null,
          i.detectedBy ?? null,
        ],
      ),
    ) as Array<{ id: string; inserted: boolean }>;
    return rows[0];
  }
}

interface RawAction {
  id: string;
  incident_id: string | null;
  action: FraudActionType;
  rule: FraudRule | null;
  target_type: string;
  target_id: string;
  affiliate_id: string | null;
  reason: string;
  evidence: Record<string, unknown>;
  actor_id: string | null;
  created_at: Date;
}

/** `INSERT … RETURNING` — massiv; `UPDATE … RETURNING` — [qatorlar, soni] (TypeORM). */
const rowsOf = (res: unknown): unknown[] =>
  Array.isArray(res) && Array.isArray(res[0])
    ? (res[0] as unknown[])
    : (res as unknown[]);

function targetOf(i: FraudIncident): [Target, string] {
  if (i.streamId) return ['STREAM', i.streamId];
  if (i.leadId) return ['LEAD', i.leadId];
  if (i.operatorId) return ['OPERATOR', i.operatorId];
  if (i.affiliateId) return ['AFFILIATE', i.affiliateId];
  const [kind, ...rest] = i.subjectKey.split(':');
  return [kind === 'phone' ? 'PHONE' : 'IP', rest.join(':')];
}

function toIncidentDto(i: FraudIncident): FraudIncidentDto {
  return {
    id: String(i.id),
    rule: i.rule,
    status: i.status,
    summary: i.summary,
    affiliateId: i.affiliateId,
    streamId: i.streamId,
    leadId: i.leadId,
    operatorId: i.operatorId,
    evidence: i.evidence,
    proposedAction: i.proposedAction,
    detectedBy: i.detectedBy,
    detectedAt: i.detectedAt,
    closedAt: i.closedAt,
    closedBy: i.closedBy,
  };
}

function toActionDto(a: RawAction): FraudActionDto {
  return {
    id: String(a.id),
    incidentId: a.incident_id === null ? null : String(a.incident_id),
    action: a.action,
    rule: a.rule,
    targetType: a.target_type,
    target: a.target_type === 'PHONE' ? maskPhone(a.target_id) : a.target_id,
    affiliateId: a.affiliate_id === null ? null : String(a.affiliate_id),
    reason: a.reason,
    evidence: a.evidence,
    actorId: a.actor_id === null ? null : String(a.actor_id),
    createdAt: a.created_at,
  };
}
