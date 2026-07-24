import { Injectable } from '@nestjs/common';
import { BusinessException, OutboxEvent, OutboxStatus } from '@app/common';
import { DataSource, EntityManager, MoreThan } from 'typeorm';
import { InventoryOperation } from './entities/inventory-operation.entity';
import {
  ReservationStatus,
  StockMovementType,
} from './entities/inventory.enums';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';

export interface StockTarget {
  variantId: string;
  warehouseId: string;
}

export interface ReserveItem extends StockTarget {
  quantity: number;
}

export interface ReserveInput {
  orderRef: string;
  items: ReserveItem[];
  ttlMs?: number;
  idempotencyKey: string;
}

export interface ReservationActionInput {
  orderRef: string;
  idempotencyKey: string;
  reason?: string;
  actorId?: string;
}

export interface StockIncreaseInput extends StockTarget {
  quantity: number;
  idempotencyKey: string;
  reason: string;
  actorId?: string;
}

export interface StockAdjustInput extends StockTarget {
  quantityDelta: number;
  idempotencyKey: string;
  reason: string;
  actorId: string;
}

export interface InventoryResult {
  operation: StockMovementType;
  orderRef?: string;
  reservationId?: string;
  stockId?: string;
  onHand?: number;
  reserved?: number;
}

@Injectable()
export class InventoryService {
  constructor(private readonly dataSource: DataSource) {}

  reserve(input: ReserveInput): Promise<InventoryResult> {
    this.assertId(input.orderRef, 'orderRef');
    this.assertIdempotencyKey(input.idempotencyKey);
    if (input.items.length === 0) {
      throw BusinessException.invalidState(
        'Rezervatsiyada kamida bitta tovar bo‘lishi kerak',
      );
    }
    this.assertUniqueItems(input.items);
    for (const item of input.items) this.assertPositive(item.quantity);
    if (input.ttlMs !== undefined && input.ttlMs <= 0) {
      throw BusinessException.invalidState('ttlMs musbat bo‘lishi kerak');
    }

    return this.inTransaction(
      'reserve',
      input.idempotencyKey,
      async (manager) => {
        const reservationRepo = manager.getRepository(Reservation);
        const itemRepo = manager.getRepository(ReservationItem);
        const movementRepo = manager.getRepository(StockMovement);
        const reservation = await reservationRepo.save(
          reservationRepo.create({
            orderRef: input.orderRef,
            status: ReservationStatus.HELD,
            expiresAt:
              input.ttlMs === undefined
                ? null
                : new Date(Date.now() + input.ttlMs),
            idempotencyKey: input.idempotencyKey,
          }),
        );

        for (const item of this.sortedItems(input.items)) {
          const stock = await this.lockStock(
            manager,
            item.variantId,
            item.warehouseId,
          );
          if (
            !stock ||
            stock.quantityOnHand - stock.quantityReserved < item.quantity
          ) {
            throw BusinessException.insufficientStock(
              `Variant ${item.variantId} uchun qoldiq yetarli emas`,
            );
          }

          stock.quantityReserved += item.quantity;
          await manager.getRepository(Stock).save(stock);
          await movementRepo.save(
            movementRepo.create(
              this.movement(
                stock,
                StockMovementType.RESERVE,
                item.quantity,
                'RESERVATION',
                reservation.id,
              ),
            ),
          );
          await itemRepo.save(
            itemRepo.create({
              reservationId: reservation.id,
              variantId: item.variantId,
              warehouseId: item.warehouseId,
              quantity: item.quantity,
            }),
          );
        }

        return {
          operation: StockMovementType.RESERVE,
          orderRef: input.orderRef,
          reservationId: reservation.id,
        };
      },
    );
  }

  commit(input: ReservationActionInput): Promise<InventoryResult> {
    return this.finishReservation(
      StockMovementType.COMMIT,
      input,
      ReservationStatus.COMMITTED,
    );
  }

  release(input: ReservationActionInput): Promise<InventoryResult> {
    return this.finishReservation(
      StockMovementType.RELEASE,
      input,
      ReservationStatus.RELEASED,
    );
  }

  async releaseExpired(
    reservationId: string,
    now = new Date(),
  ): Promise<boolean> {
    this.assertId(reservationId, 'reservationId');
    return this.dataSource.transaction(async (manager) => {
      const reservation = await manager
        .getRepository(Reservation)
        .createQueryBuilder('reservation')
        .setLock('pessimistic_write')
        .where('reservation.id = :reservationId', { reservationId })
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.HELD,
        })
        .andWhere('reservation.expires_at < :now', { now })
        .getOne();
      if (!reservation) return false;

      await this.applyReservationTransition(
        manager,
        reservation,
        StockMovementType.RELEASE,
        ReservationStatus.RELEASED,
        'TTL_EXPIRED',
      );
      return true;
    });
  }

  inbound(input: StockIncreaseInput): Promise<InventoryResult> {
    this.assertStockTarget(input);
    this.assertPositive(input.quantity);
    this.assertReason(input.reason);
    this.assertIdempotencyKey(input.idempotencyKey);

    return this.inTransaction(
      'inbound',
      input.idempotencyKey,
      async (manager) => {
        let stock = await this.lockStock(
          manager,
          input.variantId,
          input.warehouseId,
        );
        const stockRepo = manager.getRepository(Stock);
        if (!stock) {
          stock = await stockRepo.save(
            stockRepo.create({
              variantId: input.variantId,
              warehouseId: input.warehouseId,
              quantityOnHand: 0,
              quantityReserved: 0,
              lowStockThreshold: 0,
            }),
          );
        }

        stock.quantityOnHand += input.quantity;
        stock = await stockRepo.save(stock);
        await this.saveMovement(
          manager,
          stock,
          StockMovementType.INBOUND,
          input.quantity,
          input.reason,
          input.actorId,
        );
        return this.stockResult(StockMovementType.INBOUND, stock);
      },
    );
  }

  adjust(input: StockAdjustInput): Promise<InventoryResult> {
    this.assertStockTarget(input);
    if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
      throw BusinessException.invalidState(
        'quantityDelta noldan farqli butun son bo‘lishi kerak',
      );
    }
    this.assertReason(input.reason);
    this.assertId(input.actorId, 'actorId');
    this.assertIdempotencyKey(input.idempotencyKey);

    return this.inTransaction(
      'adjust',
      input.idempotencyKey,
      async (manager) => {
        const stock = await this.lockStock(
          manager,
          input.variantId,
          input.warehouseId,
        );
        if (!stock) {
          throw BusinessException.invalidState('Stock topilmadi');
        }

        const nextOnHand = stock.quantityOnHand + input.quantityDelta;
        if (nextOnHand < stock.quantityReserved || nextOnHand < 0) {
          throw BusinessException.insufficientStock(
            'Tuzatish band qilingan qoldiq invariantini buzadi',
          );
        }
        stock.quantityOnHand = nextOnHand;
        await manager.getRepository(Stock).save(stock);
        await this.saveMovement(
          manager,
          stock,
          StockMovementType.ADJUST,
          input.quantityDelta,
          input.reason,
          input.actorId,
        );
        return this.stockResult(StockMovementType.ADJUST, stock);
      },
    );
  }

  private finishReservation(
    type: StockMovementType.COMMIT | StockMovementType.RELEASE,
    input: ReservationActionInput,
    nextStatus: ReservationStatus,
  ): Promise<InventoryResult> {
    this.assertId(input.orderRef, 'orderRef');
    this.assertIdempotencyKey(input.idempotencyKey);

    return this.inTransaction(
      type.toLowerCase(),
      input.idempotencyKey,
      async (manager) => {
        const reservation = await manager
          .getRepository(Reservation)
          .createQueryBuilder('reservation')
          .setLock('pessimistic_write')
          .where('reservation.order_ref = :orderRef', {
            orderRef: input.orderRef,
          })
          .getOne();
        if (!reservation) {
          throw BusinessException.invalidState('Rezervatsiya topilmadi');
        }
        if (reservation.status !== ReservationStatus.HELD) {
          throw BusinessException.invalidState(
            `Rezervatsiya holati ${reservation.status}`,
          );
        }

        await this.applyReservationTransition(
          manager,
          reservation,
          type,
          nextStatus,
          input.reason,
          input.actorId,
        );
        return {
          operation: type,
          orderRef: reservation.orderRef,
          reservationId: reservation.id,
        };
      },
    );
  }

  private async applyReservationTransition(
    manager: EntityManager,
    reservation: Reservation,
    type: StockMovementType.COMMIT | StockMovementType.RELEASE,
    nextStatus: ReservationStatus,
    reason?: string,
    actorId?: string,
  ): Promise<void> {
    const items = await manager.getRepository(ReservationItem).find({
      where: { reservationId: reservation.id },
    });
    for (const item of this.sortedItems(items)) {
      const stock = await this.lockStock(
        manager,
        item.variantId,
        item.warehouseId,
      );
      if (!stock || stock.quantityReserved < item.quantity) {
        throw BusinessException.invalidState(
          'Band qilingan qoldiq yozuvi mos emas',
        );
      }

      stock.quantityReserved -= item.quantity;
      if (type === StockMovementType.COMMIT) {
        stock.quantityOnHand -= item.quantity;
      }
      await manager.getRepository(Stock).save(stock);
      await this.saveMovement(
        manager,
        stock,
        type,
        -item.quantity,
        reason,
        actorId,
        'RESERVATION',
        reservation.id,
      );
      if (type === StockMovementType.COMMIT) {
        await this.emitStockDepletedIfNeeded(manager, stock);
      }
    }

    reservation.status = nextStatus;
    await manager.getRepository(Reservation).save(reservation);
  }

  private async emitStockDepletedIfNeeded(
    manager: EntityManager,
    stock: Stock,
  ): Promise<void> {
    if (stock.quantityOnHand !== 0) return;

    const hasStockInAnotherWarehouse = await manager
      .getRepository(Stock)
      .exist({
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

  private async inTransaction(
    operation: string,
    idempotencyKey: string,
    work: (manager: EntityManager) => Promise<InventoryResult>,
  ): Promise<InventoryResult> {
    const key = `${operation}:${idempotencyKey}`;
    return this.dataSource.transaction(async (manager) => {
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

  private async lockStock(
    manager: EntityManager,
    variantId: string,
    warehouseId: string,
  ): Promise<Stock | null> {
    this.assertId(variantId, 'variantId');
    this.assertId(warehouseId, 'warehouseId');
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`inventory-stock:${variantId}:${warehouseId}`],
    );
    return manager
      .getRepository(Stock)
      .createQueryBuilder('stock')
      .setLock('pessimistic_write')
      .where('stock.variant_id = :variantId', { variantId })
      .andWhere('stock.warehouse_id = :warehouseId', { warehouseId })
      .getOne();
  }

  private movement(
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

  private saveMovement(
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
        this.movement(
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

  private stockResult(
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

  private sortedItems<T extends StockTarget>(items: T[]): T[] {
    return [...items].sort((a, b) =>
      `${a.warehouseId}:${a.variantId}`.localeCompare(
        `${b.warehouseId}:${b.variantId}`,
        'en',
        { numeric: true },
      ),
    );
  }

  private assertUniqueItems(items: ReserveItem[]): void {
    const keys = new Set<string>();
    for (const item of items) {
      this.assertStockTarget(item);
      const key = `${item.variantId}:${item.warehouseId}`;
      if (keys.has(key)) {
        throw BusinessException.conflict(
          'Bir variant va ombor rezervatsiyada takrorlangan',
        );
      }
      keys.add(key);
    }
  }

  private assertStockTarget(target: StockTarget): void {
    this.assertId(target.variantId, 'variantId');
    this.assertId(target.warehouseId, 'warehouseId');
  }

  private assertPositive(value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw BusinessException.invalidState(
        'Miqdor musbat butun son bo‘lishi kerak',
      );
    }
  }

  private assertReason(reason: string): void {
    if (!reason?.trim()) {
      throw BusinessException.invalidState('Sabab majburiy');
    }
  }

  private assertId(value: string, field: string): void {
    if (!/^[1-9]\d*$/.test(value)) {
      throw BusinessException.invalidState(`${field} noto‘g‘ri`);
    }
  }

  private assertIdempotencyKey(key: string): void {
    if (!key?.trim() || key.length > 230) {
      throw BusinessException.invalidState('Idempotency key noto‘g‘ri');
    }
  }
}
