import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  ReservationStatus,
  StockMovementType,
} from '@app/common';
import { DataSource, EntityManager } from 'typeorm';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { Stock } from './entities/stock.entity';
import {
  assertId,
  assertIdempotencyKey,
  assertPositive,
  assertReason,
  assertStockTarget,
  assertUniqueItems,
  sortedItems,
} from './inventory.assertions';
import {
  emitStockDepletedIfNeeded,
  lockStock,
  runInTransaction,
  saveMovement,
  stockResult,
} from './inventory.helpers';
import {
  InventoryResult,
  ReservationActionInput,
  ReturnOrderItemsInput,
  ReserveInput,
  StockAdjustInput,
  StockIncreaseInput,
} from './inventory.types';

@Injectable()
export class InventoryService {
  constructor(private readonly dataSource: DataSource) {}

  reserve(input: ReserveInput): Promise<InventoryResult> {
    assertId(input.orderRef, 'orderRef');
    assertIdempotencyKey(input.idempotencyKey);
    if (input.items.length === 0) {
      throw BusinessException.invalidState(
        'Rezervatsiyada kamida bitta tovar bo‘lishi kerak',
      );
    }
    assertUniqueItems(input.items);
    for (const item of input.items) assertPositive(item.quantity);
    if (input.ttlMs !== undefined && input.ttlMs <= 0) {
      throw BusinessException.invalidState('ttlMs musbat bo‘lishi kerak');
    }

    return runInTransaction(
      this.dataSource,
      'reserve',
      input.idempotencyKey,
      async (manager) => {
        const reservationRepo = manager.getRepository(Reservation);
        const itemRepo = manager.getRepository(ReservationItem);
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

        for (const item of sortedItems(input.items)) {
          const stock = await lockStock(
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
          await saveMovement(
            manager,
            stock,
            StockMovementType.RESERVE,
            item.quantity,
            undefined,
            undefined,
            'RESERVATION',
            reservation.id,
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

  /** Checkout uchun variantni qoldig‘i mavjud omborga bog‘lab, atomik reserve qiladi. */
  async reserveAvailable(input: {
    orderRef: string;
    items: Array<{ variantId: string; quantity: number }>;
    ttlMs?: number;
    idempotencyKey: string;
  }): Promise<InventoryResult> {
    const resolved = [] as ReserveInput['items'];
    for (const item of input.items) {
      const stock = await this.dataSource
        .getRepository(Stock)
        .createQueryBuilder('stock')
        .where('stock.variantId = :variantId', { variantId: item.variantId })
        .andWhere(
          '(stock.quantityOnHand - stock.quantityReserved) >= :quantity',
          {
            quantity: item.quantity,
          },
        )
        .orderBy('(stock.quantityOnHand - stock.quantityReserved)', 'DESC')
        .addOrderBy('stock.id', 'ASC')
        .getOne();
      if (!stock) {
        throw BusinessException.insufficientStock(
          `Variant ${item.variantId} uchun qoldiq yetarli emas`,
        );
      }
      resolved.push({ ...item, warehouseId: stock.warehouseId });
    }
    return this.reserve({ ...input, items: resolved });
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
    assertId(reservationId, 'reservationId');
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
    assertStockTarget(input);
    assertPositive(input.quantity);
    assertReason(input.reason);
    assertIdempotencyKey(input.idempotencyKey);

    return runInTransaction(
      this.dataSource,
      'inbound',
      input.idempotencyKey,
      async (manager) => {
        let stock = await lockStock(
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
        await saveMovement(
          manager,
          stock,
          StockMovementType.INBOUND,
          input.quantity,
          input.reason,
          input.actorId,
        );
        return stockResult(StockMovementType.INBOUND, stock);
      },
    );
  }

  returnOrderItems(input: ReturnOrderItemsInput): Promise<InventoryResult> {
    assertId(input.orderRef, 'orderRef');
    assertIdempotencyKey(input.idempotencyKey);
    assertReason(input.reason);
    if (!input.items.length) {
      throw BusinessException.invalidState('Qaytariladigan tovarlar topilmadi');
    }
    assertUniqueItems(
      input.items.map((item) => ({ ...item, warehouseId: '1' })),
    );
    for (const item of input.items) assertPositive(item.quantity);

    return runInTransaction(
      this.dataSource,
      'return-order-items',
      input.idempotencyKey,
      async (manager) => {
        const reservation = await manager.getRepository(Reservation).findOne({
          where: {
            orderRef: input.orderRef,
            status: ReservationStatus.COMMITTED,
          },
        });
        if (!reservation) {
          throw BusinessException.invalidState(
            'Committed rezervatsiya topilmadi',
          );
        }
        const allocations = await manager.getRepository(ReservationItem).find({
          where: { reservationId: reservation.id },
          order: { id: 'ASC' },
        });

        for (const requested of input.items) {
          let remaining = requested.quantity;
          for (const allocation of allocations.filter(
            (item) => item.variantId === requested.variantId,
          )) {
            if (remaining === 0) break;
            const quantity = Math.min(remaining, allocation.quantity);
            const stock = await lockStock(
              manager,
              allocation.variantId,
              allocation.warehouseId,
            );
            if (!stock) {
              throw BusinessException.invalidState('Stock topilmadi');
            }
            stock.quantityOnHand += quantity;
            await manager.getRepository(Stock).save(stock);
            await saveMovement(
              manager,
              stock,
              StockMovementType.INBOUND,
              quantity,
              input.reason,
              undefined,
              'RESERVATION',
              reservation.id,
            );
            remaining -= quantity;
          }
          if (remaining > 0) {
            throw BusinessException.invalidState(
              `Variant ${requested.variantId} qaytarish miqdori rezervatsiyadan katta`,
            );
          }
        }

        return {
          operation: StockMovementType.INBOUND,
          orderRef: input.orderRef,
          reservationId: reservation.id,
        };
      },
    );
  }

  adjust(input: StockAdjustInput): Promise<InventoryResult> {
    assertStockTarget(input);
    if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
      throw BusinessException.invalidState(
        'quantityDelta noldan farqli butun son bo‘lishi kerak',
      );
    }
    assertReason(input.reason);
    assertId(input.actorId, 'actorId');
    assertIdempotencyKey(input.idempotencyKey);

    return runInTransaction(
      this.dataSource,
      'adjust',
      input.idempotencyKey,
      async (manager) => {
        const stock = await lockStock(
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
        await saveMovement(
          manager,
          stock,
          StockMovementType.ADJUST,
          input.quantityDelta,
          input.reason,
          input.actorId,
        );
        return stockResult(StockMovementType.ADJUST, stock);
      },
    );
  }

  private finishReservation(
    type: StockMovementType.COMMIT | StockMovementType.RELEASE,
    input: ReservationActionInput,
    nextStatus: ReservationStatus,
  ): Promise<InventoryResult> {
    assertId(input.orderRef, 'orderRef');
    assertIdempotencyKey(input.idempotencyKey);

    return runInTransaction(
      this.dataSource,
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
    for (const item of sortedItems(items)) {
      const stock = await lockStock(manager, item.variantId, item.warehouseId);
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
      await saveMovement(
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
        await emitStockDepletedIfNeeded(manager, stock);
      }
    }

    reservation.status = nextStatus;
    await manager.getRepository(Reservation).save(reservation);
  }
}
