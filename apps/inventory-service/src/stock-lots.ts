import { EntityManager } from 'typeorm';
import { Stock } from './entities/stock.entity';

/**
 * Yaroqlilik partiyalari (BE-17, TZ OMB-3): muddatga 60 kundan kam qolgan partiya sotuvga chiqmaydi
 * (`sellable_until = expiry_date − 60 kun`). Partiyasiz qoldiq (muddat kuzatilmaydigan tovar) — odatdagidek.
 * Invariant: bir variant va ombordagi partiyalar jami ≤ `quantity_on_hand`.
 */

/** Bugungi sana Toshkent vaqtida (kun chegarasi). */
export const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Tashkent')::date`;

/** Sotuvdan chiqqan (bugun sotib bo‘lmaydigan) partiyalar soni — variant bo‘yicha. */
export async function blockedByVariant(
  manager: EntityManager,
  variantIds: string[],
  warehouseId: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!variantIds.length) return result;
  const rows = (await manager.query(
    `SELECT variant_id::text AS "variantId", SUM(quantity)::int AS blocked
       FROM inventory.stock_lot
      WHERE variant_id = ANY($1::bigint[]) AND warehouse_id = $2 AND quantity > 0
        AND sellable_until < ${TODAY_SQL}
      GROUP BY variant_id`,
    [variantIds, warehouseId],
  )) as Array<{ variantId: string; blocked: number }>;
  for (const row of rows) result.set(row.variantId, Number(row.blocked));
  return result;
}

export async function blockedQuantity(
  manager: EntityManager,
  variantId: string,
  warehouseId: string,
): Promise<number> {
  return (
    (await blockedByVariant(manager, [variantId], warehouseId)).get(
      String(variantId),
    ) ?? 0
  );
}

/**
 * Chiqim (topshirish): sotiladigan partiyalarni muddati yaqinidan boshlab kamaytiradi (FEFO); sotuvdan chiqqan
 * partiyaga tegmaydi. Partiyalar yetmasa — qolgani partiyasiz qoldiqdan.
 */
export async function consumeLots(
  manager: EntityManager,
  variantId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  let remaining = quantity;
  const lots = (await manager.query(
    `SELECT id::text, quantity FROM inventory.stock_lot
      WHERE variant_id = $1 AND warehouse_id = $2 AND quantity > 0
        AND sellable_until >= ${TODAY_SQL}
      ORDER BY expiry_date, id FOR UPDATE`,
    [variantId, warehouseId],
  )) as Array<{ id: string; quantity: number }>;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.quantity));
    await manager.query(
      `UPDATE inventory.stock_lot SET quantity = quantity - $2, updated_at = now() WHERE id = $1`,
      [lot.id, take],
    );
    remaining -= take;
  }
}

/**
 * Qoldiq kamaysa (tuzatish, hisobdan chiqarish, chiqim) partiyalar jami qoldiqdan oshmasin: ortig‘i avval sotuvdan
 * chiqqan partiyalardan, keyin muddati yaqinidan kamaytiriladi.
 */
export async function trimLots(
  manager: EntityManager,
  stock: Stock,
): Promise<void> {
  const lots = (await manager.query(
    `SELECT id::text, quantity FROM inventory.stock_lot
      WHERE variant_id = $1 AND warehouse_id = $2 AND quantity > 0
      ORDER BY (sellable_until < ${TODAY_SQL}) DESC, expiry_date, id FOR UPDATE`,
    [stock.variantId, stock.warehouseId],
  )) as Array<{ id: string; quantity: number }>;
  let excess =
    lots.reduce((sum, lot) => sum + Number(lot.quantity), 0) -
    stock.quantityOnHand;
  for (const lot of lots) {
    if (excess <= 0) break;
    const take = Math.min(excess, Number(lot.quantity));
    await manager.query(
      `UPDATE inventory.stock_lot SET quantity = quantity - $2, updated_at = now() WHERE id = $1`,
      [lot.id, take],
    );
    excess -= take;
  }
}
