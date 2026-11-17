/**
 * `manager.query()` natijasidan qatorlarni oladi. TypeORM Postgres drayveri
 * `INSERT … RETURNING` va `SELECT` uchun qatorlar massivini, lekin
 * `UPDATE … RETURNING` va `DELETE … RETURNING` uchun `[qatorlar, soni]`
 * juftligini qaytaradi — `.length` bilan tekshirish shunda doim 2 bo'lardi.
 */
export function queryRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return (Array.isArray(result) ? result : []) as T[];
}
