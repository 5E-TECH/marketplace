import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FinanceSettingCancelInput,
  FinanceSettingKey,
  FinanceSettingSetInput,
  FinanceSettingSetResult,
  FinanceSettingStateDto,
  FinanceSettingValueDto,
  MAX_MONEY,
  moneyFromDb,
} from '@app/common';

const KEYS = Object.values(FinanceSettingKey) as string[];
/** Soat farqi va so‘rov yo‘li uchun: «hozir» deb yuborilgan vaqt bir necha soniya orqada bo‘lishi mumkin. */
const PAST_TOLERANCE_MS = 60_000;
const HISTORY_LIMIT = 20;

interface Row {
  key: string;
  value: string;
  effectiveFrom: Date;
  changedBy: string | null;
}

/**
 * BE-27 (ADM-2): moliya sozlamalarini o‘qish va yangi qiymat kiritish (`finance.setting`, versiyali — BE-22).
 * Eski qator o‘zgarmaydi: o‘tgan hodisalar o‘sha paytdagi qiymat bilan hisoblangan bo‘lib qoladi.
 */
@Injectable()
export class FinanceSettingsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(): Promise<FinanceSettingStateDto[]> {
    const rows = (await this.dataSource.query(
      `SELECT key, value::text AS value, effective_from AS "effectiveFrom", changed_by AS "changedBy"
         FROM finance.setting
        WHERE key = ANY($1)
        ORDER BY key, effective_from DESC`,
      [KEYS],
    )) as Row[];
    const now = Date.now();
    return (Object.values(FinanceSettingKey) as FinanceSettingKey[]).map(
      (key) => {
        const own = rows.filter((r) => r.key === key);
        const past = own.filter(
          (r) => new Date(r.effectiveFrom).getTime() <= now,
        );
        return {
          key,
          current: past[0] ? view(past[0]) : null,
          scheduled: own
            .filter((r) => new Date(r.effectiveFrom).getTime() > now)
            .reverse()
            .map(view),
          history: past.slice(1, 1 + HISTORY_LIMIT).map(view),
        };
      },
    );
  }

  async set(input: FinanceSettingSetInput): Promise<FinanceSettingSetResult> {
    const key = String(input?.key ?? '');
    if (!KEYS.includes(key))
      throw new BadRequestException(`Noma’lum sozlama: ${key}`);
    const value = Number(input?.value);
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY)
      throw new BadRequestException('Qiymat butun so‘m, 0 dan kichik emas');
    // Minimal yechish 0 bo‘lsa har qanday summa yechiladi — mantiqsiz (BE-23 da summa > 0)
    if (key === FinanceSettingKey.WITHDRAWAL_MIN && value < 1)
      throw new BadRequestException(
        'Minimal yechish 0 dan katta bo‘lishi kerak',
      );
    const requested = effectiveTime(input?.effectiveFrom);
    if (requested.getTime() < Date.now() - PAST_TOLERANCE_MS)
      throw new BadRequestException(
        'Kuchga kirish vaqti o‘tmishda bo‘lmaydi — o‘tgan hisob-kitob o‘zgarmaydi',
      );
    // bir necha soniya orqada kelgan «hozir» — hozirdan: allaqachon hisoblangan hodisalarga ta’sir qilmasin
    const at = new Date(Math.max(requested.getTime(), Date.now()));
    const actorId = String(input?.actorId ?? '');
    if (!/^[1-9]\d{0,18}$/.test(actorId))
      throw new BadRequestException('Kim o‘zgartirgani noma’lum');
    const comment = String(input?.comment ?? '').trim();
    if (comment.length < 3 || comment.length > 500)
      throw new BadRequestException('Izoh majburiy (3–500 belgi)');

    return this.dataSource.transaction(async (m) => {
      // bir kalitga parallel ikki o‘zgarish bir-birini ko‘rsin (oldingi qiymat auditda to‘g‘ri chiqsin)
      await m.query(
        `SELECT pg_advisory_xact_lock(hashtext('finance.setting:' || $1))`,
        [key],
      );
      const [before] = (await m.query(
        `SELECT value::text AS value FROM finance.setting
          WHERE key = $1 AND effective_from <= $2
          ORDER BY effective_from DESC LIMIT 1`,
        [key, at],
      )) as Array<{ value: string }>;
      const inserted = (await m.query(
        `INSERT INTO finance.setting (key, value, effective_from, changed_by, comment)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key, effective_from) DO NOTHING
         RETURNING effective_from AS "effectiveFrom"`,
        [key, value, at, `user:${actorId}`, comment],
      )) as Array<{ effectiveFrom: Date }>;
      if (!inserted.length)
        throw new ConflictException(
          'Shu vaqtga bu sozlama allaqachon kiritilgan',
        );
      // keyinroq rejalashtirilganlar shu qiymatni o‘sha vaqtda almashtiradi — javobda ko‘rinsin (bekor qilish mumkin)
      const later = (await m.query(
        `SELECT value::text AS value, effective_from AS "effectiveFrom", changed_by AS "changedBy"
           FROM finance.setting WHERE key = $1 AND effective_from > $2
          ORDER BY effective_from`,
        [key, at],
      )) as Array<{
        value: string;
        effectiveFrom: Date;
        changedBy: string | null;
      }>;
      return {
        key: key as FinanceSettingKey,
        before: before ? moneyFromDb(before.value) : null,
        after: value,
        effectiveFrom: new Date(inserted[0].effectiveFrom).toISOString(),
        laterScheduled: later.map((r) => view({ ...r, key })),
      };
    });
  }

  /**
   * Hali kuchga kirmagan rejalashtirilgan qiymatni bekor qilish. Bunday qator hech bir hisob-kitobda ishlatilmagan,
   * shuning uchun o‘chiriladi; nima bekor qilingani auditga yoziladi (gateway).
   */
  async cancelScheduled(
    input: FinanceSettingCancelInput,
  ): Promise<FinanceSettingValueDto> {
    const key = String(input?.key ?? '');
    if (!KEYS.includes(key))
      throw new BadRequestException(`Noma’lum sozlama: ${key}`);
    const at = new Date(String(input?.effectiveFrom ?? ''));
    if (!Number.isFinite(at.getTime()))
      throw new BadRequestException('Kuchga kirish vaqti noto‘g‘ri');
    const rows = (await this.dataSource.query(
      `DELETE FROM finance.setting
        WHERE key = $1 AND effective_from = $2 AND effective_from > now()
        RETURNING key, value::text AS value, effective_from AS "effectiveFrom", changed_by AS "changedBy"`,
      [key, at],
    )) as unknown as Row[] | [Row[], number];
    // pg DELETE … RETURNING: TypeORM [rows, count] qaytaradi
    const deleted = (Array.isArray(rows[0]) ? rows[0] : rows) as Row[];
    if (!deleted.length)
      throw new NotFoundException(
        'Rejalashtirilgan qiymat topilmadi yoki allaqachon kuchga kirgan',
      );
    return view(deleted[0]);
  }
}

/**
 * Kuchga kirish vaqti. Faqat sana (`2026-12-01`) — Toshkent kuni boshi (UTC yarim tun emas, 05:00 bo‘lib qolmasin).
 */
function effectiveTime(value: string | undefined): Date {
  if (!value) return new Date();
  const text = String(value).trim();
  const at = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+05:00` : text,
  );
  if (!Number.isFinite(at.getTime()))
    throw new BadRequestException('Kuchga kirish vaqti noto‘g‘ri');
  return at;
}

function view(row: Row): FinanceSettingValueDto {
  return {
    value: moneyFromDb(row.value),
    effectiveFrom: new Date(row.effectiveFrom).toISOString(),
    changedBy: row.changedBy,
  };
}
