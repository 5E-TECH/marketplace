import {
  ErrorCode,
  OutboxEvent,
  OutboxStatus,
  ReservationStatus,
  StockMovementType,
} from '@app/common';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';
import { InventoryService } from './inventory.service';

class InventoryDbFake {
  stocks: Stock[] = [];
  reservations: Reservation[] = [];
  items: ReservationItem[] = [];
  movements: StockMovement[] = [];
  operations: InventoryOperation[] = [];
  outboxEvents: OutboxEvent[] = [];
  locks: string[] = [];
  queries: Array<{ sql: string; params: unknown[] }> = [];
  private sequence = 1;

  readonly manager = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      this.queries.push({ sql, params });
    }),
    getRepository: jest.fn((entity: unknown) => this.repository(entity)),
  };

  readonly dataSource = {
    transaction: jest.fn(
      async (work: (manager: unknown) => Promise<unknown>) => {
        const snapshot = this.snapshot();
        try {
          return await work(this.manager);
        } catch (error) {
          this.restore(snapshot);
          throw error;
        }
      },
    ),
  };

  addStock(onHand: number, reserved = 0): Stock {
    const stock = {
      id: String(this.sequence++),
      variantId: '101',
      warehouseId: '201',
      quantityOnHand: onHand,
      quantityReserved: reserved,
      lowStockThreshold: 0,
    } as Stock;
    this.stocks.push(stock);
    return stock;
  }

  private repository(entity: unknown) {
    const rows = this.rows(entity);
    return {
      create: jest.fn((value: unknown) => ({ ...(value as object) })),
      save: jest.fn(async (value: any) => {
        if (!value.id && entity !== InventoryOperation) {
          value.id = String(this.sequence++);
        }
        const key = entity === InventoryOperation ? 'key' : 'id';
        const index = rows.findIndex((row: any) => row[key] === value[key]);
        if (index === -1) rows.push(value);
        else rows[index] = value;
        return value;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        return (
          rows.find((row: any) =>
            Object.entries(where).every(([key, value]) => row[key] === value),
          ) ?? null
        );
      }),
      find: jest.fn(async ({ where }: any) => {
        return rows.filter((row: any) =>
          Object.entries(where).every(([key, value]) => row[key] === value),
        );
      }),
      exist: jest.fn(async ({ where }: any) => {
        return rows.some((row: any) => {
          if (row.variantId !== where.variantId) return false;
          const threshold = where.quantityOnHand?._value ?? 0;
          return row.quantityOnHand > threshold;
        });
      }),
      createQueryBuilder: jest.fn(() => {
        const params: Record<string, string> = {};
        return {
          setLock: jest.fn((lock: string) => {
            this.locks.push(`${this.entityName(entity)}:${lock}`);
            return this.queryBuilder(entity, rows, params);
          }),
          where: jest.fn(),
        };
      }),
    };
  }

  private queryBuilder(
    entity: unknown,
    rows: any[],
    params: Record<string, any>,
  ): any {
    const builder = {
      setLock: jest.fn(() => builder),
      where: jest.fn((_sql: string, values: Record<string, any>) => {
        Object.assign(params, values);
        return builder;
      }),
      andWhere: jest.fn((_sql: string, values: Record<string, any>) => {
        Object.assign(params, values);
        return builder;
      }),
      getOne: jest.fn(async () => {
        if (entity === Stock) {
          return (
            rows.find(
              (row) =>
                row.variantId === params.variantId &&
                row.warehouseId === params.warehouseId,
            ) ?? null
          );
        }
        if (params.reservationId) {
          return (
            rows.find(
              (row) =>
                row.id === params.reservationId &&
                row.status === params.status &&
                row.expiresAt < params.now,
            ) ?? null
          );
        }
        return rows.find((row) => row.orderRef === params.orderRef) ?? null;
      }),
    };
    return builder;
  }

  private rows(entity: unknown): any[] {
    if (entity === Stock) return this.stocks;
    if (entity === Reservation) return this.reservations;
    if (entity === ReservationItem) return this.items;
    if (entity === StockMovement) return this.movements;
    if (entity === InventoryOperation) return this.operations;
    if (entity === OutboxEvent) return this.outboxEvents;
    throw new Error(`Unexpected entity: ${this.entityName(entity)}`);
  }

  private entityName(entity: unknown): string {
    return (entity as { name?: string })?.name ?? String(entity);
  }

  private snapshot() {
    return structuredClone({
      stocks: this.stocks,
      reservations: this.reservations,
      items: this.items,
      movements: this.movements,
      operations: this.operations,
      outboxEvents: this.outboxEvents,
    });
  }

  private restore(snapshot: ReturnType<InventoryDbFake['snapshot']>): void {
    this.stocks = snapshot.stocks;
    this.reservations = snapshot.reservations;
    this.items = snapshot.items;
    this.movements = snapshot.movements;
    this.operations = snapshot.operations;
    this.outboxEvents = snapshot.outboxEvents;
  }
}

describe('InventoryService', () => {
  let db: InventoryDbFake;
  let service: InventoryService;

  beforeEach(() => {
    db = new InventoryDbFake();
    service = new InventoryService(db.dataSource as never);
  });

  const reserve = (key = 'reserve-1', quantity = 5) =>
    service.reserve({
      orderRef: '301',
      items: [{ variantId: '101', warehouseId: '201', quantity }],
      idempotencyKey: key,
    });

  it('TC1: reserve qoldiqni FOR UPDATE bilan band qiladi va movement yozadi', async () => {
    db.addStock(10);

    await reserve();

    expect(db.stocks[0]).toMatchObject({
      quantityOnHand: 10,
      quantityReserved: 5,
    });
    expect(db.locks).toContain('Stock:pessimistic_write');
    expect(db.movements[0]).toMatchObject({
      type: StockMovementType.RESERVE,
      quantity: 5,
      onHandAfter: 10,
      reservedAfter: 5,
    });
  });

  it('TC2: yetarli qoldiq bo‘lmasa transaction rollback bo‘ladi', async () => {
    db.addStock(10);

    await expect(reserve('reserve-too-much', 20)).rejects.toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_STOCK,
    });

    expect(db.stocks[0].quantityReserved).toBe(0);
    expect(db.reservations).toHaveLength(0);
    expect(db.movements).toHaveLength(0);
  });

  it('TC3: commit on_hand va reservedni kamaytiradi', async () => {
    db.addStock(10);
    await reserve();

    await service.commit({
      orderRef: '301',
      idempotencyKey: 'commit-1',
    });

    expect(db.stocks[0]).toMatchObject({
      quantityOnHand: 5,
      quantityReserved: 0,
    });
    expect(db.reservations[0].status).toBe(ReservationStatus.COMMITTED);
    expect(db.movements.at(-1)?.type).toBe(StockMovementType.COMMIT);
    expect(db.outboxEvents).toHaveLength(0);
  });

  it('C0.9 TC3: commit on_hand=0 qilsa stock_depleted event yozadi', async () => {
    db.addStock(5);
    await reserve('reserve-all', 5);

    await service.commit({
      orderRef: '301',
      idempotencyKey: 'commit-all',
    });

    expect(db.outboxEvents[0]).toMatchObject({
      aggregateType: 'product_variant',
      aggregateId: '101',
      eventType: 'inventory.stock_depleted',
      status: OutboxStatus.PENDING,
      payload: {
        variantId: '101',
        warehouseId: '201',
        status: 'OUT_OF_STOCK',
      },
    });
  });

  it('TC4: release on_handni saqlab, reservedni qaytaradi', async () => {
    db.addStock(10);
    await reserve();

    await service.release({
      orderRef: '301',
      idempotencyKey: 'release-1',
      reason: 'Buyurtma bekor qilindi',
    });

    expect(db.stocks[0]).toMatchObject({
      quantityOnHand: 10,
      quantityReserved: 0,
    });
    expect(db.reservations[0].status).toBe(ReservationStatus.RELEASED);
    expect(db.movements.at(-1)?.type).toBe(StockMovementType.RELEASE);
  });

  it('TC5: inbound qoldiqni oshiradi', async () => {
    db.addStock(5);

    const result = await service.inbound({
      variantId: '101',
      warehouseId: '201',
      quantity: 10,
      reason: 'Yetkazib beruvchi kirimi',
      idempotencyKey: 'inbound-1',
    });

    expect(result).toMatchObject({ onHand: 15, reserved: 0 });
    expect(db.movements[0].type).toBe(StockMovementType.INBOUND);
  });

  it('TC6: invariant buzadigan adjustni rad etadi', async () => {
    db.addStock(10, 5);

    await expect(
      service.adjust({
        variantId: '101',
        warehouseId: '201',
        quantityDelta: -6,
        reason: 'Inventarizatsiya',
        actorId: '401',
        idempotencyKey: 'adjust-invalid',
      }),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_STOCK,
    });

    expect(db.stocks[0]).toMatchObject({
      quantityOnHand: 10,
      quantityReserved: 5,
    });
  });

  it('TC7: bir idempotency key amalni faqat bir marta bajaradi', async () => {
    db.addStock(5);
    const input = {
      variantId: '101',
      warehouseId: '201',
      quantity: 10,
      reason: 'Kirim',
      idempotencyKey: 'same-key',
    };

    const first = await service.inbound(input);
    const second = await service.inbound(input);

    expect(second).toEqual(first);
    expect(db.stocks[0].quantityOnHand).toBe(15);
    expect(db.movements).toHaveLength(1);
  });

  it('TC8: adjust signed miqdor va actor bilan movement yozadi', async () => {
    db.addStock(10);

    await service.adjust({
      variantId: '101',
      warehouseId: '201',
      quantityDelta: -3,
      reason: 'Sanoq natijasi',
      actorId: '401',
      idempotencyKey: 'adjust-1',
    });

    expect(db.stocks[0].quantityOnHand).toBe(7);
    expect(db.movements[0]).toMatchObject({
      type: StockMovementType.ADJUST,
      quantity: -3,
      actorId: '401',
      reason: 'Sanoq natijasi',
    });
  });

  it('C0.9 TC1: muddati o‘tgan rezervatsiyani bo‘shatadi', async () => {
    db.addStock(10);
    await reserve();
    db.reservations[0].expiresAt = new Date('2026-07-24T09:00:00.000Z');

    const released = await service.releaseExpired(
      db.reservations[0].id,
      new Date('2026-07-24T10:00:00.000Z'),
    );

    expect(released).toBe(true);
    expect(db.stocks[0].quantityReserved).toBe(0);
    expect(db.reservations[0].status).toBe(ReservationStatus.RELEASED);
    expect(db.movements.at(-1)).toMatchObject({
      type: StockMovementType.RELEASE,
      reason: 'TTL_EXPIRED',
    });
  });

  it('C0.9 TC2: muddati o‘tmagan rezervatsiyaga tegmaydi', async () => {
    db.addStock(10);
    await reserve();
    db.reservations[0].expiresAt = new Date('2026-07-24T11:00:00.000Z');

    const released = await service.releaseExpired(
      db.reservations[0].id,
      new Date('2026-07-24T10:00:00.000Z'),
    );

    expect(released).toBe(false);
    expect(db.stocks[0].quantityReserved).toBe(5);
    expect(db.reservations[0].status).toBe(ReservationStatus.HELD);
  });
});
