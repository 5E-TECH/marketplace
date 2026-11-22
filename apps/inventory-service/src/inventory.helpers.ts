import {
  INBOUND_RECEIVED_EVENT,
  InboundReceivedEvent,
  OutboxEvent,
  OutboxStatus,
  STOCK_DEPLETED_EVENT,
  StockDepletedEvent,
  StockMovementType,
} from '@app/common';
import { DataSource, EntityManager, In, MoreThan } from 'typeorm';
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

/** BE-47: notification’ga boradigan inventory hodisalari (outbox relay yo‘nalishi). */
export const NOTIFICATION_EVENTS: ReadonlySet<string> = new Set([
  STOCK_DEPLETED_EVENT,
  INBOUND_RECEIVED_EVENT,
]);

/**
 * BE-47 (TZ 6.12 «Offer qoldig‘i tugadi»): HQ da bo‘sh va sotuvga yaroqli qoldig‘i (qoldiq − band − muddatdan chiqqan
 * partiyalar) 0 bo‘lgan variantlar — o‘sha tranzaksiyada outbox’ga (yo‘qolmaydi). Qoldiq kamayadigan har amaldan keyin.
 */
export async function recordOfferOutOfStock(
  manager: EntityManager,
  variantIds: string[],
  warehouseId: string,
  blocked: (
    manager: EntityManager,
    ids: string[],
    warehouseId: string,
  ) => Promise<Map<string, number>>,
): Promise<void> {
  const ids = [...new Set(variantIds.map(String))].filter((id) =>
    /^[1-9]\d{0,18}$/.test(id),
  );
  if (!ids.length) return;
  const rows = await manager
    .getRepository(Stock)
    .find({ where: { variantId: In(ids), warehouseId } });
  const lots = await blocked(manager, ids, warehouseId);
  const empty = rows
    .filter(
      (row) =>
        row.quantityOnHand -
          row.quantityReserved -
          (lots.get(String(row.variantId)) ?? 0) <=
        0,
    )
    .map((row) => String(row.variantId));
  if (!empty.length) return;
  const payload: StockDepletedEvent = {
    variantIds: empty,
    at: new Date().toISOString(),
  };
  const repo = manager.getRepository(OutboxEvent);
  await repo.save(
    repo.create({
      // katalogdagi `inventory.stock_depleted` (product_variant) navbatini to‘smasin — alohida kalit
      aggregateType: 'offer_stock_notice',
      aggregateId: empty[0],
      eventType: STOCK_DEPLETED_EVENT,
      payload: payload as unknown as Record<string, unknown>,
      status: OutboxStatus.PENDING,
    }),
  );
}

/** BE-47: postavka qabul qilindi — o‘sha tranzaksiyada outbox’ga (optovik kabineti). */
export async function recordInboundReceived(
  manager: EntityManager,
  event: InboundReceivedEvent,
): Promise<void> {
  const repo = manager.getRepository(OutboxEvent);
  await repo.save(
    repo.create({
      aggregateType: 'inbound_shipment',
      aggregateId: event.shipmentId,
      eventType: INBOUND_RECEIVED_EVENT,
      payload: event as unknown as Record<string, unknown>,
      status: OutboxStatus.PENDING,
    }),
  );
}
