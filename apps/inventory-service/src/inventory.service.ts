import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  ReservationStatus,
  StockMovementType,
  WarehouseOwnerType,
} from '@app/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
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
import {
  blockedByVariant,
  blockedQuantity,
  consumeLots,
  LotNotFoundError,
  LotTooSmallError,
  trimLots,
  writeOffLots,
} from './stock-lots';

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
          // BE-17 (OMB-3): muddatga 60 kundan kam qolgan partiya sotilmaydi
          const blocked = stock
            ? await blockedQuantity(manager, item.variantId, item.warehouseId)
            : 0;
          if (
            !stock ||
            stock.quantityOnHand - stock.quantityReserved - blocked <
              item.quantity
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

  /** BE-16 (TZ 6.6): platformaning bitta HQ ombori. Yo‘q bo‘lsa — sozlash xatosi (migratsiya yaratadi). */
  async hqWarehouseId(): Promise<string> {
    const hq = await this.dataSource.getRepository(Warehouse).findOne({
      where: {
        ownerType: WarehouseOwnerType.HQ,
        isDeleted: false,
        isActive: true,
      },
    });
    if (!hq) throw BusinessException.invalidState('HQ ombor topilmadi');
    return String(hq.id);
  }

  /**
   * Buyurtma uchun band qilish (tasdiqda): har tovar HQ ombordan. Qoldiq yetmasa — rad; ikki parallel band oxirgi
   * dona uchun — qator qulfi (`lockStock`) bilan bittasi rad (TC4).
   */
  async reserveAvailable(input: {
    orderRef: string;
    items: Array<{ variantId: string; quantity: number }>;
    ttlMs?: number;
    idempotencyKey: string;
  }): Promise<InventoryResult> {
    const warehouseId = await this.hqWarehouseId();
    return this.reserve({
      ...input,
      items: input.items.map((item) => ({ ...item, warehouseId })),
    });
  }

  /** Sotuvchilar uchun bo‘sh qoldiq (band qilinmagan) HQ omborda, variant bo‘yicha (SOT-2: qoldig‘i 0 offerga oqim yo‘q). */
  async available(variantIds: string[]): Promise<Record<string, number>> {
    const ids = [...new Set(variantIds.map(String))].filter((id) =>
      /^\d+$/.test(id),
    );
    const result: Record<string, number> = Object.fromEntries(
      ids.map((id) => [id, 0]),
    );
    if (!ids.length) return result;
    const warehouseId = await this.hqWarehouseId();
    // band qilish (`lockStock`) ham `is_deleted` ga qaramaydi — hisob bir xil bo‘lsin
    const rows = await this.dataSource.getRepository(Stock).find({
      where: { variantId: In(ids), warehouseId },
    });
    // BE-17 (OMB-3): sotuvdan chiqqan partiyalar offer qoldig‘iga kirmaydi
    const blocked = await blockedByVariant(
      this.dataSource.manager,
      ids,
      warehouseId,
    );
    for (const row of rows)
      result[String(row.variantId)] = Math.max(
        0,
        row.quantityOnHand -
          row.quantityReserved -
          (blocked.get(String(row.variantId)) ?? 0),
      );
    return result;
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
              StockMovementType.RETURN, // BE-16: qaytish alohida tur
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
          operation: StockMovementType.RETURN,
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
        // BE-17: hisobdan chiqarish partiyadan (ko‘rsatilgan yoki sotuvdan chiqqanlari), keyin invariant
        if (input.quantityDelta < 0) {
          try {
            await writeOffLots(
              manager,
              stock,
              -input.quantityDelta,
              input.lotId,
            );
          } catch (error) {
            if (
              error instanceof LotNotFoundError ||
              error instanceof LotTooSmallError
            )
              throw BusinessException.invalidState(error.message);
            throw error;
          }
          await trimLots(manager, stock);
        }
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
      if (type === StockMovementType.COMMIT) {
        // BE-17 (OMB-3): chiqim partiyalardan, muddati yaqinidan (FEFO)
        await consumeLots(
          manager,
          item.variantId,
          item.warehouseId,
          item.quantity,
        );
        await trimLots(manager, stock);
      }
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
