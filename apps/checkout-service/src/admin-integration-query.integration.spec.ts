import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AdminIntegrationQueryService } from './admin-integration-query.service';
import { CreateCheckoutTables1722513600000 } from './migrations/1722513600000-create-checkout-tables';
import { CreateCartTables1723032000000 } from './migrations/1723032000000-create-cart-tables';
import { CreateOrderHistory1723200000000 } from './migrations/1723200000000-create-order-history';
import { CreateElchiWebhookEvent1724587200000 } from './migrations/1724587200000-create-elchi-webhook-event';
import { AddDeliveryFee1725192000000 } from './migrations/1725192000000-add-delivery-fee';
import { AddSalesOrderSessionId1726329600000 } from './migrations/1726329600000-add-sales-order-session-id';
import { AddCartItemProductName1726416000000 } from './migrations/1726416000000-add-cart-item-product-name';
import { AddSellerOrderQrToken1726502400000 } from './migrations/1726502400000-add-seller-order-qr-token';
import { AddSellerOrderToBePaid1726588800000 } from './migrations/1726588800000-add-seller-order-to-be-paid';
import { CreateReturnRequests1727481600000 } from './migrations/1727481600000-create-return-requests';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;
/** lead-order.integration.spec.ts bilan bir xil: checkout sxemasini DROP/CREATE qiladigan spec’lar ketma-ket (BE-18). */
const CHECKOUT_SCHEMA_TEST_LOCK = 2_304_006;

type ShipmentRow = { id: string; orderStatus: string };

/**
 * C6.7 — Elchi posilkalari ro'yxati HAQIQIY Postgres'da. Mock testda
 * ko'rinmagan nuqson shu yerda topilgan: filtrsiz so'rov `WHERE ORDER BY`
 * bo'lib yiqilardi.
 */
describeWithPostgres('AdminIntegrationQueryService PostgreSQL (C6.7)', () => {
  let dataSource: DataSource;
  let service: AdminIntegrationQueryService;
  let lock: Client | undefined;

  beforeAll(async () => {
    const databaseUrl = new URL(testDatabaseUrl!);
    if (!databaseUrl.pathname.toLowerCase().includes('test')) {
      throw new Error(
        'TEST_DATABASE_URL faqat nomida "test" bor alohida bazaga ishora qilishi kerak',
      );
    }
    lock = new Client({ connectionString: testDatabaseUrl });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [
      CHECKOUT_SCHEMA_TEST_LOCK,
    ]);
    await lock.query('DROP SCHEMA IF EXISTS checkout CASCADE');
    await lock.query('CREATE SCHEMA checkout');

    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      schema: 'checkout',
      migrations: [
        CreateCheckoutTables1722513600000,
        CreateCartTables1723032000000,
        CreateOrderHistory1723200000000,
        CreateElchiWebhookEvent1724587200000,
        AddDeliveryFee1725192000000,
        AddSalesOrderSessionId1726329600000,
        AddCartItemProductName1726416000000,
        AddSellerOrderQrToken1726502400000,
        AddSellerOrderToBePaid1726588800000,
        CreateReturnRequests1727481600000,
        MoneyToBigint1795219200000,
      ],
      migrationsRun: true,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    service = new AdminIntegrationQueryService(dataSource);

    await dataSource.query(`
      INSERT INTO checkout.sales_order (id,customer_id,status,payment_method,total_amount) VALUES
        (1,1,'CONFIRMED','cod',100),(2,1,'DRAFT','cod',100),(3,1,'CONFIRMED','cod',100),
        (4,1,'PAID','online',100),(5,1,'CONFIRMED','cod',100)`);
    await dataSource.query(`
      INSERT INTO checkout.sales_order_seller
        (id,sales_order_id,shop_id,subtotal,status,elchi_shipment_id) VALUES
        (11,1,5,100,'SHIPMENT_CREATED',1251131),
        (12,2,5,100,'PENDING',NULL),
        (13,3,7,100,'CONFIRMED',NULL),
        (14,4,5,100,'PENDING',NULL),
        (15,5,5,100,'CANCELLED',NULL)`);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await lock?.end();
  });

  it('filtrsiz (all) so‘rov ishlaydi va hammasini qaytaradi', async () => {
    const page = await service.shipments({ page: 1, limit: 20 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(5);
  });

  it('BE-01: pul ustunlari BIGINT, javobda son', async () => {
    const [column] = await dataSource.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='checkout' AND table_name='sales_order_seller'
          AND column_name='subtotal'`,
    );
    expect(column.data_type).toBe('bigint');
    const page = await service.shipments({ page: 1, limit: 20 });
    const row = (page.items as Array<Record<string, unknown>>).find(
      (item) => item.id === '11',
    );
    expect(row).toMatchObject({ subtotal: 100, deliveryFee: 0, codAmount: 0 });
  });

  it('created — faqat Elchi posilkasi borlari', async () => {
    const page = await service.shipments({
      page: 1,
      limit: 20,
      shipmentState: 'created',
    });
    expect((page.items as ShipmentRow[]).map((row) => row.id)).toEqual(['11']);
  });

  it('missing — tasdiqlangan/to‘langan, yakunlanmagan, posilkasiz; DRAFT va CANCELLED yo‘q', async () => {
    const page = await service.shipments({
      page: 1,
      limit: 20,
      shipmentState: 'missing',
    });
    expect(page.total).toBe(2);
    expect((page.items as ShipmentRow[]).map((row) => row.id).sort()).toEqual([
      '13',
      '14',
    ]);

    const shop = await service.shipments({
      page: 1,
      limit: 20,
      shipmentState: 'missing',
      shopId: '7',
    });
    expect(shop.items).toEqual([
      expect.objectContaining({ id: '13', orderStatus: 'CONFIRMED' }),
    ]);
  });
});
