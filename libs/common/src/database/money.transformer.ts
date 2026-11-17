import { ValueTransformer } from 'typeorm';

/**
 * Pul ustunlari uchun yagona transformer (BE-01; TZ T9-1, T8 «Pul»): BIGINT, butun so‘m.
 * pg BIGINT ni satr qaytaradi — `number` ga o‘giriladi; Number.MAX_SAFE_INTEGER (≈ 9·10^15 so‘m) dan oshsa xato.
 * Yozishda faqat butun son qabul qilinadi: kasr so‘m bazaga tushmaydi (yaxlitlash — hisoblovchi kodning ishi).
 */
export const moneyTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => {
    if (value === null || value === undefined) return value;
    if (!Number.isSafeInteger(value))
      throw new Error(`Pul butun so‘m bo‘lishi kerak: ${value}`);
    return value;
  },
  from: (value?: string | number | null): number | null | undefined => {
    if (value === null || value === undefined) return value;
    const n = Number(value);
    if (!Number.isSafeInteger(n))
      throw new Error(`Pul qiymati butun emas yoki juda katta: ${value}`);
    return n;
  },
};

/** Raw SQL natijasidagi BIGINT pul (satr) → number; `null` → 0 (COALESCE kabi). */
export function moneyFromDb(value: string | number | null | undefined): number {
  return moneyTransformer.from(value ?? 0) as number;
}

/** Raw SQL natijasidagi ixtiyoriy BIGINT pul → number | null. */
export function moneyOrNull(
  value: string | number | null | undefined,
): number | null {
  return value === null || value === undefined ? null : moneyFromDb(value);
}
