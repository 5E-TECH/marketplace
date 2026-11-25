import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  AffiliateDocumentFile,
  AffiliateSelfEmployedDto,
  decryptSecret,
  encryptSecret,
  ErrorCode,
  moneyFromDb,
  normalizeFullName,
  PINFL,
  SELF_EMPLOYED_ACTIVITY,
  SELF_EMPLOYED_REASON_TEXT,
  SELF_EMPLOYED_REVIEW_REASONS,
  SelfEmployedApplicationDto,
  SelfEmployedCountsDto,
  SelfEmployedDecisionInput,
  SelfEmployedDetailDto,
  SelfEmployedInfoDto,
  SelfEmployedListQueryDto,
  SelfEmployedPageDto,
  SelfEmployedReason,
  SelfEmployedSource,
  SelfEmployedStatus,
  SubmitSelfEmployedInput,
} from '@app/common';
import { affiliatePayoutLock, validId } from './withdrawal.service';

/** Bazadagi holat: profilda ko‘rinadiganlar va «o‘rniga yangi tekshiruv ochilgan». */
type RowStatus =
  Exclude<SelfEmployedStatus, SelfEmployedStatus.NOT_SUBMITTED> | 'SUPERSEDED';

interface Row {
  id: string;
  affiliateId: string;
  status: RowStatus;
  source: SelfEmployedSource;
  fullName: string;
  pinflCipher: string | null;
  pinflLast4: string | null;
  pinflHash: string | null;
  documentKey: string | null;
  documentName: string | null;
  documentType: string | null;
  documentSize: number | null;
  submittedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  reason: SelfEmployedReason | null;
  comment: string | null;
}

const COLUMNS = `a.id::text, a.affiliate_id AS "affiliateId", a.status, a.source, a.full_name AS "fullName",
       a.pinfl_cipher AS "pinflCipher", a.pinfl_last4 AS "pinflLast4", a.pinfl_hash AS "pinflHash",
       a.document_key AS "documentKey", a.document_name AS "documentName", a.document_type AS "documentType",
       a.document_size AS "documentSize", a.submitted_at AS "submittedAt", a.decided_at AS "decidedAt",
       a.decided_by AS "decidedBy", a.reason, a.comment`;
/** Har sotuvchining oxirgi (amaldagi) qatori. */
const LATEST = `SELECT DISTINCT ON (affiliate_id) * FROM finance.self_employed_application
                 ORDER BY affiliate_id, id DESC`;
const SYSTEM = 'system';
const MIN_KEY_LENGTH = 32;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const state = (
  message: string,
  errorCode: ErrorCode = ErrorCode.INVALID_STATE,
) => new ConflictException({ message, errorCode });

/**
 * BE-25 5-tur: sotuvchining o‘zini o‘zi band qilganlik arizasi (SOT-1, TZ 8). Moliya qo‘lda tekshiradi (ega, 2026-11-25).
 * Pul yechish darvozasi — `affiliate_payout_profile.self_employed` — har qaror bilan bitta tranzaksiyada.
 * Hamma o‘zgarish sotuvchi qulfi ostida (pul yechish so‘rovi bilan bir qulf).
 */
@Injectable()
export class SelfEmployedService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------ sotuvchi

  async current(input: { affiliateId: string }): Promise<SelfEmployedInfoDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    return toInfo(await this.latest(this.db.manager, affiliateId));
  }

  async submit(input: SubmitSelfEmployedInput): Promise<SelfEmployedInfoDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const pinfl = String(input?.pinfl ?? '');
    // raqam xabarda va logda qaytarilmaydi
    if (!PINFL.test(pinfl))
      throw new BadRequestException({
        message: 'JShShIR 14 ta raqamdan iborat',
        errorCode: ErrorCode.PINFL_INVALID,
      });
    const fullName = normalizeFullName(input?.fullName);
    if (!fullName)
      throw new BadRequestException({
        message: 'Avval profilda ism va familiyani kiriting',
        errorCode: ErrorCode.PROFILE_NAME_REQUIRED,
      });
    const document = validDocument(input?.document, affiliateId);
    const key = this.key();
    const row = await this.db.transaction(async (m) => {
      await affiliatePayoutLock(m, affiliateId);
      const last = await this.latest(m, affiliateId);
      if (last?.status === SelfEmployedStatus.PENDING)
        throw state('Ma’lumot hozir tekshirilmoqda', ErrorCode.ALREADY_PENDING);
      if (last?.status === SelfEmployedStatus.VERIFIED)
        throw state(
          'Maqom allaqachon tasdiqlangan',
          ErrorCode.ALREADY_VERIFIED,
        );
      const [{ id }] = (await m.query(
        `INSERT INTO finance.self_employed_application
           (affiliate_id, status, source, full_name, pinfl_cipher, pinfl_last4, pinfl_hash,
            document_key, document_name, document_type, document_size)
         VALUES ($1, 'PENDING', 'SELLER', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id::text`,
        [
          affiliateId,
          fullName,
          encryptSecret(pinfl, key),
          pinfl.slice(-4),
          this.hash(pinfl, key),
          document?.objectKey ?? null,
          document?.fileName ?? null,
          document?.contentType ?? null,
          document?.size ?? null,
        ],
      )) as Array<{ id: string }>;
      return this.byId(m, id);
    });
    return toInfo(row);
  }

  /**
   * Ism-familiya o‘zgarishidan OLDIN chaqiriladi: tasdiqlangan yoki tekshirilayotgan maqom yangi ism bilan qayta
   * tekshiruvga tushadi va pul yechish yopiladi. Ism arizadagidek bo‘lsa — hech narsa o‘zgarmaydi.
   */
  async rename(input: {
    affiliateId: string;
    fullName: string;
  }): Promise<{ recheck: boolean }> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const fullName = normalizeFullName(input?.fullName);
    if (!fullName) throw new BadRequestException('Ism va familiya majburiy');
    return this.db.transaction(async (m) => {
      await affiliatePayoutLock(m, affiliateId);
      const last = await this.latest(m, affiliateId);
      const open =
        last?.status === SelfEmployedStatus.PENDING ||
        last?.status === SelfEmployedStatus.VERIFIED;
      if (!last || !open || last.fullName === fullName)
        return { recheck: false };
      if (!last.pinflCipher) {
        // arizasiz (qo‘lda) tasdiqlangan — tekshiradigan JShShIR yo‘q, sotuvchi o‘zi yuboradi
        await m.query(
          `UPDATE finance.self_employed_application
              SET status = 'REVOKED', reason = $2, comment = NULL, decided_at = now(), decided_by = $3, updated_at = now()
            WHERE id = $1`,
          [last.id, SelfEmployedReason.NAME_CHANGED, SYSTEM],
        );
      } else {
        await m.query(
          `UPDATE finance.self_employed_application SET status = 'SUPERSEDED', updated_at = now() WHERE id = $1`,
          [last.id],
        );
        // navbatdagi ariza joyini yo‘qotmaydi; tasdiqlangani — yangi yuborilgan vaqt bilan
        await m.query(
          `INSERT INTO finance.self_employed_application
             (affiliate_id, status, source, full_name, pinfl_cipher, pinfl_last4, pinfl_hash,
              document_key, document_name, document_type, document_size, submitted_at)
           SELECT affiliate_id, 'PENDING', 'NAME_CHANGE', $2, pinfl_cipher, pinfl_last4, pinfl_hash,
                  document_key, document_name, document_type, document_size,
                  CASE WHEN $3 THEN submitted_at ELSE now() END
             FROM finance.self_employed_application WHERE id = $1`,
          [last.id, fullName, last.status === SelfEmployedStatus.PENDING],
        );
      }
      await this.setGate(m, affiliateId, false, SYSTEM);
      return { recheck: true };
    });
  }

  /** Sotuvchining o‘z hujjati (amaldagi arizadagi). */
  async documentMine(input: {
    affiliateId: string;
  }): Promise<AffiliateDocumentFile> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    return documentOf(await this.latest(this.db.manager, affiliateId));
  }

  // ------------------------------------------------------------------ moliya

  async list(input: {
    query?: SelfEmployedListQueryDto;
  }): Promise<SelfEmployedPageDto> {
    const query = input?.query ?? {};
    const page = positive(query.page, 1);
    const limit = Math.min(positive(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const status = query.status ?? null;
    if (status !== null && !(status in emptyCounts()))
      throw new BadRequestException('status noto‘g‘ri');
    const rows = (await this.db.query(
      `SELECT ${COLUMNS} FROM (${LATEST}) a
        WHERE $1::text IS NULL OR a.status = $1
        ORDER BY (a.status = 'PENDING') DESC,
                 CASE WHEN a.status = 'PENDING' THEN a.submitted_at END ASC,
                 a.decided_at DESC NULLS LAST, a.id DESC
        LIMIT $2 OFFSET $3`,
      [status, limit, (page - 1) * limit],
    )) as Row[];
    const counts = emptyCounts();
    for (const c of (await this.db.query(
      `SELECT a.status, count(*)::int AS n FROM (${LATEST}) a GROUP BY a.status`,
    )) as Array<{ status: keyof SelfEmployedCountsDto; n: number }>)
      if (c.status in counts) counts[c.status] = c.n;
    const total = status
      ? counts[status as keyof SelfEmployedCountsDto]
      : Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { items: rows.map(toApplication), total, page, limit, counts };
  }

  async get(input: { id: string }): Promise<SelfEmployedDetailDto> {
    const row = await this.byId(this.db.manager, validId(input?.id, 'id'));
    return this.detail(this.db.manager, row);
  }

  async document(input: { id: string }): Promise<AffiliateDocumentFile> {
    return documentOf(
      await this.byId(this.db.manager, validId(input?.id, 'id')),
    );
  }

  /** To‘liq JShShIR — faqat amaldagi arizaniki (gateway avval auditga yozadi). */
  async reveal(input: { id: string }): Promise<{ pinfl: string }> {
    const m = this.db.manager;
    const row = await this.byId(m, validId(input?.id, 'id'));
    if ((await this.latest(m, row.affiliateId))?.id !== row.id)
      throw state('Ariza eskirgan — sotuvchining yangi arizasini oching');
    if (!row.pinflCipher)
      throw new NotFoundException('Arizada JShShIR yo‘q (qo‘lda belgilangan)');
    return { pinfl: decryptSecret(row.pinflCipher, this.key()) };
  }

  async approve(
    input: SelfEmployedDecisionInput,
  ): Promise<SelfEmployedDetailDto> {
    const reviewer = validId(input?.reviewerId, 'reviewerId');
    return this.decide(input, async (m, row) => {
      mustBe(row, SelfEmployedStatus.PENDING);
      const currentName = normalizeFullName(input.currentFullName);
      if (currentName !== row.fullName)
        throw state(
          `Profildagi ism arizadagidan farq qiladi: «${currentName}» — ariza «${row.fullName}» bilan yuborilgan`,
          ErrorCode.NAME_CHANGED,
        );
      await m.query(
        `UPDATE finance.self_employed_application
            SET status = 'VERIFIED', reason = NULL, comment = NULL, decided_at = now(), decided_by = $2,
                verified_at = now(), verified_by = $2, updated_at = now()
          WHERE id = $1`,
        [row.id, reviewer],
      );
      await this.setGate(m, row.affiliateId, true, reviewer);
    });
  }

  async reject(
    input: SelfEmployedDecisionInput,
  ): Promise<SelfEmployedDetailDto> {
    return this.close(input, SelfEmployedStatus.PENDING, 'REJECTED');
  }

  async revoke(
    input: SelfEmployedDecisionInput,
  ): Promise<SelfEmployedDetailDto> {
    return this.close(input, SelfEmployedStatus.VERIFIED, 'REVOKED');
  }

  /** BE-23: moliya arizasiz qo‘lda belgilaydi. Ochiq ariza bo‘lsa — arizaning o‘zi tasdiqlanadi. */
  async setManually(input: {
    affiliateId: string;
    selfEmployed: boolean;
    updatedBy: string;
    fullName?: string;
  }): Promise<AffiliateSelfEmployedDto> {
    const affiliateId = validId(input?.affiliateId, 'affiliateId');
    const updatedBy = validId(input?.updatedBy, 'updatedBy');
    if (typeof input?.selfEmployed !== 'boolean')
      throw new BadRequestException('selfEmployed: true yoki false');
    return this.db.transaction(async (m) => {
      await affiliatePayoutLock(m, affiliateId);
      const last = await this.latest(m, affiliateId);
      if (input.selfEmployed) {
        if (last?.status === SelfEmployedStatus.PENDING)
          throw state(
            'Sotuvchining arizasi tekshirilmoqda — arizani tasdiqlang',
            ErrorCode.ALREADY_PENDING,
          );
        if (last?.status !== SelfEmployedStatus.VERIFIED)
          await m.query(
            `INSERT INTO finance.self_employed_application
               (affiliate_id, status, source, full_name, verified_at, verified_by, decided_at, decided_by)
             VALUES ($1, 'VERIFIED', 'MANUAL', $2, now(), $3, now(), $3)`,
            [affiliateId, normalizeFullName(input.fullName), updatedBy],
          );
      } else if (last?.status === SelfEmployedStatus.VERIFIED) {
        await m.query(
          `UPDATE finance.self_employed_application
              SET status = 'REVOKED', reason = NULL, comment = NULL, decided_at = now(), decided_by = $2, updated_at = now()
            WHERE id = $1`,
          [last.id, updatedBy],
        );
      }
      return this.setGate(m, affiliateId, input.selfEmployed, updatedBy);
    });
  }

  // ------------------------------------------------------------------ ichki

  private close(
    input: SelfEmployedDecisionInput,
    from: SelfEmployedStatus.PENDING | SelfEmployedStatus.VERIFIED,
    to: 'REJECTED' | 'REVOKED',
  ): Promise<SelfEmployedDetailDto> {
    const reviewer = validId(input?.reviewerId, 'reviewerId');
    const reason = input?.reason;
    if (!reason || !SELF_EMPLOYED_REVIEW_REASONS.includes(reason))
      throw new BadRequestException('Sabab majburiy');
    const comment =
      String(input?.comment ?? '')
        .trim()
        .slice(0, 500) || null;
    return this.decide(input, async (m, row) => {
      mustBe(row, from);
      await m.query(
        `UPDATE finance.self_employed_application
            SET status = $2, reason = $3, comment = $4, decided_at = now(), decided_by = $5, updated_at = now()
          WHERE id = $1`,
        [row.id, to, reason, comment, reviewer],
      );
      await this.setGate(m, row.affiliateId, false, reviewer);
    });
  }

  /** Sotuvchi qulfi ostida, qatorning yangi holati bilan. */
  private decide(
    input: SelfEmployedDecisionInput,
    work: (m: EntityManager, row: Row) => Promise<void>,
  ): Promise<SelfEmployedDetailDto> {
    const id = validId(input?.id, 'id');
    return this.db.transaction(async (m) => {
      const { affiliateId } = await this.byId(m, id);
      await affiliatePayoutLock(m, affiliateId);
      await work(m, await this.byId(m, id));
      return this.detail(m, await this.byId(m, id));
    });
  }

  private async setGate(
    m: EntityManager,
    affiliateId: string,
    value: boolean,
    by: string,
  ): Promise<AffiliateSelfEmployedDto> {
    const [row] = (await m.query(
      `INSERT INTO finance.affiliate_payout_profile (affiliate_id, self_employed, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (affiliate_id) DO UPDATE
         SET self_employed = EXCLUDED.self_employed, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING affiliate_id AS "affiliateId", self_employed AS "selfEmployed",
                 updated_by AS "updatedBy", updated_at AS "updatedAt"`,
      [affiliateId, value, by],
    )) as AffiliateSelfEmployedDto[];
    return row;
  }

  private async detail(
    m: EntityManager,
    row: Row,
  ): Promise<SelfEmployedDetailDto> {
    const last = await this.latest(m, row.affiliateId);
    const [acc] = (await m.query(
      `SELECT available_balance::text AS available FROM finance.account WHERE type = 'AFFILIATE' AND owner_id = $1`,
      [row.affiliateId],
    )) as Array<{ available: string }>;
    const same = row.pinflHash
      ? ((await m.query(
          `SELECT DISTINCT affiliate_id AS "affiliateId" FROM finance.self_employed_application
            WHERE pinfl_hash = $1 AND affiliate_id <> $2 AND status IN ('PENDING', 'VERIFIED')
            ORDER BY 1`,
          [row.pinflHash, row.affiliateId],
        )) as Array<{ affiliateId: string }>)
      : [];
    return {
      ...toApplication(row),
      current: last?.id === row.id,
      available: moneyFromDb(acc?.available),
      samePinflAffiliateIds: same.map((s) => s.affiliateId),
    };
  }

  private async latest(
    m: EntityManager,
    affiliateId: string,
  ): Promise<Row | null> {
    const [row] = (await m.query(
      `SELECT ${COLUMNS} FROM finance.self_employed_application a
        WHERE a.affiliate_id = $1 ORDER BY a.id DESC LIMIT 1`,
      [affiliateId],
    )) as Row[];
    return row ?? null;
  }

  private async byId(m: EntityManager, id: string): Promise<Row> {
    const [row] = (await m.query(
      `SELECT ${COLUMNS} FROM finance.self_employed_application a WHERE a.id = $1`,
      [id],
    )) as Row[];
    if (!row) throw new NotFoundException('Ariza topilmadi');
    return row;
  }

  /** JShShIR kaliti faqat shu servisda; berilmasa yangi ariza qabul qilinmaydi (ochiq saqlanmaydi). */
  private key(): string {
    const key = this.config.get<string>('SELF_EMPLOYED_SECRET_KEY')?.trim();
    if (!key || key.length < MIN_KEY_LENGTH)
      throw new ServiceUnavailableException(
        'SELF_EMPLOYED_SECRET_KEY sozlanmagan — JShShIR qabul qilinmaydi',
      );
    return key;
  }

  private hash(pinfl: string, key: string): string {
    return createHmac('sha256', `elchi:pinfl-hash:v1:${key}`)
      .update(pinfl)
      .digest('hex');
  }
}

function mustBe(row: Row, expected: SelfEmployedStatus): void {
  if (row.status !== expected)
    throw state(
      row.status === 'SUPERSEDED'
        ? 'Ariza eskirgan — sotuvchi ismini o‘zgartirgan, yangi arizasi navbatda'
        : `Ariza ${row.status} holatida`,
    );
}

function documentOf(row: Row | null): AffiliateDocumentFile {
  if (!row?.documentKey) throw new NotFoundException('Hujjat yuklanmagan');
  return {
    objectKey: row.documentKey,
    fileName: row.documentName!,
    contentType: row.documentType as AffiliateDocumentFile['contentType'],
    size: row.documentSize!,
  };
}

function validDocument(
  value: AffiliateDocumentFile | null | undefined,
  affiliateId: string,
): AffiliateDocumentFile | null {
  if (!value) return null;
  if (
    !String(value.objectKey ?? '').startsWith(
      `private/affiliate/${affiliateId}/`,
    ) ||
    !Number.isSafeInteger(value.size)
  )
    throw new BadRequestException({
      message: 'Hujjat topilmadi — qayta yuklang',
      errorCode: ErrorCode.DOCUMENT_NOT_FOUND,
    });
  return {
    ...value,
    fileName: String(value.fileName ?? '').slice(0, 255) || 'hujjat',
  };
}

function emptyCounts(): SelfEmployedCountsDto {
  return { PENDING: 0, VERIFIED: 0, REJECTED: 0, REVOKED: 0 };
}

function positive(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

const iso = (value: Date | null) =>
  value ? new Date(value).toISOString() : null;

function toInfo(row: Row | null): SelfEmployedInfoDto {
  if (!row)
    return {
      status: SelfEmployedStatus.NOT_SUBMITTED,
      pinflLast4: null,
      activity: null,
      submittedAt: null,
      checkedAt: null,
      reason: null,
      comment: null,
      documentName: null,
    };
  return {
    status: row.status as SelfEmployedStatus,
    pinflLast4: row.pinflLast4,
    activity: SELF_EMPLOYED_ACTIVITY,
    submittedAt: iso(row.submittedAt),
    checkedAt: iso(row.decidedAt),
    reason: row.reason ? SELF_EMPLOYED_REASON_TEXT[row.reason] : null,
    comment: row.comment,
    documentName: row.documentName,
  };
}

function toApplication(row: Row): SelfEmployedApplicationDto {
  return {
    id: row.id,
    affiliateId: row.affiliateId,
    fullName: row.fullName,
    status: row.status as SelfEmployedStatus,
    source: row.source,
    pinflLast4: row.pinflLast4,
    activity: SELF_EMPLOYED_ACTIVITY,
    submittedAt: iso(row.submittedAt)!,
    checkedAt: iso(row.decidedAt),
    checkedBy: row.decidedBy,
    reason: row.reason,
    reasonText: row.reason ? SELF_EMPLOYED_REASON_TEXT[row.reason] : null,
    comment: row.comment,
    documentName: row.documentName,
  };
}
