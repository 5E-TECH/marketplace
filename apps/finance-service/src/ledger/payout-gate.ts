import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ErrorCode, normalizeFullName, SelfEmployedStatus } from '@app/common';

const ID = /^\d{1,19}$/;
/** Pul yechish qulfi kalit sinfi [taklif]: 2101/2102 lead, 2201 cron, 2301/2302 ledger, 6303 payment band. */
const WITHDRAWAL_LOCK_CLASS = 2303;

export function validId(value: unknown, field: string): string {
  const s = String(value ?? '');
  if (!ID.test(s)) throw new BadRequestException(`${field} noto‘g‘ri`);
  return s;
}

/** Sotuvchining pul yechish qulfi — so‘rov, to‘lov va maqom qarori (BE-25 5-tur) ketma-ket. */
export async function affiliatePayoutLock(
  m: EntityManager,
  affiliateId: string,
): Promise<void> {
  await m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
    WITHDRAWAL_LOCK_CLASS,
    `finance-withdrawal:${affiliateId}`,
  ]);
}

export async function selfEmployedGate(
  m: EntityManager,
  affiliateId: string,
): Promise<boolean> {
  const [row] = (await m.query(
    `SELECT self_employed AS "selfEmployed" FROM finance.affiliate_payout_profile WHERE affiliate_id = $1`,
    [affiliateId],
  )) as Array<{ selfEmployed: boolean }>;
  return row?.selfEmployed ?? false;
}

/**
 * Pul o‘tkazishdan oldin (moliya tasdig‘ida): maqom tasdiqlangan va tasdiqlangan ism profildagi ism bilan bir xil —
 * to‘lov va soliq hisoboti tekshirilgan shaxsga. Ismi noma’lum eski qo‘lda belgi (bo‘sh) — faqat maqom.
 */
export async function assertPayable(
  m: EntityManager,
  affiliateId: string,
  currentFullName: unknown,
): Promise<void> {
  const [row] = (await m.query(
    `SELECT status, full_name AS "fullName" FROM finance.self_employed_application
      WHERE affiliate_id = $1 ORDER BY id DESC LIMIT 1`,
    [affiliateId],
  )) as Array<{ status: string; fullName: string }>;
  if (
    !(await selfEmployedGate(m, affiliateId)) ||
    row?.status !== SelfEmployedStatus.VERIFIED
  )
    throw new BadRequestException({
      message:
        'O‘zini o‘zi band qilganlik maqomi tasdiqlanmagan — to‘lov qilinmaydi (T01:471)',
      errorCode: ErrorCode.BUSINESS_RULE_VIOLATION,
    });
  if (row.fullName && normalizeFullName(currentFullName) !== row.fullName)
    throw new ConflictException({
      message:
        'Profildagi ism tasdiqlangan ismdan farq qiladi — maqom qayta tekshiriladi',
      errorCode: ErrorCode.NAME_CHANGED,
    });
}
