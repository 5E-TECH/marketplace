import { FinanceDateRangeQueryDto } from '@app/common';

/**
 * `dateFrom`/`dateTo` filtrining SQL shartlari (kun bo'yicha, `dateTo` kuni
 * ham kiradi). Qiymatlar `params`ga qo'shiladi, placeholder raqami shundan.
 */
export function dateRangeConditions(
  column: string,
  query: FinanceDateRangeQueryDto,
  params: unknown[],
): string[] {
  const conditions: string[] = [];
  if (query.dateFrom)
    conditions.push(`${column} >= $${params.push(query.dateFrom)}`);
  if (query.dateTo)
    conditions.push(
      `${column} < ($${params.push(query.dateTo)}::date + INTERVAL '1 day')`,
    );
  return conditions;
}
