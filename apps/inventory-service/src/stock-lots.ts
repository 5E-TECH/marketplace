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
  options: { preferSellable?: boolean } = {},
): Promise<void> {
  // odatda avval sotuvdan chiqqanlari; yaxshi tovar hisobdan chiqarilganda — avval sotiladiganlari
  const order = options.preferSellable
    ? `(sellable_until < ${TODAY_SQL}) ASC, expiry_date, id`
    : `(sellable_until < ${TODAY_SQL}) DESC, expiry_date, id`;
  const lots = (await manager.query(
    `SELECT id::text, quantity FROM inventory.stock_lot
      WHERE variant_id = $1 AND warehouse_id = $2 AND quantity > 0
      ORDER BY ${order} FOR UPDATE`,
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

/**
 * Hisobdan chiqarish (manfiy tuzatish), aniq tanlov bilan:
 * - `lotId` — o‘sha partiyadan (masalan, muddati o‘tgan tovar);
 * - `goodStock` — yaxshi tovar (partiyasiz yoki sotiladigan partiya); sotuvdan chiqqan partiyaga tegilmaydi;
 * - hech biri bo‘lmasa va SKU da sotuvdan chiqqan partiya bor — tanlov majburiy (taxmin noto‘g‘ri qoldiq beradi).
 * Keyin `trimLots` invariantni saqlaydi (yaxshi tovar chiqarilsa — sotiladigan partiyalardan).
 */
export async function writeOffLots(
  manager: EntityManager,
  stock: Stock,
  quantity: number,
  choice: { lotId?: string; goodStock?: boolean },
): Promise<void> {
  if (choice.lotId) {
    const [lot] = (await manager.query(
      `SELECT id::text, quantity FROM inventory.stock_lot
        WHERE id = $1 AND variant_id = $2 AND warehouse_id = $3 FOR UPDATE`,
      [choice.lotId, stock.variantId, stock.warehouseId],
    )) as Array<{ id: string; quantity: number }>;
    if (!lot) throw new LotNotFoundError();
    if (Number(lot.quantity) < quantity) throw new LotTooSmallError();
    await manager.query(
      `UPDATE inventory.stock_lot SET quantity = quantity - $2, updated_at = now() WHERE id = $1`,
      [lot.id, quantity],
    );
    await trimLots(manager, stock);
    return;
  }
  if (!choice.goodStock) {
    const blocked = await blockedQuantity(
      manager,
      stock.variantId,
      stock.warehouseId,
    );
    if (blocked > 0) throw new LotChoiceRequiredError();
  }
  await trimLots(manager, stock, { preferSellable: true });
}

export class LotChoiceRequiredError extends Error {
  constructor() {
    super(
      'Bu SKU da sotuvdan chiqqan partiya bor: lotId (muddati o‘tgan partiya) yoki goodStock: true (yaxshi tovar) ni ko‘rsating',
    );
  }
}

export class LotNotFoundError extends Error {
  constructor() {
    super('Partiya topilmadi');
  }
}

export class LotTooSmallError extends Error {
  constructor() {
    super('Partiyada buncha tovar yo‘q');
  }
}
