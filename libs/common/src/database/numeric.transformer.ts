import { ValueTransformer } from 'typeorm';

/**
 * Pul/numeric ustunlar uchun transformer.
 * PostgreSQL `numeric` ni TypeORM string qaytaradi — bu esa hisob-kitobda xato
 * (masalan "10.00" + "5.00"). Shu transformer bilan har doim `number` bo'ladi,
 * aniqlik yo'qolmaydi (numeric(14,2) JS xavfsiz diapazonda).
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null | undefined =>
    value === null || value === undefined ? value : Number(value),
};
