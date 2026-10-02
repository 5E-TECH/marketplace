/**
 * `query()` natijasidan RETURNING qatorlari. TypeORM postgres drayveri
 * UPDATE/DELETE uchun `[qatorlar, soni]`, SELECT/INSERT uchun esa
 * qatorlarning o'zini qaytaradi — `const [row] = ...` UPDATE'da qator emas,
 * massiv beradi (topilmaganda ham bo'sh massiv — "truthy").
 */
export function returningRows<T>(result: unknown): T[] {
  const value = result as unknown[];
  const isUpdateShape =
    value.length === 2 &&
    Array.isArray(value[0]) &&
    typeof value[1] === 'number';
  return (isUpdateShape ? value[0] : value) as T[];
}
