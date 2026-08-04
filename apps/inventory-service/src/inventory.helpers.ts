import { OutboxEvent, OutboxStatus, StockMovementType } from '@app/common';
import { DataSource, EntityManager, MoreThan } from 'typeorm';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';
import { assertId } from './inventory.assertions';
import { InventoryResult } from './inventory.types';

/**
 * DB-mexanikasi (tranzaksiya, qulf, movement yozish, out-of-stock event) —
 * `manager`/`dataSource` parametr sifatida uzatiladi, shu bois InventoryService
 * konstruktori o'zgarmaydi va bu funksiyalar bo'lajak servislarda ham
 * qayta ishlatiladi.
 */

export function buildMovement(
  stock: Stock,
  type: StockMovementType,
  quantity: number,
  referenceType: string | null = null,
  referenceId: string | null = null,
  reason: string | null = null,
  actorId: string | null = null,
): Partial<StockMovement> {
  return {
    stockId: stock.id,
    variantId: stock.variantId,
    warehouseId: stock.warehouseId,
    type,
    quantity,
    onHandAfter: stock.quantityOnHand,
    reservedAfter: stock.quantityReserved,
    referenceType,
    referenceId,
    reason,
    actorId,
  };
}

/**
 * Idempotent tranzaksiya: bir xil (operation, idempotencyKey) ikkinchi marta
 * chaqirilsa saqlangan natijani qaytaradi, ish ikki marta bajarilmaydi.
 */
export async function runInTransaction(
  dataSource: DataSource,
  operation: string,
  idempotencyKey: string,
  work: (manager: EntityManager) => Promise<InventoryResult>,
): Promise<InventoryResult> {
  const key = `${operation}:${idempotencyKey}`;
  return dataSource.transaction(async (manager) => {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`inventory-operation:${key}`],
    );
    const operationRepo = manager.getRepository(InventoryOperation);
    const existing = await operationRepo.findOne({ where: { key } });
    if (existing) return existing.response as InventoryResult;

    const result = await work(manager);
    await operationRepo.save(operationRepo.create({ key, response: result }));
    return result;
  });
}

export async function lockStock(
  manager: EntityManager,
  variantId: string,
  warehouseId: string,
): Promise<Stock | null> {
  assertId(variantId, 'variantId');
  assertId(warehouseId, 'warehouseId');
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `inventory-stock:${variantId}:${warehouseId}`,
  ]);
  return manager
    .getRepository(Stock)
    .createQueryBuilder('stock')
    .setLock('pessimistic_write')
    .where('stock.variant_id = :variantId', { variantId })
    .andWhere('stock.warehouse_id = :warehouseId', { warehouseId })
    .getOne();
}

export function saveMovement(
  manager: EntityManager,
  stock: Stock,
  type: StockMovementType,
  quantity: number,
  reason?: string,
  actorId?: string,
  referenceType: string | null = null,
  referenceId: string | null = null,
): Promise<StockMovement> {
  const repo = manager.getRepository(StockMovement);
  return repo.save(
    repo.create(
      buildMovement(
        stock,
        type,
        quantity,
        referenceType,
        referenceId,
        reason ?? null,
        actorId ?? null,
      ),
    ),
  );
}

export function stockResult(
  operation: StockMovementType,
  stock: Stock,
): InventoryResult {
  return {
    operation,
    stockId: stock.id,
    onHand: stock.quantityOnHand,
    reserved: stock.quantityReserved,
  };
}

/**
 * Variant hech qaysi omborda qolmasa (on_hand=0 hamma joyda) — catalog'ga
 * OUT_OF_STOCK eventini outbox orqali ishonchli yuboradi.
 */
export async function emitStockDepletedIfNeeded(
  manager: EntityManager,
  stock: Stock,
): Promise<void> {
  if (stock.quantityOnHand !== 0) return;

  const hasStockInAnotherWarehouse = await manager.getRepository(Stock).exist({
    where: {
      variantId: stock.variantId,
      quantityOnHand: MoreThan(0),
    },
  });
  if (hasStockInAnotherWarehouse) return;

  const repo = manager.getRepository(OutboxEvent);
  await repo.save(
    repo.create({
      aggregateType: 'product_variant',
      aggregateId: stock.variantId,
      eventType: 'inventory.stock_depleted',
      payload: {
        variantId: stock.variantId,
        warehouseId: stock.warehouseId,
        status: 'OUT_OF_STOCK',
      },
      status: OutboxStatus.PENDING,
    }),
  );
}
