import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { defer, from } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CatalogOrderSnapshot,
  CheckoutDeliveryDestination,
  DeliveryKind,
  elchiTariffFor,
  ErrorCode,
  LEAD_ORDER_RPC,
  LeadConfirmedEvent,
  LeadOrderActorType,
  LeadOrderStatus,
  LeadSource,
  OrderStatusChangedEvent,
  OutboxEvent,
  OutboxService,
  TZ_DEFAULT_ELCHI_TARIFF,
} from '@app/common';
import { CHECKOUT_DB } from './database';
import { LeadOrderService } from './lead-order.service';
import { LeadOrderStatusService } from './lead-order-status.service';
import { CheckoutOutboxRelayService } from './checkout-outbox-relay.service';
import { SellerOrdersService } from './seller-orders.service';
import { INVENTORY_DB } from '../../inventory-service/src/database';
import { InventoryService } from '../../inventory-service/src/inventory.service';
import { ReservationSweeperService } from '../../inventory-service/src/reservation-sweeper.service';
import { splitDelivered } from '../../finance-service/src/ledger/split';
import { ParcelService } from '../../elchi-integration/src/parcel.service';
import { Reservation } from '../../inventory-service/src/entities/reservation.entity';
import { Stock } from '../../inventory-service/src/entities/stock.entity';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** inventory spec’lari bilan bir xil (inventory sxemasini DROP/CREATE qiladi). */
const INVENTORY_SCHEMA_TEST_LOCK = 2_304_005;
/** checkout sxemasini DROP/CREATE qiladigan spec’lar ketma-ket. */
const CHECKOUT_SCHEMA_TEST_LOCK = 2_304_006;

const PRODUCT = '42';
const VARIANT = '901';
const ACTOR = {
  type: LeadOrderActorType.USER,
  id: '41',
  role: 'OPERATOR_LEAD',
};

/**
 * BE-18 haqiqiy PostgreSQL da: checkout (hamma migratsiya) va HAQIQIY inventory servisi (HQ ombor, BE-16).
 * Katalog — namuna (narx nusxasi TZ 2.5 misoli: tasdiqlangan 251 000, sahifa narxi 276 000).
 */
describeWithPostgres('BE-18 liddan buyurtma (PostgreSQL)', () => {
  let lock: Client | undefined;
  let checkoutDs: DataSource;
  let inventoryDs: DataSource;
  let inventory: InventoryService;
  let orders: LeadOrderService;
  let status: LeadOrderStatusService;
  let admin: SellerOrdersService;
  let catalogDown = false;
  /** Ombor umuman javob bermaydi. */
  let inventoryDown = false;
  /** Band qilinadi, lekin javob yo‘qoladi (504). */
  let loseReserveReply = false;
  let relay: CheckoutOutboxRelayService;
  let offer: CatalogOrderSnapshot;
  const catalogCalls: unknown[] = [];
  const inventoryCalls: Array<{ cmd: string; data: Record<string, unknown> }> =
    [];

  /** RMQ orqali kelgandek: servis xatosi `{statusCode, message, errorCode}` bo‘lib qaytadi (RpcHttpExceptionFilter). */
  const rpc = (work: () => Promise<unknown>) =>
    defer(() =>
      from(
        work().catch((error: unknown) => {
          if (error instanceof HttpException) {
            const response = error.getResponse() as {
              message?: string;
              errorCode?: string;
            };
            throw {
              statusCode: error.getStatus(),
              message: response?.message ?? error.message,
              errorCode: response?.errorCode,
            };
          }
          throw error;
        }),
      ),
    );

  const baseOffer = (weightGrams = 1_000): CatalogOrderSnapshot => ({
    productId: PRODUCT,
    productName: 'Simsiz quloqchin',
    variantId: VARIANT,
    sku: 'Q-1',
    wholesalerId: '15',
    weightGrams,
    cpaAvailable: true,
    withdrawn: false,
    basePrice: 140_000,
    recommendedPrice: 251_000,
    approvedPrice: 251_000,
    affiliateFee: 65_000,
    callCenterFee: 10_000,
    hiddenDelivery: 11_000,
    platformService: 25_000,
    delivery: { mode: 'PARTIAL', shown: 30_000, elchiTariff: 40_000 },
  });

  const confirmed = (
    over: Partial<LeadConfirmedEvent> = {},
  ): LeadConfirmedEvent => ({
    eventId: randomUUID(),
    leadId: '5001',
    source: LeadSource.LANDING,
    streamId: '301',
    affiliateId: '77',
    productId: PRODUCT,
    quantity: 1,
    salePrice: 276_000,
    customerName: 'Dilnoza',
    customerPhone: '+998901234567',
    regionSoato: '1726',
    districtSoato: '1726262',
    addressLine: 'Chilonzor 5-mavze, 12-uy',
    whereDeliver: CheckoutDeliveryDestination.CENTER,
    confirmedBy: '41',
    addressConfirmedBy: '41',
    confirmedAt: new Date().toISOString(),
    ...over,
  });

  const orderOfLead = async (leadId: string) =>
    (
      (await checkoutDs.query(
        `SELECT id::text, status, delivery_address AS "deliveryAddress",
                customer_phone AS "customerPhone", customer_id AS "customerId",
                source, lead_id::text AS "leadId", stream_id::text AS "streamId",
                affiliate_id::text AS "affiliateId", wholesaler_id::text AS "wholesalerId",
                delivery_shown::int AS "deliveryShown", delivery_cost::int AS "deliveryCost",
                weight_grams AS "weightGrams", cod_amount::int AS "codAmount",
                total_amount::int AS "totalAmount"
           FROM checkout.sales_order WHERE lead_id = $1`,
        [leadId],
      )) as Array<Record<string, unknown>>
    )[0];

  const outboxOf = async (eventType: string, aggregateId: string) =>
    (await checkoutDs.getRepository(OutboxEvent).find({
      where: { eventType, aggregateId },
      order: { id: 'ASC' },
    })) as OutboxEvent[];

  const reservationOf = (orderRef: string) =>
    inventoryDs.getRepository(Reservation).findOneByOrFail({ orderRef });

  const stockRow = async () => {
    const hq = await inventory.hqWarehouseId();
    return inventoryDs
      .getRepository(Stock)
      .findOneByOrFail({ variantId: VARIANT, warehouseId: hq });
  };

  const inbound = async (quantity: number, key: string) =>
    inventory.inbound({
      variantId: VARIANT,
      warehouseId: await inventory.hqWarehouseId(),
      quantity,
      reason: 'Qabul (test)',
      actorId: '1',
      idempotencyKey: key,
    });

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [
      INVENTORY_SCHEMA_TEST_LOCK,
    ]);
    await lock.query('SELECT pg_advisory_lock($1)', [
      CHECKOUT_SCHEMA_TEST_LOCK,
    ]);
    for (const schema of ['checkout', 'inventory']) {
      await lock.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await lock.query(`CREATE SCHEMA ${schema}`);
    }
    checkoutDs = await new DataSource({
      type: 'postgres',
      url,
      schema: 'checkout',
      entities: CHECKOUT_DB.entities as never,
      migrations: CHECKOUT_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    inventoryDs = await new DataSource({
      type: 'postgres',
      url,
      schema: 'inventory',
      entities: INVENTORY_DB.entities as never,
      migrations: INVENTORY_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    inventory = new InventoryService(inventoryDs);

    const catalog = {
      send: (pattern: { cmd: string }, data: Record<string, unknown>) =>
        rpc(async () => {
          catalogCalls.push({ pattern, data });
          if (pattern.cmd !== LEAD_ORDER_RPC.CATALOG_SNAPSHOT)
            throw new Error(`kutilmagan katalog so‘rovi: ${pattern.cmd}`);
          if (catalogDown)
            throw new HttpException('katalog javob bermadi', 503);
          const quantity = Number(data.quantity);
          const kind =
            data.whereDeliver === 'ADDRESS'
              ? DeliveryKind.ADDRESS
              : DeliveryKind.CENTER;
          const tariff = elchiTariffFor(
            TZ_DEFAULT_ELCHI_TARIFF,
            offer.weightGrams * quantity,
            kind,
          );
          const unitTariff = elchiTariffFor(
            TZ_DEFAULT_ELCHI_TARIFF,
            offer.weightGrams,
            kind,
          );
          return {
            ...offer,
            delivery: {
              ...offer.delivery,
              elchiTariff: tariff,
              shown: Math.min(tariff, 30_000 + (tariff - unitTariff)),
            },
          };
        }),
    };
    const inventoryClient = {
      send: (pattern: { cmd: string }, data: Record<string, unknown>) =>
        rpc(async () => {
          inventoryCalls.push({ cmd: pattern.cmd, data });
          if (inventoryDown)
            throw new HttpException('ombor javob bermadi', 504);
          if (pattern.cmd === 'inventory.reserve') {
            const reserved = await inventory.reserveAvailable(data as never);
            if (loseReserveReply)
              throw new HttpException('javob yo‘qoldi', 504);
            return reserved;
          }
          if (pattern.cmd === 'inventory.release')
            return inventory.release(data as never);
          if (pattern.cmd === 'inventory.commit')
            return inventory.commit(data as never);
          throw new Error(`kutilmagan ombor so‘rovi: ${pattern.cmd}`);
        }),
    };
    const outbox = new OutboxService(checkoutDs.getRepository(OutboxEvent));
    status = new LeadOrderStatusService(
      checkoutDs,
      outbox,
      inventoryClient as never,
    );
    orders = new LeadOrderService(
      checkoutDs,
      outbox,
      status,
      catalog as never,
      inventoryClient as never,
    );
    admin = new SellerOrdersService(checkoutDs);
    const quiet = { emit: () => from([undefined]) };
    relay = new CheckoutOutboxRelayService(
      outbox,
      quiet as never,
      quiet as never,
      quiet as never,
      inventoryClient as never,
    );
    await inbound(10, 'in-1');
  });

  beforeEach(() => {
    offer = baseOffer();
    catalogDown = false;
    inventoryDown = false;
    loseReserveReply = false;
  });

  const makeDue = (leadId: string) =>
    checkoutDs.query(
      `UPDATE checkout.lead_order_request SET next_attempt_at = now() - interval '1 second' WHERE lead_id = $1`,
      [leadId],
    );

  afterAll(async () => {
    for (const [ds, schema] of [
      [checkoutDs, 'checkout'],
      [inventoryDs, 'inventory'],
    ] as const)
      if (ds?.isInitialized) {
        await ds.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await ds.destroy();
      }
    await lock?.end();
  });

  it('TC1/TC0/TC11: lid tasdiqlandi → 1 s ichida buyurtma: narx nusxasi, tasdiqlangan manzil, sahifa va sotuvchi', async () => {
    const started = Date.now();
    const event = confirmed();
    await expect(orders.onLeadConfirmed(event)).resolves.toMatchObject({
      accepted: true,
    });
    expect(Date.now() - started).toBeLessThan(1_000);

    const order = await orderOfLead('5001');
    expect(order).toMatchObject({
      status: LeadOrderStatus.CONFIRMED,
      source: LeadSource.LANDING,
      leadId: '5001',
      streamId: '301',
      affiliateId: '77',
      wholesalerId: '15',
      customerId: null,
      // manzilda telefon yo‘q — alohida ustunda
      deliveryAddress: 'Chilonzor 5-mavze, 12-uy',
      customerPhone: '+998901234567',
      deliveryShown: 30_000,
      deliveryCost: 40_000,
      weightGrams: 1_000,
      codAmount: 306_000,
      totalAmount: 306_000,
    });
    expect(String(order.deliveryAddress)).not.toContain('+998');

    const [item] = (await checkoutDs.query(
      `SELECT i.unit_price::int AS "salePrice", i.approved_price::int AS "approvedPrice",
              i.base_price::int AS "basePrice", i.markup::int AS markup,
              i.variant_id::text AS "variantId", i.sku
         FROM checkout.sales_order_item i
         JOIN checkout.sales_order_seller s ON s.id = i.sales_order_seller_id
        WHERE s.sales_order_id = $1`,
      [order.id],
    )) as Array<Record<string, unknown>>;
    // TC11: tasdiqlangan narx, bazaviy narx va ustama 25 000 alohida (TZ 2.5 misoli)
    expect(item).toEqual({
      salePrice: 276_000,
      approvedPrice: 251_000,
      basePrice: 140_000,
      markup: 25_000,
      variantId: VARIANT,
      sku: 'Q-1',
    });

    const [created] = await outboxOf('order.status.changed', String(order.id));
    const payload = created.payload as unknown as OrderStatusChangedEvent;
    expect(payload).toMatchObject({
      orderId: order.id,
      orderNumber: `L-${String(order.id)}`,
      leadId: '5001',
      source: 'LANDING',
      streamId: '301',
      affiliateId: '77',
      wholesalerId: '15',
      status: 'CONFIRMED',
      previousStatus: null,
      recipient: {
        name: 'Dilnoza',
        phone: '+998901234567',
        regionSoato: '1726',
        districtSoato: '1726262',
        addressLine: 'Chilonzor 5-mavze, 12-uy',
        whereDeliver: 'CENTER',
      },
      items: [
        {
          productId: PRODUCT,
          wholesalerId: '15',
          sku: 'Q-1',
          quantity: 1,
          weightGrams: 1_000,
          approvedPrice: 251_000,
          basePrice: 140_000,
          salePrice: 276_000,
          split: {
            affiliateFee: 65_000,
            callCenterFee: 10_000,
            hiddenDelivery: 11_000,
            platformService: 25_000,
          },
        },
      ],
      delivery: { mode: 'PARTIAL', cost: 30_000, elchiTariff: 40_000 },
      codAmount: 306_000,
      parcel: null,
    });
    // shartnoma: Elchi integratsiyasi (BE-20) shu hodisadan posilka yaratadi — tekshiruvidan o‘tadi
    const parcels = Object.create(ParcelService.prototype) as {
      invalidReason(event: OrderStatusChangedEvent): string | null;
    };
    expect(parcels.invalidReason(payload)).toBeNull();

    // band — HQ dan, muddatsiz (TC8 asosi)
    const reserve = inventoryCalls.find((c) => c.cmd === 'inventory.reserve');
    expect(reserve?.data).not.toHaveProperty('ttlMs');
    await expect(reservationOf(String(order.id))).resolves.toMatchObject({
      status: 'HELD',
      expiresAt: null,
    });
  });

  it('TC0: narx keyin o‘zgarsa ham buyurtma narxi va sahifa/sotuvchi o‘zgarmaydi', async () => {
    offer = { ...baseOffer(), approvedPrice: 260_000, basePrice: 150_000 };
    const order = await orderOfLead('5001');
    const result = await status.transition({
      orderId: String(order.id),
      to: LeadOrderStatus.PICKING,
      actor: ACTOR,
    });
    expect(result).toMatchObject({ status: 'PICKING', idempotent: false });
    const events = await outboxOf('order.status.changed', String(order.id));
    const picking = events[events.length - 1]
      .payload as unknown as OrderStatusChangedEvent;
    expect(picking).toMatchObject({
      previousStatus: 'CONFIRMED',
      status: 'PICKING',
      streamId: '301',
      affiliateId: '77',
    });
    expect(picking.items[0]).toMatchObject({
      approvedPrice: 251_000,
      basePrice: 140_000,
      salePrice: 276_000,
    });
  });

  it('TC6: takroriy hodisa (va shu lidga yangi hodisa) → ikkinchi buyurtma yo‘q', async () => {
    const event = confirmed({ leadId: '5002' });
    await orders.onLeadConfirmed(event);
    await expect(orders.onLeadConfirmed(event)).resolves.toEqual({
      accepted: false,
    });
    await expect(
      orders.onLeadConfirmed(confirmed({ leadId: '5002' })),
    ).resolves.toEqual({ accepted: false });
    const [{ count }] = (await checkoutDs.query(
      `SELECT COUNT(*)::int AS count FROM checkout.sales_order WHERE lead_id = 5002`,
    )) as Array<{ count: number }>;
    expect(count).toBe(1);
    const reservations = await inventoryDs
      .getRepository(Reservation)
      .countBy({ orderRef: String((await orderOfLead('5002')).id) });
    expect(reservations).toBe(1);
  });

  it('TC8: tasdiqdan 31 daqiqa keyin band saqlangan — sweeper bo‘shatmadi', async () => {
    const order = await orderOfLead('5002');
    const sweeper = new ReservationSweeperService(
      inventoryDs.getRepository(Reservation),
      inventory,
    );
    await sweeper.sweepExpired(new Date(Date.now() + 31 * 60_000));
    await expect(reservationOf(String(order.id))).resolves.toMatchObject({
      status: 'HELD',
    });
  });

  it('TC3: «Tasdiqlandi» da sabab bilan bekor → «Bekor qilindi», band darhol bo‘shadi, hodisa Elchi integratsiyasiga', async () => {
    const order = await orderOfLead('5002');
    const before = await stockRow();
    await expect(
      status.cancel({ orderId: String(order.id), reason: '', actor: ACTOR }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      status.cancel({
        orderId: String(order.id),
        reason: 'Mijoz fikridan qaytdi',
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED', idempotent: false });
    await expect(reservationOf(String(order.id))).resolves.toMatchObject({
      status: 'RELEASED',
    });
    await expect(stockRow()).resolves.toMatchObject({
      quantityReserved: before.quantityReserved - 1,
      quantityOnHand: before.quantityOnHand,
    });
    const events = await outboxOf('order.status.changed', String(order.id));
    expect(
      (events[events.length - 1].payload as unknown as OrderStatusChangedEvent)
        .status,
    ).toBe('CANCELLED');
    // takroriy bekor — idempotent
    await expect(
      status.cancel({
        orderId: String(order.id),
        reason: 'Takror',
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({ idempotent: true });
  });

  it('TC2/TC4: Elchi’ga topshirishda band chiqimga aylanadi; topshirilgandan keyin bekor va «Yetkazildi → Yo‘lda» — rad va jurnalda', async () => {
    const order = await orderOfLead('5001'); // PICKING da
    const id = String(order.id);
    const before = await stockRow();
    await status.transition({
      orderId: id,
      to: LeadOrderStatus.PACKED,
      actor: ACTOR,
    });
    await status.transition({
      orderId: id,
      to: LeadOrderStatus.HANDED_TO_ELCHI,
      actor: ACTOR,
    });
    await expect(reservationOf(id)).resolves.toMatchObject({
      status: 'COMMITTED',
    });
    await expect(stockRow()).resolves.toMatchObject({
      quantityOnHand: before.quantityOnHand - 1,
      quantityReserved: before.quantityReserved - 1,
    });

    // TC4: topshirilgan buyurtmani bekor qilib bo‘lmaydi
    await expect(
      status.cancel({ orderId: id, reason: 'Kech qoldi', actor: ACTOR }),
    ).rejects.toMatchObject({ status: 409 });

    const elchi = { type: LeadOrderActorType.ELCHI, id: null };
    await status.transition({
      orderId: id,
      to: LeadOrderStatus.IN_TRANSIT,
      actor: elchi,
    });
    await status.transition({
      orderId: id,
      to: LeadOrderStatus.DELIVERED,
      actor: elchi,
    });
    // TC2: orqaga — rad
    await expect(
      status.transition({
        orderId: id,
        to: LeadOrderStatus.IN_TRANSIT,
        actor: elchi,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: ErrorCode.INVALID_STATE },
    });
    const journal = (await checkoutDs.query(
      `SELECT from_status AS "from", to_status AS "to", accepted, actor_type AS "actorType"
         FROM checkout.order_status_history WHERE order_id = $1 ORDER BY id`,
      [id],
    )) as Array<Record<string, unknown>>;
    expect(journal).toEqual([
      { from: null, to: 'CONFIRMED', accepted: true, actorType: 'SYSTEM' },
      { from: 'CONFIRMED', to: 'PICKING', accepted: true, actorType: 'USER' },
      { from: 'PICKING', to: 'PACKED', accepted: true, actorType: 'USER' },
      {
        from: 'PACKED',
        to: 'HANDED_TO_ELCHI',
        accepted: true,
        actorType: 'USER',
      },
      {
        from: 'HANDED_TO_ELCHI',
        to: 'CANCELLED',
        accepted: false,
        actorType: 'USER',
      },
      {
        from: 'HANDED_TO_ELCHI',
        to: 'IN_TRANSIT',
        accepted: true,
        actorType: 'ELCHI',
      },
      {
        from: 'IN_TRANSIT',
        to: 'DELIVERED',
        accepted: true,
        actorType: 'ELCHI',
      },
      {
        from: 'DELIVERED',
        to: 'IN_TRANSIT',
        accepted: false,
        actorType: 'ELCHI',
      },
    ]);
    await expect(orderOfLead('5001')).resolves.toMatchObject({
      status: 'DELIVERED',
    });
    // shartnoma: moliya (BE-22) «Yetkazildi» hodisasidan taqsimot yozadi (ikki tomonlama, jami 0)
    const events = await outboxOf('order.status.changed', id);
    const delivered = events[events.length - 1]
      .payload as unknown as OrderStatusChangedEvent;
    expect(delivered.status).toBe('DELIVERED');
    const lines = splitDelivered(delivered);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(0);
    const amount = (kind: string) =>
      lines.find((line) => line.lineKind === kind)?.amount;
    expect(amount('COD_RECEIVABLE')).toBe(-276_000);
    // TZ 2.5 misoli: ustama 25 000 dan sotuvchiga 85% — 21 250
    expect(amount('AFFILIATE_MARKUP')).toBe(21_250);
    expect(amount('WHOLESALER_BASE')).toBe(140_000);
  });

  it('TC9: oxirgi dona boshqa buyurtmaga band → buyurtma yo‘q, order.create-failed ketdi, «tasdiqlandi» hodisasi yo‘q', async () => {
    const free = await stockRow();
    const available = free.quantityOnHand - free.quantityReserved;
    // qoldiqni bitta donagacha band qilamiz va oxirgisini boshqa lid oladi
    await orders.onLeadConfirmed(
      confirmed({ leadId: '5003', quantity: available - 1 }),
    );
    await orders.onLeadConfirmed(confirmed({ leadId: '5004' }));
    expect(await orderOfLead('5004')).toBeDefined();

    await expect(
      orders.onLeadConfirmed(confirmed({ leadId: '5005' })),
    ).resolves.toMatchObject({ accepted: true });
    expect(await orderOfLead('5005')).toBeUndefined();
    const [request] = (await checkoutDs.query(
      `SELECT status, failure_reason AS reason FROM checkout.lead_order_request WHERE lead_id = 5005`,
    )) as Array<Record<string, unknown>>;
    expect(request).toEqual({ status: 'FAILED', reason: 'OUT_OF_STOCK' });
    const [failed] = await outboxOf('order.create-failed', '5005');
    expect(failed.payload).toMatchObject({
      leadId: '5005',
      reason: 'OUT_OF_STOCK',
    });

    // qoldiq kelgach lid qayta tasdiqlansa — yangi so‘rov, buyurtma yaratiladi
    await inbound(5, 'in-2');
    await orders.onLeadConfirmed(confirmed({ leadId: '5005' }));
    await expect(orderOfLead('5005')).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
  });

  it('TC5: 4,2 kg → Elchi tarifi 48 000 (3 kg dan og‘ir — qayta hisoblanadi)', async () => {
    offer = baseOffer(4_200);
    await orders.onLeadConfirmed(confirmed({ leadId: '5006' }));
    await expect(orderOfLead('5006')).resolves.toMatchObject({
      weightGrams: 4_200,
      deliveryCost: 48_000,
      // bir donaning o‘zi 4,2 kg: tarif farqi tovar narxida yashirilgan (BE-09), mijoz 30 000 ko‘radi
      deliveryShown: 30_000,
      codAmount: 306_000,
    });
  });

  it('BUY-4: jami og‘irlik 3 kg dan oshsa (2 × 2 kg) — mijozga ko‘rinadigan yetkazish ham oshadi', async () => {
    offer = baseOffer(2_000);
    await orders.onLeadConfirmed(confirmed({ leadId: '5010', quantity: 2 }));
    await expect(orderOfLead('5010')).resolves.toMatchObject({
      weightGrams: 4_000,
      deliveryCost: 44_000,
      // 30 000 + (44 000 − 40 000)
      deliveryShown: 34_000,
      codAmount: 2 * 276_000 + 34_000,
    });
  });

  it('katalog javob bermasa — so‘rov qoladi va keyin buyurtma yaratiladi (lid yo‘qolmaydi)', async () => {
    catalogDown = true;
    await orders.onLeadConfirmed(confirmed({ leadId: '5007' }));
    expect(await orderOfLead('5007')).toBeUndefined();
    const [pending] = (await checkoutDs.query(
      `SELECT status, attempts FROM checkout.lead_order_request WHERE lead_id = 5007`,
    )) as Array<Record<string, unknown>>;
    expect(pending).toEqual({ status: 'PENDING', attempts: 1 });

    catalogDown = false;
    await checkoutDs.query(
      `UPDATE checkout.lead_order_request SET next_attempt_at = now() - interval '1 second' WHERE lead_id = 5007`,
    );
    await expect(orders.processDue()).resolves.toBe(1);
    await expect(orderOfLead('5007')).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
  });

  it('offer sotuvdan olingan yoki hodisa xato — buyurtma yo‘q, lid sababi bilan navbatga qaytadi', async () => {
    offer = { ...baseOffer(), withdrawn: true };
    await orders.onLeadConfirmed(confirmed({ leadId: '5008' }));
    const [withdrawn] = await outboxOf('order.create-failed', '5008');
    expect(withdrawn.payload).toMatchObject({ reason: 'OFFER_UNAVAILABLE' });

    await orders.onLeadConfirmed(
      confirmed({ leadId: '5009', customerPhone: '90 123 45 67' }),
    );
    const [invalid] = await outboxOf('order.create-failed', '5009');
    expect(invalid.payload).toMatchObject({ reason: 'INVALID_ORDER' });
    expect(await orderOfLead('5008')).toBeUndefined();
    expect(await orderOfLead('5009')).toBeUndefined();
  });

  it('band qilindi, javob yo‘qoldi, keyin offer sotuvdan olindi → so‘rov rad etiladi va band bo‘shaydi (abadiy qolmaydi)', async () => {
    await inbound(5, 'in-3');
    loseReserveReply = true;
    await orders.onLeadConfirmed(confirmed({ leadId: '5011' }));
    const [request] = (await checkoutDs.query(
      `SELECT status, order_id::text AS "orderId" FROM checkout.lead_order_request WHERE lead_id = 5011`,
    )) as Array<{ status: string; orderId: string }>;
    expect(request.status).toBe('PENDING');
    await expect(reservationOf(request.orderId)).resolves.toMatchObject({
      status: 'HELD',
    });

    loseReserveReply = false;
    offer = { ...baseOffer(), withdrawn: true };
    await makeDue('5011');
    await orders.processDue();
    const [failed] = (await checkoutDs.query(
      `SELECT status, failure_reason AS reason FROM checkout.lead_order_request WHERE lead_id = 5011`,
    )) as Array<Record<string, unknown>>;
    expect(failed).toEqual({ status: 'FAILED', reason: 'OFFER_UNAVAILABLE' });
    await expect(reservationOf(request.orderId)).resolves.toMatchObject({
      status: 'RELEASED',
    });
    expect(await orderOfLead('5011')).toBeUndefined();
  });

  it('bekor qilishda ombor javob bermasa — buyurtma bekor, band outbox orqali keyin bo‘shaydi (holat va ombor ajralmaydi)', async () => {
    await orders.onLeadConfirmed(confirmed({ leadId: '5012' }));
    const order = await orderOfLead('5012');
    const id = String(order.id);
    inventoryDown = true;
    await expect(
      status.cancel({ orderId: id, reason: 'Mijoz rad etdi', actor: ACTOR }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(reservationOf(id)).resolves.toMatchObject({ status: 'HELD' });
    const [command] = await outboxOf('inventory.release', id);
    expect(command).toMatchObject({
      status: 'PENDING',
      payload: { orderRef: id, idempotencyKey: `lead-order-cancel:${id}` },
    });

    inventoryDown = false;
    // relay har 10 s da; bir o‘tishda har buyurtmaning faqat birinchi kutilayotgan yozuvi (tartib saqlanadi)
    for (let tick = 0; tick < 5; tick++) await relay.relayPending();
    await expect(reservationOf(id)).resolves.toMatchObject({
      status: 'RELEASED',
    });
    const [sent] = await outboxOf('inventory.release', id);
    expect(sent.status).toBe('PROCESSED');
  });

  it('sahifa narxi tasdiqlangan narxdan past (lid kelgandan keyin narx oshgan) — buyurtma yo‘q, band yo‘q, lid navbatga', async () => {
    offer = { ...baseOffer(), approvedPrice: 280_000, platformService: 54_000 };
    await orders.onLeadConfirmed(confirmed({ leadId: '5013' }));
    expect(await orderOfLead('5013')).toBeUndefined();
    const [failed] = await outboxOf('order.create-failed', '5013');
    expect(failed.payload).toMatchObject({ reason: 'OFFER_UNAVAILABLE' });
    const [request] = (await checkoutDs.query(
      `SELECT id::text AS id FROM checkout.lead_order_request WHERE lead_id = 5013`,
    )) as Array<{ id: string }>;
    const reserves = inventoryCalls.filter(
      (call) =>
        call.cmd === 'inventory.reserve' &&
        call.data.idempotencyKey === `lead-order:${request.id}`,
    );
    expect(reserves).toHaveLength(0);
  });

  it('admin ro‘yxati va kartasi: manba, lid, niqoblangan telefon, narx nusxasi va holat jurnali', async () => {
    const page = await admin.adminListOrders({ source: 'LANDING' });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((item) => item.source === 'LANDING')).toBe(true);
    expect(page.items[0]).toMatchObject({
      phoneMasked: '+998 90 *** ** 67',
    });
    expect(JSON.stringify(page)).not.toContain('+998901234567');

    const delivered = await orderOfLead('5001');
    const card = await admin.adminGetOrder(String(delivered.id));
    expect(card).toMatchObject({
      customerId: null,
      status: 'DELIVERED',
      lead: {
        source: 'LANDING',
        leadId: '5001',
        customerPhone: '+998901234567',
        deliveryCost: 40_000,
        codAmount: 306_000,
      },
    });
    expect(card.sellerOrders[0].items[0].priceSnapshot).toMatchObject({
      approvedPrice: 251_000,
      markup: 25_000,
    });
    expect(card.lead?.statusHistory).toHaveLength(8);

    const statuses = await admin.adminListOrders({ status: 'DELIVERED' });
    expect(statuses.items.map((item) => item.id)).toContain(
      String(delivered.id),
    );
  });

  it('bazada: lid buyurtmasi T5 dan tashqari holatga o‘tmaydi (CHECK)', async () => {
    const order = await orderOfLead('5006');
    await expect(
      checkoutDs.query(
        `UPDATE checkout.sales_order SET status = 'DRAFT' WHERE id = $1`,
        [order.id],
      ),
    ).rejects.toThrow(/chk_checkout_sales_order_lead/);
  });
});
