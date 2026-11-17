import { ValueTransformer } from 'typeorm';

/**
 * Kasrli `numeric` ustunlar uchun transformer (reyting, komissiya foizi;
 * payment va finance xizmatlarining summalari hozircha NUMERIC).
 * PostgreSQL `numeric` ni TypeORM string qaytaradi — bu esa hisob-kitobda xato
 * (masalan "10.00" + "5.00"). Shu transformer bilan har doim `number` bo'ladi.
 * Catalog, checkout, identity, search va Elchi integratsiyasidagi pul — BIGINT,
 * butun so'm: `moneyTransformer` (BE-01).
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null | undefined =>
    value === null || value === undefined ? value : Number(value),
};
