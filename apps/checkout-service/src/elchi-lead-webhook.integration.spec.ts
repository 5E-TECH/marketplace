import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { defer, from } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  CatalogOrderSnapshot,
  CheckoutDeliveryDestination,
  ElchiWebhookDto,
  LeadConfirmedEvent,
  LeadOrderActorType,
  LeadOrderStatus,
  LeadSource,
  OutboxEvent,
  OutboxService,
} from '@app/common';
import { CHECKOUT_DB } from './database';
import { ElchiLeadWebhookService } from './elchi-lead-webhook.service';
import { ElchiParcelEventsService } from './elchi-parcel-events.service';
import { LeadOrderService } from './lead-order.service';
import { LeadOrderStatusService } from './lead-order-status.service';
import { LeadReturnService } from './lead-return.service';
import { ReturnRequestQueryService } from './return-request-query.service';
import { INVENTORY_DB } from '../../inventory-service/src/database';
import { InventoryService } from '../../inventory-service/src/inventory.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
const INVENTORY_SCHEMA_TEST_LOCK = 2_304_005;
const CHECKOUT_SCHEMA_TEST_LOCK = 2_304_006;
const VARIANT = '901';

/** BE-21 haqiqiy PostgreSQL da (checkout va haqiqiy inventory): Elchi webhooki lid buyurtmasini T5 bo‘yicha yuritadi. */
describeWithPostgres(
  'BE-21 Elchi webhook — lid buyurtmasi (PostgreSQL)',
  () => {
    let lock: Client | undefined;
    let checkoutDs: DataSource;
    let inventoryDs: DataSource;
    let inventory: InventoryService;
    let orders: LeadOrderService;
    let status: LeadOrderStatusService;
    let parcels: ElchiParcelEventsService;
    let webhook: ElchiLeadWebhookService;
    const notifications = { emit: jest.fn(() => from([undefined])) };

    const rpc = (work: () => Promise<unknown>) =>
      defer(() =>
        from(
          work().catch((error: unknown) => {
            if (error instanceof HttpException) {
              const response = error.getResponse() as { message?: string };
              throw {
                statusCode: error.getStatus(),
                message: response?.message ?? error.message,
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

    const confirmed = (leadId: string): LeadConfirmedEvent => ({
      eventId: randomUUID(),
      leadId,
      source: LeadSource.LANDING,
      streamId: '301',
      affiliateId: '77',
      productId: '42',
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
    });

    const SYSTEM = { type: LeadOrderActorType.SYSTEM, id: null };

    /** Lid → buyurtma, Elchi posilkasi yaratilgan; `upTo` gacha ombor qadamlari. */
    const order = async (
      leadId: string,
      upTo: LeadOrderStatus = LeadOrderStatus.HANDED_TO_ELCHI,
    ) => {
      await orders.onLeadConfirmed(confirmed(leadId));
      const [row] = (await checkoutDs.query(
        'SELECT id::text AS id FROM checkout.sales_order WHERE lead_id = $1',
        [leadId],
      )) as Array<{ id: string }>;
      const shipmentId = String(1_251_100 + Number(row.id));
      await parcels.onCreated({
        eventId: `elchi.parcel.created:${row.id}`,
        orderId: row.id,
        shipmentId,
        qrCodeToken: `tok-${row.id}`,
        trackingUrl: `https://elchi.uz/t/${row.id}`,
        toBePaid: 306_000,
        createdAt: new Date().toISOString(),
      });
      for (const to of [
        LeadOrderStatus.PICKING,
        LeadOrderStatus.PACKED,
        LeadOrderStatus.HANDED_TO_ELCHI,
      ]) {
        if (
          upTo === LeadOrderStatus.CONFIRMED ||
          (upTo === LeadOrderStatus.PACKED &&
            to === LeadOrderStatus.HANDED_TO_ELCHI)
        )
          break;
        await status.transition({
          orderId: row.id,
          to,
          actor: SYSTEM,
          reason: null,
        } as never);
      }
      return { id: row.id, shipmentId };
    };

    const hook = (
      target: { id: string; shipmentId: string },
      elchiStatus: ElchiWebhookDto['status'],
      extra: Partial<ElchiWebhookDto> = {},
    ): ElchiWebhookDto => ({
      eventId: randomUUID(),
      type: 'shipment.status_changed',
      shipmentId: target.shipmentId,
      externalOrderId: `mp-order:${target.id}`,
      status: elchiStatus,
      occurredAt: new Date().toISOString(),
      ...extra,
    });

    const statusOf = async (orderId: string) =>
      (
        (await checkoutDs.query(
          'SELECT status FROM checkout.sales_order WHERE id = $1',
          [orderId],
        )) as Array<{ status: LeadOrderStatus }>
      )[0].status;

    const journal = (orderId: string) =>
      checkoutDs.query(
        `SELECT from_status AS "from", to_status AS "to", accepted, actor_type AS "actor"
         FROM checkout.order_status_history WHERE order_id = $1 ORDER BY id`,
        [orderId],
      ) as Promise<
        Array<{ from: string; to: string; accepted: boolean; actor: string }>
      >;

    const outboxOf = (orderId: string, eventType: string) =>
      checkoutDs.query(
        `SELECT payload FROM checkout.outbox_event
        WHERE aggregate_id = $1 AND event_type = $2 ORDER BY id`,
        [orderId, eventType],
      ) as Promise<Array<{ payload: Record<string, unknown> }>>;

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
      parcels = new ElchiParcelEventsService(checkoutDs);
      webhook = new ElchiLeadWebhookService(
        checkoutDs,
        outbox,
        status,
        notifications as never,
      );
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

    it('TC1: «Yo‘lda» xabari yo‘qolsa ham «Sotildi» → Yetkazildi; keyin «Yo‘lda» — o‘zgarmaydi, jurnalda rad', async () => {
      const target = await order('8101');
      await expect(
        webhook.process(hook(target, 'sold')),
      ).resolves.toMatchObject({ result: 'APPLIED', status: 'DELIVERED' });
      await expect(
        webhook.process(hook(target, 'on_the_road')),
      ).resolves.toMatchObject({ result: 'REJECTED' });
      expect(await statusOf(target.id)).toBe('DELIVERED');
      const rows = (await journal(target.id)).filter(
        (r) => r.actor === 'ELCHI',
      );
      expect(rows).toEqual([
        {
          from: 'HANDED_TO_ELCHI',
          to: 'IN_TRANSIT',
          accepted: true,
          actor: 'ELCHI',
        },
        { from: 'IN_TRANSIT', to: 'DELIVERED', accepted: true, actor: 'ELCHI' },
        {
          from: 'DELIVERED',
          to: 'IN_TRANSIT',
          accepted: false,
          actor: 'ELCHI',
        },
      ]);
      const [{ count }] = (await checkoutDs.query(
        `SELECT count(*)::int AS count FROM checkout.elchi_webhook_event
        WHERE order_id = $1 AND result = 'REJECTED'`,
        [target.id],
      )) as Array<{ count: number }>;
      expect(count).toBe(1);
    });

    it('TC2: `paid` va summalar → Pul o‘tkazildi, moliyaga 2-versiya hodisa (outbox, «Yetkazildi» dan keyin)', async () => {
      const target = await order('8102');
      await webhook.process(hook(target, 'sold'));
      await expect(
        webhook.process(
          hook(target, 'paid', {
            collectedFromCustomer: 306_000,
            elchiFee: 40_000,
            marketPaidAmount: 266_000,
          }),
        ),
      ).resolves.toMatchObject({ result: 'APPLIED', status: 'REMITTED' });
      const [remittance] = await outboxOf(target.id, 'finance.cod.settled');
      expect(remittance.payload).toMatchObject({
        schemaVersion: 2,
        orderId: target.id,
        shipmentId: target.shipmentId,
        elchiStatus: 'paid',
        collectedFromCustomer: 306_000,
        elchiFee: 40_000,
        marketPaidAmount: 266_000,
        refusalFee: null,
      });
      // bitta oqim: holat hodisasi oldin
      const stream = (await checkoutDs.query(
        `SELECT event_type AS type FROM checkout.outbox_event
        WHERE aggregate_type = 'sales_order' AND aggregate_id = $1 ORDER BY id`,
        [target.id],
      )) as Array<{ type: string }>;
      expect(stream.map((r) => r.type).slice(-2)).toEqual([
        'order.status.changed',
        'finance.cod.settled',
      ]);
    });

    it('TC3: bitta webhook 2 marta → bir marta ishlandi', async () => {
      const target = await order('8103');
      const once = hook(target, 'on_the_road');
      await webhook.process(once);
      await expect(webhook.process(once)).resolves.toEqual({
        received: true,
        duplicate: true,
      });
      const rows = (await journal(target.id)).filter(
        (r) => r.actor === 'ELCHI',
      );
      expect(rows).toHaveLength(1);
    });

    it('rad etilgan posilka: «bekor» topshirilgandan keyin → Rad etildi (20 000 moliyada), rad to‘lovi moliyaga; qaytdi → Qaytmoqda', async () => {
      const target = await order('8104');
      await webhook.process(hook(target, 'on_the_road'));
      await expect(
        webhook.process(hook(target, 'cancelled', { extraCost: 20_000 })),
      ).resolves.toMatchObject({ result: 'APPLIED', status: 'REFUSED' });
      const [fee] = await outboxOf(target.id, 'finance.cod.settled');
      expect(fee.payload).toMatchObject({
        elchiStatus: 'closed',
        refusalFee: 20_000,
      });
      await expect(
        webhook.process(hook(target, 'returned')),
      ).resolves.toMatchObject({ status: 'RETURNING' });
    });

    it('topshirilgunga qadar Elchi’da bekor — buyurtma bekor, band bo‘shaydi', async () => {
      const target = await order('8105', LeadOrderStatus.PACKED);
      await expect(
        webhook.process(hook(target, 'cancelled')),
      ).resolves.toMatchObject({ result: 'APPLIED', status: 'CANCELLED' });
      const commands = await checkoutDs.query(
        `SELECT event_type AS type, payload FROM checkout.outbox_event
        WHERE aggregate_type = 'inventory_command' AND aggregate_id = $1`,
        [target.id],
      );
      expect(JSON.stringify(commands)).toContain('inventory.release');
    });

    it('akt yopilmagan (yig‘ildi) — «qabul qilindi» holatni o‘zgartirmaydi (NOOP); boshqa posilka raqami — 400', async () => {
      const target = await order('8106', LeadOrderStatus.PACKED);
      await expect(
        webhook.process(hook(target, 'received')),
      ).resolves.toMatchObject({ result: 'NOOP', status: 'PACKED' });
      expect(await statusOf(target.id)).toBe('PACKED');
      await expect(
        webhook.process(hook({ ...target, shipmentId: '999999' }, 'sold')),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('Elchi yetkazilgan sotuvni bekor qildi — holat o‘zgarmaydi (REJECTED), pul yozilmaydi, moliya va nazoratchiga xabar', async () => {
      const target = await order('8107');
      await webhook.process(hook(target, 'sold'));
      notifications.emit.mockClear();
      await expect(
        webhook.process(hook(target, 'cancelled', { extraCost: 20_000 })),
      ).resolves.toMatchObject({ result: 'REJECTED', status: 'DELIVERED' });
      expect(await outboxOf(target.id, 'finance.cod.settled')).toEqual([]);
      expect(notifications.emit).toHaveBeenCalledWith(
        'elchi.status.conflict',
        expect.objectContaining({
          orderId: target.id,
          orderStatus: 'DELIVERED',
          elchiStatus: 'cancelled',
        }),
      );
    });

    it('rad to‘lovi faqat musbat `extra_cost`: 0 — yozilmaydi; keyingi xabarda kiritilsa — yoziladi; keyingi «bekor» — NOOP', async () => {
      const target = await order('8108');
      await webhook.process(hook(target, 'on_the_road'));
      await webhook.process(hook(target, 'cancelled', { extraCost: 0 }));
      expect(await statusOf(target.id)).toBe('REFUSED');
      expect(await outboxOf(target.id, 'finance.cod.settled')).toEqual([]);
      await webhook.process(hook(target, 'returned', { extraCost: 20_000 }));
      const fees = await outboxOf(target.id, 'finance.cod.settled');
      expect(fees.map((f) => f.payload.refusalFee)).toEqual([20_000]);
      await expect(
        webhook.process(hook(target, 'cancelled', { extraCost: 0 })),
      ).resolves.toMatchObject({ result: 'NOOP', status: 'RETURNING' });
    });

    it('qaytarish so‘rovi ochiq: «sotildi»/«to‘landi» — holat o‘zgarmaydi (NOOP), pul moliyaga yoziladi, zid xabar yo‘q', async () => {
      const target = await order('8110');
      await webhook.process(hook(target, 'sold'));
      await checkoutDs.transaction((manager) =>
        status.applyTransition(manager, {
          orderId: target.id,
          to: LeadOrderStatus.RETURN_REQUESTED,
          actor: { type: LeadOrderActorType.USER, id: '1' },
          reason: 'Mijoz qaytarmoqchi (test)',
        }),
      );
      notifications.emit.mockClear();
      await expect(
        webhook.process(hook(target, 'delivered')),
      ).resolves.toMatchObject({ result: 'NOOP', status: 'RETURN_REQUESTED' });
      await expect(
        webhook.process(
          hook(target, 'paid', {
            collectedFromCustomer: 306_000,
            elchiFee: 40_000,
            marketPaidAmount: 266_000,
          }),
        ),
      ).resolves.toMatchObject({ result: 'NOOP', status: 'RETURN_REQUESTED' });
      expect(await statusOf(target.id)).toBe('RETURN_REQUESTED');
      const money = await outboxOf(target.id, 'finance.cod.settled');
      expect(money.map((m) => m.payload)).toEqual([
        expect.objectContaining({
          elchiStatus: 'paid',
          marketPaidAmount: 266_000,
          refusalFee: null,
        }),
      ]);
      expect(notifications.emit).not.toHaveBeenCalled();
    });

    describe('QA-02: qaytarish so‘rovi va Elchi puli', () => {
      const STAFF = { id: '41', role: 'ADMIN' };
      const returns = () =>
        new LeadReturnService(
          checkoutDs,
          { get: () => 10 } as never,
          status,
          new OutboxService(checkoutDs.getRepository(OutboxEvent)),
          new ReturnRequestQueryService(checkoutDs),
        );
      /** Yetkazilgan buyurtma va unga xodim kiritgan qaytarish so‘rovi. */
      const requested = async (leadId: string) => {
        const target = await order(leadId);
        await webhook.process(hook(target, 'sold'));
        const [item] = (await checkoutDs.query(
          `SELECT i.id::text FROM checkout.sales_order_item i
             JOIN checkout.parcel p ON p.id = i.sales_order_seller_id WHERE p.sales_order_id = $1`,
          [target.id],
        )) as Array<{ id: string }>;
        const created = await returns().create({
          orderId: target.id,
          dto: {
            items: [{ orderItemId: item.id, quantity: 1 }],
            reason: 'DEFECTIVE',
            comment: 'test',
          } as never,
          actor: STAFF,
        });
        return { target, returnId: created.id };
      };
      const money = {
        collectedFromCustomer: 306_000,
        elchiFee: 40_000,
        marketPaidAmount: 266_000,
      };

      it('so‘rov ochiq turganda «to‘landi» (webhook) → rad etilgach «Pul o‘tkazildi»; «qisman to‘landi» — «Yetkazildi»', async () => {
        const paid = await requested('8130');
        await expect(
          webhook.process(hook(paid.target, 'paid', money)),
        ).resolves.toMatchObject({
          result: 'NOOP',
          status: 'RETURN_REQUESTED',
        });
        await returns().decide({
          returnId: paid.returnId,
          approve: false,
          actor: STAFF,
          comment: 'ishlatilgan',
        });
        expect(await statusOf(paid.target.id)).toBe('REMITTED');

        const partly = await requested('8131');
        await webhook.process(
          hook(partly.target, 'partly_paid', {
            ...money,
            marketPaidAmount: 100_000,
          }),
        );
        await returns().decide({
          returnId: partly.returnId,
          approve: false,
          actor: STAFF,
          comment: 'ishlatilgan',
        });
        expect(await statusOf(partly.target.id)).toBe('DELIVERED');
      });

      it('qaytarish tasdiqlangandan keyin «to‘landi» — holat o‘zgarmaydi (NOOP), pul moliyaga yoziladi, zid xabar yo‘q', async () => {
        const { target, returnId } = await requested('8132');
        await returns().decide({ returnId, approve: true, actor: STAFF });
        expect(await statusOf(target.id)).toBe('RETURNING');
        notifications.emit.mockClear();
        await expect(
          webhook.process(hook(target, 'paid', money)),
        ).resolves.toMatchObject({
          result: 'NOOP',
          status: 'RETURNING',
        });
        expect(
          (await outboxOf(target.id, 'finance.cod.settled')).map(
            (m) => m.payload,
          ),
        ).toEqual([
          expect.objectContaining({
            elchiStatus: 'paid',
            marketPaidAmount: 266_000,
          }),
        ]);
        expect(notifications.emit).not.toHaveBeenCalled();
      });
    });

    it('zid xabar: rad etilgan posilkaga «sotildi»/«to‘landi» — o‘zgarmaydi, pul yozilmaydi, buyurtma uchun bir marta xabar', async () => {
      const target = await order('8109');
      await webhook.process(hook(target, 'on_the_road'));
      await webhook.process(hook(target, 'cancelled'));
      notifications.emit.mockClear();
      await expect(
        webhook.process(hook(target, 'sold')),
      ).resolves.toMatchObject({ result: 'REJECTED', status: 'REFUSED' });
      await webhook.process(
        hook(target, 'paid', { marketPaidAmount: 266_000 }),
      );
      expect(await outboxOf(target.id, 'finance.cod.settled')).toEqual([]);
      expect(notifications.emit).toHaveBeenCalledTimes(1);
      expect(notifications.emit).toHaveBeenCalledWith(
        'elchi.status.conflict',
        expect.objectContaining({ orderId: target.id, elchiStatus: 'sold' }),
      );
    });
  },
);
