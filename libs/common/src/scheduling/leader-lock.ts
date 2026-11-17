import { DataSource } from 'typeorm';

/**
 * Jadvalli ishlar (cron) uchun yetakchi qulf (BE-03, TZ T9-3).
 *
 * Servis bir nechta nusxada ishlasa, `@Cron` har nusxada uradi. Ish
 * `runAsLeader` ichida bajarilsa, bir vaqtda faqat qulfni olgan nusxa
 * ishlaydi; qolganlari shu urishni kutmasdan o'tkazib yuboradi.
 *
 * Qulf tranzaksiya darajasida (`pg_try_advisory_xact_lock`) alohida
 * ulanishda olinadi va ish tugaguncha shu tranzaksiya ochiq turadi. Qulf
 * commit/rollback bilan, ulanish uzilsa esa Postgres tomonidan o'zi
 * bo'shaydi — pulda qolib ketgan qulf bo'lmaydi.
 *
 * Ishning o'zi boshqa ulanishlarda ishlaydi (qulf ulanishi faqat qulfni
 * ushlaydi). Ikki argumentli shakl bitta kalitli qulflardan alohida
 * kalit fazosi; sinf 2201 (lead-service dagi 2101/2102 dan farqli).
 */
export const LEADER_LOCK_CLASS = 2201;

export type LeaderRun<T> = { ran: true; result: T } | { ran: false };

export async function runAsLeader<T>(
  dataSource: DataSource,
  name: string,
  job: () => Promise<T>,
): Promise<LeaderRun<T>> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    const [row] = (await runner.query(
      'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked',
      [LEADER_LOCK_CLASS, name],
    )) as Array<{ locked: boolean }>;
    if (!row?.locked) return { ran: false };
    return { ran: true, result: await job() };
  } finally {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction().catch(() => undefined);
    }
    await runner.release();
  }
}
