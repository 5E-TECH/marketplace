import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { Client } from 'pg';
import { defer, from } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CatalogOrderSnapshot,
  CheckoutDeliveryDestination,
  ErrorCode,
  LeadConfirmedEvent,
  LeadOrderActorType,
  LeadSource,
  OutboxEvent,
  OutboxService,
} from '@app/common';
import { CHECKOUT_DB } from './database';
import { ElchiParcelEventsService } from './elchi-parcel-events.service';
import { FulfillmentService } from './fulfillment.service';
import { LeadOrderService } from './lead-order.service';
import { LeadOrderStatusService } from './lead-order-status.service';
import { SellerOrdersService } from './seller-orders.service';
import { ShippingLabelService } from './shipping-label.service';
import { INVENTORY_DB } from '../../inventory-service/src/database';
import { InventoryService } from '../../inventory-service/src/inventory.service';
import { Reservation } from '../../inventory-service/src/entities/reservation.entity';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
const INVENTORY_SCHEMA_TEST_LOCK = 2_304_005;
const CHECKOUT_SCHEMA_TEST_LOCK = 2_304_006;

const VARIANT = '901';
const WAREHOUSE = { id: '61', role: 'WAREHOUSE' };

/**
 * BE-19 haqiqiy PostgreSQL da (checkout va haqiqiy inventory): yig‘ish kuni, skaner, qadoq, yorliq, Elchi posilka
 * xabarlari va topshirish akti.
 */
describeWithPostgres(
  'BE-19 ombor: yig‘ish, qadoq, yorliq, topshirish (PostgreSQL)',
  () => {
    let lock: Client | undefined;
    let checkoutDs: DataSource;
    let inventoryDs: DataSource;
    let inventory: InventoryService;
    let orders: LeadOrderService;
    let status: LeadOrderStatusService;
    let fulfillment: FulfillmentService;
    let parcels: ElchiParcelEventsService;

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

    const offer: CatalogOrderSnapshot = {
      productId: '42',
      productName: 'Simsiz quloqchin',
      variantId: VARIANT,
      sku: 'Q-1',
      barcode: '4780012345678',
      wholesalerId: '15',
      weightGrams: 1_000,
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
    };

    const confirmed = (
      leadId: string,
      confirmedAt: string,
      quantity = 1,
    ): LeadConfirmedEvent => ({
      eventId: randomUUID(),
      leadId,
      source: LeadSource.LANDING,
      streamId: '301',
      affiliateId: '77',
      productId: '42',
      quantity,
      salePrice: 276_000,
      customerName: 'Dilnoza',
      customerPhone: '+998901234567',
      regionSoato: '1726',
      districtSoato: '1726262',
      addressLine: 'Chilonzor 5-mavze, 12-uy',
      whereDeliver: CheckoutDeliveryDestination.CENTER,
      confirmedBy: '41',
      addressConfirmedBy: '41',
      confirmedAt,
    });

    const orderOf = async (leadId: string) =>
      (
        (await checkoutDs.query(
          `SELECT o.id::text AS id, o.status, t.id::text AS "taskId", t.status AS "taskStatus",
                to_char(t.pick_date, 'YYYY-MM-DD') AS "pickDate"
           FROM checkout.sales_order o
           JOIN checkout.fulfillment_task t ON t.order_id = o.id
          WHERE o.lead_id = $1`,
          [leadId],
        )) as Array<Record<string, string>>
      )[0];

    const created = (orderId: string, token: string) =>
      parcels.onCreated({
        eventId: `elchi.parcel.created:${orderId}`,
        orderId,
        shipmentId: String(1_251_100 + Number(orderId)),
        qrCodeToken: token,
        trackingUrl: `https://elchi.uz/t/${token}`,
        toBePaid: 306_000,
        createdAt: new Date().toISOString(),
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
      await inventory.inbound({
        variantId: VARIANT,
        warehouseId: await inventory.hqWarehouseId(),
        quantity: 20,
        reason: 'Qabul (test)',
        actorId: '1',
        idempotencyKey: 'in-1',
      });

      const catalog = { send: () => rpc(async () => offer) };
      const inventoryClient = {
        send: (pattern: { cmd: string }, data: Record<string, unknown>) =>
          rpc(async () => {
            if (pattern.cmd === 'inventory.reserve')
              return inventory.reserveAvailable(data as never);
            if (pattern.cmd === 'inventory.release')
              return inventory.release(data as never);
            if (pattern.cmd === 'inventory.commit')
              return inventory.commit(data as never);
            throw new Error(`kutilmagan ombor so‘rovi: ${pattern.cmd}`);
          }),
      };
      const integration = {
        send: (pattern: { cmd: string }) =>
          rpc(async () => {
            if (pattern.cmd !== 'integration.geo.resolve-address')
              throw new Error(`kutilmagan so‘rov: ${pattern.cmd}`);
            return {
              ok: true,
              regionName: 'Toshkent shahri',
              districtName: 'Chilonzor tumani',
            };
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
      fulfillment = new FulfillmentService(
        checkoutDs,
        status,
        new ShippingLabelService(),
        integration as never,
      );
      parcels = new ElchiParcelEventsService(checkoutDs);
    });

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

    afterEach(() => jest.restoreAllMocks());

    it('TC1: 13:55 da tasdiqlangan — o‘sha kungi ro‘yxatda; 14:05 dagisi — ertangi ro‘yxatda', async () => {
      // Toshkent UTC+5: 13:55 = 08:55 UTC
      await orders.onLeadConfirmed(
        confirmed('7001', '2026-12-15T08:55:00Z', 2),
      );
      await orders.onLeadConfirmed(confirmed('7002', '2026-12-15T09:05:00Z'));
      await expect(orderOf('7001')).resolves.toMatchObject({
        pickDate: '2026-12-15',
        taskStatus: 'TO_PICK',
      });
      await expect(orderOf('7002')).resolves.toMatchObject({
        pickDate: '2026-12-16',
      });

      const today = await fulfillment.pickList('2026-12-15');
      expect(today.items.map((item) => item.orderNumber)).toEqual([
        `L-${(await orderOf('7001')).id}`,
      ]);
      expect(today.items[0]).toMatchObject({
        sku: 'Q-1',
        barcode: '4780012345678',
        quantity: 2,
        pickedQty: 0,
        overdue: false,
        parcel: { elchiState: 'PENDING', labelReady: false },
      });
      // ertasi kun: 7002 va kechikkan 7001
      const tomorrow = await fulfillment.pickList('2026-12-16');
      expect(
        tomorrow.items.map((item) => [item.orderId, item.overdue]),
      ).toEqual([
        [(await orderOf('7001')).id, true],
        [(await orderOf('7002')).id, false],
      ]);
      expect(tomorrow.counts).toMatchObject({ toPick: 2, overdue: 1 });
    });

    it('TC2: boshqa SKU skanerlandi → 409 WRONG_ITEM va jurnalda; to‘g‘ri skaner — «Yig‘ilmoqda», hamma dona — «Yig‘ildi»', async () => {
      const order = await orderOf('7001');
      await expect(
        fulfillment.scan(order.taskId, 'BOSHQA-SKU', WAREHOUSE),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: ErrorCode.WRONG_ITEM },
      });
      // qadoqlash yopiq: hali yig‘ilmagan
      await expect(
        fulfillment.pack(order.taskId, WAREHOUSE),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        fulfillment.scan(order.taskId, '4780012345678', WAREHOUSE),
      ).resolves.toMatchObject({
        status: 'TO_PICK',
        pickedQty: 1,
        quantity: 2,
      });
      await expect(orderOf('7001')).resolves.toMatchObject({
        status: 'PICKING',
      });
      await expect(
        fulfillment.scan(order.taskId, ' q-1 ', WAREHOUSE),
      ).resolves.toMatchObject({ status: 'PICKED', pickedQty: 2 });
      await expect(
        fulfillment.scan(order.taskId, 'Q-1', WAREHOUSE),
      ).rejects.toMatchObject({ status: 409 });

      const scans = (await checkoutDs.query(
        `SELECT code, matched, actor_id::text AS actor FROM checkout.fulfillment_scan
        WHERE task_id = $1 ORDER BY id`,
        [order.taskId],
      )) as Array<Record<string, unknown>>;
      expect(scans).toEqual([
        { code: 'BOSHQA-SKU', matched: false, actor: '61' },
        { code: '4780012345678', matched: true, actor: '61' },
        { code: 'q-1', matched: true, actor: '61' },
      ]);
    });

    it('qadoq: buyurtma «Qadoqlandi»; yorliq Elchi posilkasisiz — 409', async () => {
      const order = await orderOf('7001');
      await expect(
        fulfillment.pack(order.taskId, WAREHOUSE),
      ).resolves.toMatchObject({ status: 'PACKED' });
      await expect(orderOf('7001')).resolves.toMatchObject({
        status: 'PACKED',
        taskStatus: 'PACKED',
      });
      await expect(fulfillment.label(order.id)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('TC3: Elchi posilkasi yaratildi → yorliqda Elchi raqami, QR va operator tasdiqlagan manzil (telefon, viloyat, tuman)', async () => {
      const order = await orderOf('7001');
      await created(order.id, 'tok-7001');
      // takror xabar bir marta ishlanadi
      await parcels.onCreated({
        eventId: `elchi.parcel.created:${order.id}`,
        orderId: order.id,
        shipmentId: '999',
        qrCodeToken: 'boshqa',
        trackingUrl: null,
        toBePaid: 1,
        createdAt: new Date().toISOString(),
      });
      const data = await fulfillment.labelData(order.id);
      expect(data).toMatchObject({
        shipmentId: String(1_251_100 + Number(order.id)),
        qrCodeToken: 'tok-7001',
        senderName: 'Elchi Market',
        buyerName: 'Dilnoza',
        buyerPhone: '+998901234567',
        regionName: 'Toshkent shahri',
        districtName: 'Chilonzor tumani',
        deliveryAddress: 'Chilonzor 5-mavze, 12-uy',
        codAmount: 306_000,
        items: [{ productName: 'Simsiz quloqchin', quantity: 2 }],
      });

      const text = jest.spyOn(PDFDocument.prototype, 'text');
      const pdf = await fulfillment.label(order.id);
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe(
        '%PDF-',
      );
      const printed = text.mock.calls.map((call) => String(call[0])).join('\n');
      for (const expected of [
        String(1_251_100 + Number(order.id)),
        'tok-7001',
        '+998901234567',
        'Toshkent shahri',
        'Chilonzor 5-mavze, 12-uy',
      ])
        expect(printed).toContain(expected);

      // pick-list: posilka tayyor
      const list = await fulfillment.pickList('2026-12-16');
      expect(
        list.items.find((item) => item.orderId === order.id)?.parcel,
      ).toEqual({
        elchiState: 'CREATED',
        shipmentId: String(1_251_100 + Number(order.id)),
        labelReady: true,
        error: null,
      });
    });

    it('TC4: topshirish akti — tayyor bo‘lmagan posilka bo‘lsa butun akt rad; aks holda aktdagi son = topshirilgan posilkalar, band chiqimga', async () => {
      const first = await orderOf('7001');
      const second = await orderOf('7002');
      // 7002 ni yig‘ib qadoqlaymiz va posilkasini yaratamiz
      await fulfillment.scan(second.taskId, 'Q-1', WAREHOUSE);
      await fulfillment.pack(second.taskId, WAREHOUSE);
      await created(second.id, 'tok-7002');
      // 7003 — qadoqlanmagan
      await orders.onLeadConfirmed(confirmed('7003', '2026-12-16T05:00:00Z'));
      const third = await orderOf('7003');
      await created(third.id, 'tok-7003');

      await expect(
        fulfillment.handover(['tok-7001', 'tok-7003', 'yo‘q'], WAREHOUSE),
      ).rejects.toMatchObject({ status: 409 });
      await expect(orderOf('7001')).resolves.toMatchObject({
        status: 'PACKED',
      });
      const [{ acts }] = (await checkoutDs.query(
        `SELECT COUNT(*)::int AS acts FROM checkout.handover_act`,
      )) as Array<{ acts: number }>;
      expect(acts).toBe(0);

      const act = await fulfillment.handover(
        ['tok-7001', 'tok-7002', 'tok-7001'],
        WAREHOUSE,
      );
      expect(act.parcelCount).toBe(2);
      expect(act.items).toHaveLength(act.parcelCount);
      expect(act.items.map((item) => item.qrCodeToken)).toEqual([
        'tok-7001',
        'tok-7002',
      ]);
      for (const order of [first, second]) {
        await expect(
          orderOf(order.id === first.id ? '7001' : '7002'),
        ).resolves.toMatchObject({
          status: 'HANDED_TO_ELCHI',
          taskStatus: 'HANDED_OVER',
        });
        // band chiqimga aylandi (BE-16: chiqim topshirishda)
        await expect(
          inventoryDs
            .getRepository(Reservation)
            .findOneByOrFail({ orderRef: order.id }),
        ).resolves.toMatchObject({ status: 'COMMITTED' });
      }
      const [{ handed }] = (await checkoutDs.query(
        `SELECT COUNT(*)::int AS handed FROM checkout.parcel WHERE handover_act_id = $1`,
        [act.id],
      )) as Array<{ handed: number }>;
      expect(handed).toBe(act.parcelCount);
      await expect(fulfillment.act(act.id)).resolves.toEqual(act);
      const pdf = await fulfillment.actPdf(act.id);
      expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe(
        '%PDF-',
      );
      // topshirilganlar ro‘yxatdan chiqdi
      const list = await fulfillment.pickList('2026-12-16');
      expect(list.items.map((item) => item.orderId)).toEqual([third.id]);
      // ikkinchi marta topshirib bo‘lmaydi
      await expect(
        fulfillment.handover(['tok-7001'], WAREHOUSE),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('bekor qilingan buyurtma ro‘yxatdan chiqadi; Elchi posilkasi yaratilmasa — sabab ro‘yxatda va yorliqda', async () => {
      const third = await orderOf('7003');
      await status.cancel({
        orderId: third.id,
        reason: 'Mijoz rad etdi',
        actor: { type: LeadOrderActorType.USER, id: '41' },
      });
      await expect(orderOf('7003')).resolves.toMatchObject({
        taskStatus: 'CANCELLED',
      });
      await expect(
        fulfillment.scan(third.taskId, 'Q-1', WAREHOUSE),
      ).rejects.toMatchObject({ status: 409 });
      await parcels.onCancelled({
        eventId: `elchi.parcel.cancelled:${third.id}:1`,
        orderId: third.id,
        shipmentId: '1',
        message: null,
        at: new Date().toISOString(),
      });

      await orders.onLeadConfirmed(confirmed('7004', '2026-12-16T05:00:00Z'));
      const fourth = await orderOf('7004');
      await parcels.onFailed({
        eventId: `elchi.parcel.failed:${fourth.id}:x`,
        orderId: fourth.id,
        reason: 'DISTRICT_NOT_FOUND',
        message: 'Tuman Elchi’da topilmadi',
        at: new Date().toISOString(),
      });
      const list = await fulfillment.pickList('2026-12-16');
      expect(list.items.map((item) => item.orderId)).toEqual([fourth.id]);
      expect(list.items[0].parcel).toMatchObject({
        elchiState: 'FAILED',
        labelReady: false,
        error: 'DISTRICT_NOT_FOUND: Tuman Elchi’da topilmadi',
      });
      await expect(fulfillment.label(fourth.id)).rejects.toMatchObject({
        status: 409,
        response: { message: expect.stringContaining('yaratilmadi') },
      });
    });

    it('eski nom (sales_order_seller) ko‘rinish orqali ishlaydi: admin ro‘yxati va kartasi posilkani ko‘radi', async () => {
      const admin = new SellerOrdersService(checkoutDs);
      const order = await orderOf('7001');
      const card = await admin.adminGetOrder(order.id);
      expect(card.sellerOrders).toHaveLength(1);
      expect(card.sellerOrders[0]).toMatchObject({
        elchiShipmentId: String(1_251_100 + Number(order.id)),
        hasQrToken: true,
      });
      const page = await admin.adminListOrders({ source: 'LANDING' });
      expect(page.items.find((item) => item.id === order.id)).toMatchObject({
        sellersCount: 1,
        shipmentsCount: 1,
      });
    });
  },
);
