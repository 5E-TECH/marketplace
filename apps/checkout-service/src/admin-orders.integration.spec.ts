import { Client } from 'pg';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  ELCHI_CHECK_RPC,
  ErrorCode,
  LeadOrderStatus,
  ORDER_EVENTS,
  OrderExportColumn,
  OrderViewer,
  OutboxEvent,
  OutboxService,
  UserNamesClient,
} from '@app/common';
import { AdminOrdersRpcController } from './admin-orders.controller';
import { AdminOrdersService, waveText } from './admin-orders.service';
import { CHECKOUT_DB } from './database';
import { ElchiLeadWebhookService } from './elchi-lead-webhook.service';
import { LeadOrderStatusService } from './lead-order-status.service';
import { SellerOrdersService } from './seller-orders.service';

import { ProductOpenOrdersService } from './product-open-orders.controller';
const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
const CHECKOUT_SCHEMA_TEST_LOCK = 2_304_006;
const PHONE = '+998901234567';
const ADMIN: OrderViewer = { kind: 'ADMIN', userId: '7' };
const SUPERVISOR: OrderViewer = { kind: 'SUPERVISOR', userId: '9' };
const OPERATOR: OrderViewer = { kind: 'OPERATOR', userId: '41' };
const NOW = new Date('2027-01-14T09:38:00.000Z'); // 14:38 Toshkent

describe('to‘lqin matni', () => {
  it('bugungi, ertangi, boshqa kun; kun — Toshkent bo‘yicha', () => {
    expect(waveText('2027-01-14', NOW)).toBe('bugungi to‘lqin');
    expect(waveText('2027-01-15', NOW)).toBe('ertangi to‘lqin');
    expect(waveText('2027-01-18', NOW)).toBe('18.01 to‘lqini');
    // UTC da hali 13-yanvar, Toshkentda 14-yanvar
    expect(waveText('2027-01-14', new Date('2027-01-13T20:00:00Z'))).toBe(
      'bugungi to‘lqin',
    );
    expect(waveText(null, NOW)).toBeNull();
  });
});

describeWithPostgres('BE-25 (FE-26): buyurtmalar PostgreSQL da', () => {
  let db: DataSource;
  let lock: Client;
  let seq = 0;
  let elchiStatus = 'on the road';
  let queueDown = false;
  const emitted: Array<{ pattern: string; event: Record<string, unknown> }> =
    [];

  const integration = {
    send: (pattern: { cmd: string }, data: { shipmentIds?: string[] }) =>
      of(
        pattern.cmd === ELCHI_CHECK_RPC.SHIPMENTS_STATUS
          ? {
              items: elchiStatus
                ? data.shipmentIds!.map((shipmentId) => ({
                    shipmentId,
                    status: elchiStatus,
                    marketPaidAmount: 0,
                    extraCost: 0,
                  }))
                : [],
              notFound: elchiStatus ? [] : data.shipmentIds!,
              failed: [],
            }
          : [
              {
                satoCode: '1726',
                name: 'Toshkent shahri',
                districts: [{ satoCode: '1726266', name: 'Yunusobod tumani' }],
              },
            ],
      ),
    emit: (pattern: string, event: Record<string, unknown>) => {
      if (queueDown) return throwError(() => new Error('navbat yo‘q'));
      emitted.push({ pattern, event });
      return of(undefined);
    },
  };
  const lead = {
    send: (pattern: { cmd: string }) =>
      of(
        pattern.cmd === 'lead.stream.codes'
          ? { '301': 'k7m2qa' }
          : { '7001': 'sub1=fb-reels-1' },
      ),
  };
  const names = new UserNamesClient({
    send: () =>
      of([
        { id: '7', name: 'Nodira K.' },
        { id: '41', name: 'Dilnoza R.' },
        { id: '42', name: 'Umida S.' },
        { id: '77', name: 'Jasur T.' },
        { id: '55', name: 'Otabek N.' },
      ]),
  } as never);
  const statuses = () =>
    new LeadOrderStatusService(
      db,
      new OutboxService(db.getRepository(OutboxEvent)),
      { send: () => of({}) } as never,
    );
  const service = () =>
    new AdminOrdersService(
      db,
      new SellerOrdersService(db),
      statuses(),
      new ElchiLeadWebhookService(
        db,
        new OutboxService(db.getRepository(OutboxEvent)),
        statuses(),
        { emit: () => of(undefined), send: () => of({}) } as never,
      ),
      integration as never,
      lead as never,
      names,
    );

  interface OrderOver {
    status?: string;
    buyerName?: string;
    confirmedBy?: string;
    leadId?: string;
    affiliateId?: string;
    regionSoato?: string;
    whereDeliver?: string;
    productId?: string;
    productName?: string;
    createdAt?: string;
    shipmentId?: string | null;
    elchiState?: string;
    source?: string | null;
    pickDate?: string | null;
  }
  const addOrder = async (over: OrderOver = {}): Promise<string> => {
    const leadId = over.leadId ?? String(8000 + ++seq);
    const legacy = over.source === null;
    const [order] = (await db.query(
      `INSERT INTO checkout.sales_order
         (customer_id, buyer_name, status, payment_method, total_amount, delivery_fee, delivery_address, where_deliver,
          source, lead_id, stream_id, affiliate_id, wholesaler_id, customer_phone, region_soato, district_soato,
          delivery_mode, delivery_shown, delivery_cost, delivery_embedded, weight_grams, cod_amount, confirmed_by,
          address_confirmed_by, created_at)
       VALUES ($1,$2,$3,'COD',292000,30000,'4-mavze, 12-uy',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id::text AS id`,
      [
        legacy ? '1' : null,
        over.buyerName ?? 'Aziza',
        over.status ?? 'CONFIRMED',
        over.whereDeliver ?? 'CENTER',
        legacy ? null : (over.source ?? 'LANDING'),
        legacy ? null : leadId,
        legacy ? null : '301',
        legacy ? null : (over.affiliateId ?? '77'),
        legacy ? null : '15',
        legacy ? null : PHONE,
        legacy ? null : (over.regionSoato ?? '1726'),
        legacy ? null : '1726266',
        legacy ? null : 'PARTIAL',
        legacy ? null : 30000,
        legacy ? null : 40000,
        legacy ? null : 10000,
        legacy ? null : 300,
        legacy ? null : 292000,
        legacy ? null : (over.confirmedBy ?? '41'),
        legacy ? null : (over.confirmedBy ?? '41'),
        over.createdAt ?? '2027-01-14T09:14:00Z',
      ],
    )) as Array<{ id: string }>;
    const [parcel] = (await db.query(
      `INSERT INTO checkout.parcel (sales_order_id, shop_id, subtotal, cod_amount, delivery_fee, elchi_shipment_id, elchi_state)
       VALUES ($1, 15, 262000, 292000, 30000, $2, $3) RETURNING id::text AS id`,
      [
        order.id,
        over.shipmentId === undefined
          ? String(880_000 + Number(order.id))
          : over.shipmentId,
        legacy ? null : (over.elchiState ?? 'CREATED'),
      ],
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO checkout.sales_order_item
         (sales_order_seller_id, product_id, product_name, variant_id, quantity, unit_price, line_total, sku, weight_grams,
          base_price, recommended_price, approved_price, markup, affiliate_fee, call_center_fee, hidden_delivery,
          platform_service, barcode)
       VALUES ($1,$2,$3,901,1,262000,262000,'SQ-501',300,140000,251000,251000,11000,65000,10000,11000,25000,'SQ-501')`,
      [
        parcel.id,
        over.productId ?? '501',
        over.productName ?? 'Simsiz quloqchinlar',
      ],
    );
    if (!legacy) {
      await addHistory(order.id, null, 'CONFIRMED', '2027-01-14T09:14:00Z');
      if (over.pickDate !== null)
        await db.query(
          `INSERT INTO checkout.fulfillment_task (order_id, parcel_id, pick_date, required_qty) VALUES ($1,$2,$3,1)`,
          [order.id, parcel.id, over.pickDate ?? '2027-01-15'],
        );
    }
    return order.id;
  };
  const addHistory = (
    orderId: string,
    from: string | null,
    to: string,
    at: string,
    actorId: string | null = null,
    reason: string | null = null,
    accepted = true,
  ) =>
    db.query(
      `INSERT INTO checkout.order_status_history (order_id, from_status, to_status, accepted, actor_type, actor_id, actor_role, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        orderId,
        from,
        to,
        accepted,
        actorId ? 'USER' : 'SYSTEM',
        actorId,
        actorId ? 'OPERATOR_LEAD' : null,
        reason,
        at,
      ],
    );
  const parcelState = async (orderId: string) =>
    (
      (await db.query(
        `SELECT elchi_state AS state, elchi_error AS error FROM checkout.parcel WHERE sales_order_id = $1`,
        [orderId],
      )) as Array<{ state: string; error: string | null }>
    )[0];
  const ids = (page: { items: Array<{ id: string }> }) =>
    page.items.map((i) => i.id);

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [
      CHECKOUT_SCHEMA_TEST_LOCK,
    ]);
    await lock.query('DROP SCHEMA IF EXISTS checkout CASCADE');
    await lock.query('CREATE SCHEMA checkout');
    db = await new DataSource({
      type: 'postgres',
      url,
      schema: 'checkout',
      entities: CHECKOUT_DB.entities as never,
      migrations: CHECKOUT_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
  }, 30_000);

  beforeEach(async () => {
    await db.query(
      `TRUNCATE checkout.label_reprint, checkout.order_dispute, checkout.elchi_webhook_event, checkout.fulfillment_task,
        checkout.handover_act_item, checkout.order_status_history, checkout.sales_order_item, checkout.parcel,
        checkout.handover_act, checkout.sales_order RESTART IDENTITY CASCADE`,
    );
    emitted.length = 0;
    elchiStatus = 'on the road';
    queueDown = false;
    seq = 0;
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (lock) {
      await lock.query('DROP SCHEMA IF EXISTS checkout CASCADE');
      await lock.end();
    }
  });

  it('BE-25 (FE-25): mahsulotning ochiq buyurtmalari (arxivlashni to‘sadi) — omborda va Elchi’da yakunlanmaganlar', async () => {
    for (const status of [
      'CONFIRMED',
      'PACKED',
      'IN_TRANSIT',
      'DELIVERED',
      'REFUSED',
      'REMITTED',
      'SETTLED',
      'CANCELLED',
      'RETURNED_GRADED',
    ])
      await addOrder({ status, productId: '501' });
    await addOrder({ status: 'CONFIRMED', productId: '502' });
    await addOrder({ status: 'SETTLED', productId: '503' });
    const service = new ProductOpenOrdersService(db);
    await expect(
      service.count(['501', '502', '503', '504', 'abc', null]),
    ).resolves.toEqual({ '501': 5, '502': 1 });
    await expect(service.count(undefined)).resolves.toEqual({});
  });

  it('migratsiyalar qaytariladi va qayta o‘tadi', async () => {
    await db.undoLastMigration(); // return_photo
    await db.undoLastMigration(); // order_dispute, label_reprint
    const tables = (await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'checkout' AND table_name IN ('order_dispute','label_reprint','return_photo')`,
    )) as unknown[];
    expect(tables).toEqual([]);
    await db.runMigrations();
  });

  it('filtrlar: qidiruv (buyurtma, lid, trek, ism; telefon emas), mahsulot, sotuvchi, viloyat, yetkazish, operator, Toshkent kuni', async () => {
    const a = await addOrder({ buyerName: 'Aziza 100%', leadId: '7001' });
    const b = await addOrder({
      buyerName: 'Bobur',
      productId: '502',
      affiliateId: '78',
      regionSoato: '1727',
      whereDeliver: 'ADDRESS',
      confirmedBy: '42',
      createdAt: '2027-01-13T18:59:00Z', // 13.01 23:59 Toshkent
    });
    const c = await addOrder({
      buyerName: 'Vali',
      createdAt: '2027-01-13T19:00:00Z', // 14.01 00:00 Toshkent
    });
    const list = (query: Record<string, unknown>) =>
      service()
        .list(query as never, ADMIN, NOW)
        .then(ids);
    expect(await list({ search: 'L-7001' })).toEqual([a]);
    expect(await list({ search: b })).toEqual([b]);
    expect(await list({ search: String(880_000 + Number(c)) })).toEqual([c]);
    expect(await list({ search: 'bob' })).toEqual([b]);
    expect(await list({ search: '100%' })).toEqual([a]);
    expect(await list({ search: '_' })).toEqual([]);
    expect(await list({ search: PHONE })).toEqual([]);
    expect(await list({ search: '901234567' })).toEqual([]);
    expect(await list({ productId: '502' })).toEqual([b]);
    expect(await list({ affiliateId: '78' })).toEqual([b]);
    expect(await list({ regionSoato: '1727' })).toEqual([b]);
    expect(await list({ whereDeliver: 'ADDRESS' })).toEqual([b]);
    expect(await list({ confirmedById: '42' })).toEqual([b]);
    expect(await list({ dateFrom: '2027-01-14' })).toEqual([a, c]);
    expect(
      await list({ dateFrom: '2027-01-13', dateTo: '2027-01-13' }),
    ).toEqual([b]);
  });

  it('sonlar holat filtrisiz; «holat o‘zgardi» bo‘yicha saralash; qator maydonlari', async () => {
    const a = await addOrder({ leadId: '7001' });
    const b = await addOrder({ status: 'CANCELLED' });
    await addHistory(
      b,
      'CONFIRMED',
      'CANCELLED',
      '2027-01-14T06:50:00Z',
      '41',
      'Mijoz fikridan qaytdi',
    );
    const c = await addOrder({ status: 'PICKING', pickDate: '2027-01-14' });
    await addHistory(c, 'CONFIRMED', 'PICKING', '2027-01-14T09:36:00Z', '55');
    const page = await service().list(
      { withCounts: true, sort: '-statusAt', status: undefined },
      ADMIN,
      NOW,
    );
    expect(page.counts).toEqual({
      ALL: 3,
      CONFIRMED: 1,
      CANCELLED: 1,
      PICKING: 1,
    });
    expect(ids(page)).toEqual([c, a, b]);
    expect(ids(await service().list({ sort: 'statusAt' }, ADMIN, NOW))).toEqual(
      [b, a, c],
    );
    expect(
      (
        await service().list(
          { withCounts: true, status: 'PICKING' },
          ADMIN,
          NOW,
        )
      ).counts,
    ).toMatchObject({ ALL: 3 });
    expect(
      (await service().list({}, ADMIN, NOW)) as Record<string, unknown>,
    ).not.toHaveProperty('counts');
    const row = (id: string) => page.items.find((i) => i.id === id)!;
    expect(row(a)).toMatchObject({
      leadId: '7001',
      regionName: 'Toshkent shahri',
      districtName: 'Yunusobod tumani',
      whereDeliver: 'CENTER',
      productId: '501',
      productName: 'Simsiz quloqchinlar',
      quantity: 1,
      linesCount: 1,
      streamCode: 'k7m2qa',
      affiliateName: 'Jasur T.',
      statusAt: '2027-01-14T09:14:00.000Z',
      statusDetail: 'ertangi to‘lqin',
      trackNumber: String(880_000 + Number(a)),
      elchiState: 'CREATED',
      phoneMasked: '****4567',
      confirmedBy: { name: 'Dilnoza R.', at: '2027-01-14T09:14:00.000Z' },
    });
    expect(row(b).statusDetail).toBe('Dilnoza R.');
    expect(row(c).statusDetail).toBe('Otabek N.');
    // narx tarkibi va telefon ro‘yxatda yo‘q
    expect(JSON.stringify(page)).not.toContain(PHONE);
    expect(JSON.stringify(page)).not.toContain('140000');
  });

  it('operator faqat o‘zi tasdiqlaganini ko‘radi; boshqa filtr bilan ham chetlab o‘tib bo‘lmaydi', async () => {
    const own = await addOrder();
    const other = await addOrder({ confirmedBy: '42' });
    const legacy = await addOrder({ source: null, status: 'CONFIRMED' });
    const page = await service().list(
      {
        confirmedById: '42',
        affiliateId: '78',
        shopId: '15',
        withCounts: true,
        source: 'SITE',
      } as never,
      OPERATOR,
      NOW,
    );
    expect(ids(page)).toEqual([own]);
    expect(page.counts).toEqual({ ALL: 1, CONFIRMED: 1 });
    expect(page.facets).toEqual({
      products: [{ id: '501', name: 'Simsiz quloqchinlar' }],
    });
    expect(page.items[0]).toMatchObject({
      affiliateId: null,
      affiliateName: null,
      streamCode: null,
      source: 'LANDING', // tur — sotuvchini oshkor qilmaydi (dizayn «Manba»)
      phoneMasked: '****4567',
    });
    const card = (await service().get(own, OPERATOR, NOW)) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(card)).not.toContain(PHONE);
    expect(JSON.stringify(card)).not.toContain('140000'); // optovik narxi
    expect(card).toMatchObject({
      phoneMasked: '****4567',
      stream: null,
      lead: {
        customerPhone: null,
        affiliateId: null,
        streamId: null,
        wholesalerId: null,
        deliveryCost: null,
      },
      sellerOrders: [{ shopId: null }], // posilka «do‘koni» — optovik
    });
    for (const id of [other, legacy, '999999', '9'.repeat(19), 'x'])
      await expect(service().get(id, OPERATOR, NOW)).rejects.toMatchObject({
        status: 404,
      });
    await expect(
      service().list({}, { kind: 'OPERATOR', userId: '' }, NOW),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('nazoratchi: to‘liq raqam va narx tarkibi yo‘q, eski do‘kon buyurtmalari yo‘q; admin — hammasi', async () => {
    const id = await addOrder();
    const legacy = await addOrder({ source: null, status: 'CONFIRMED' });
    expect(ids(await service().list({}, SUPERVISOR, NOW))).toEqual([id]);
    expect(ids(await service().list({}, ADMIN, NOW)).sort()).toEqual(
      [id, legacy].sort(),
    );
    const sup = await service().get(id, SUPERVISOR, NOW);
    expect(JSON.stringify(sup)).not.toContain(PHONE);
    expect(JSON.stringify(sup)).not.toContain('140000');
    await expect(service().get(legacy, SUPERVISOR, NOW)).rejects.toMatchObject({
      status: 404,
    });
    expect(await service().get(id, ADMIN, NOW)).toMatchObject({
      lead: { customerPhone: PHONE },
      sellerOrders: [{ items: [{ priceSnapshot: { basePrice: 140_000 } }] }],
    });
    expect(await service().get(legacy, ADMIN, NOW)).toMatchObject({
      id: legacy,
      lead: null,
    });
    // RPC ko‘ruvchisiz chaqirilsa — eng kam huquq
    const rpc = new AdminOrdersRpcController(service());
    await expect(rpc.get({ orderId: id })).rejects.toMatchObject({
      status: 404,
    });
    expect(() => rpc.list({})).rejects.toMatchObject({ status: 403 });
  });

  it('karta: holat tarixi ismlar bilan, yig‘ish, akt, Elchi xabarlari, bekor qilish', async () => {
    const id = await addOrder({ status: 'CANCELLED' });
    await addHistory(
      id,
      'CONFIRMED',
      'IN_TRANSIT',
      '2027-01-14T09:20:00Z',
      null,
      'Elchi webhook',
      false,
    );
    await addHistory(
      id,
      'CONFIRMED',
      'CANCELLED',
      '2027-01-14T09:30:00Z',
      '42',
      'Mijoz fikridan qaytdi',
    );
    const [act] = (await db.query(
      `INSERT INTO checkout.handover_act (parcel_count, created_by, created_at) VALUES (12, 55, '2027-01-14T09:16:00Z') RETURNING id::text AS id`,
    )) as Array<{ id: string }>;
    await db.query(
      `UPDATE checkout.parcel SET handover_act_id = $2 WHERE sales_order_id = $1`,
      [id, act.id],
    );
    const card = await service().get(id, ADMIN, NOW);
    expect(card).toMatchObject({
      statusAt: '2027-01-14T09:30:00.000Z',
      statusDetail: 'Umida S.',
      shipDate: '2027-01-15',
      customer: {
        regionName: 'Toshkent shahri',
        districtName: 'Yunusobod tumani',
        addressLine: '4-mavze, 12-uy',
        addressConfirmedBy: { name: 'Dilnoza R.', at: null },
      },
      stream: {
        code: 'k7m2qa',
        affiliateName: 'Jasur T.',
        affiliateId: '77',
      },
      confirmedByActor: { name: 'Dilnoza R.' },
      parcel: {
        state: 'CREATED',
        act: {
          code: `T-${act.id.padStart(4, '0')}`,
          at: '2027-01-14T09:16:00.000Z',
          count: 12,
        },
        label: null,
      },
      picking: {
        wave: '2027-01-15',
        scanned: 0,
        total: 1,
        barcode: 'SQ-501',
        releasedAt: '2027-01-14T09:30:00.000Z',
      },
      cancel: {
        by: 'Umida S.',
        byRole: 'OPERATOR_LEAD',
        reason: 'Mijoz fikridan qaytdi',
      },
      returnRequest: null,
      dispute: null,
    });
    const history = (
      card.lead as unknown as {
        statusHistory: Array<{ actorName: string; accepted: boolean }>;
      }
    ).statusHistory;
    expect(history.map((h) => [h.actorName, h.accepted])).toEqual([
      ['Tizim', true],
      ['Tizim', false],
      ['Umida S.', true],
    ]);
  });

  it('yig‘ish boshlangan (skaner tugamagan): kim va qachondan; qaytarish sababi — izoh matni', async () => {
    const id = await addOrder({ status: 'PICKING' });
    await addHistory(id, 'CONFIRMED', 'PICKING', '2027-01-14T09:36:00Z', '55');
    await db.query(
      `INSERT INTO checkout.return_request (sales_order_id, sales_order_seller_id, shop_id, customer_id, status, reason, comment, requested_amount, source, created_by)
       SELECT $1, p.id, p.shop_id, NULL, 'SUBMITTED', 'OTHER', 'Rangi boshqa keldi', 0, 'STAFF', 7
         FROM checkout.parcel p WHERE p.sales_order_id = $1`,
      [id],
    );
    expect(await service().get(id, ADMIN, NOW)).toMatchObject({
      statusDetail: 'Otabek N.',
      picking: { by: 'Otabek N.', from: '2027-01-14T09:36:00.000Z', to: null },
      returnRequest: {
        by: 'Nodira K.',
        reason: 'Rangi boshqa keldi',
        status: 'SUBMITTED',
        photos: [],
      },
    });
    // mijoz rasmi faqat admin kartasida
    const supervisor = await service().get(
      id,
      { kind: 'SUPERVISOR', userId: '61' },
      NOW,
    );
    expect(supervisor).toHaveProperty('returnRequest.status', 'SUBMITTED');
    expect(supervisor).not.toHaveProperty('returnRequest.photos');
  });

  it('qisqacha (lid kartasi uchun) tashqi nomlarsiz', async () => {
    const id = await addOrder();
    expect(await service().brief(id)).toEqual({
      id,
      status: 'CONFIRMED',
      createdAt: '2027-01-14T09:14:00.000Z',
      totalAmount: 292000,
    });
    await expect(service().brief('999999')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('ro‘yxat indekslardan foydalanadi: posilka va tovar qatori buyurtma bo‘yicha', async () => {
    for (let i = 0; i < 3; i++) await addOrder();
    await db.query('SET enable_seqscan = off');
    try {
      for (const [sql, index] of [
        [
          `SELECT 1 FROM checkout.parcel WHERE sales_order_id = 1`,
          'idx_checkout_parcel_order',
        ],
        [
          `SELECT 1 FROM checkout.sales_order_item WHERE sales_order_seller_id = 1`,
          'idx_checkout_sales_order_item_parcel',
        ],
        [
          `SELECT 1 FROM checkout.sales_order WHERE confirmed_by = 41 ORDER BY created_at DESC LIMIT 20`,
          'idx_checkout_sales_order_confirmed_by',
        ],
      ]) {
        const plan = (await db.query(`EXPLAIN ${sql}`)) as Array<
          Record<string, string>
        >;
        expect(JSON.stringify(plan)).toContain(index);
      }
    } finally {
      await db.query('SET enable_seqscan = on');
    }
  });

  it('nizo: bitta ochiq, yozuv 1 yil; yopilgach qayta ochiladi; operatorga ko‘rinmaydi', async () => {
    const id = await addOrder();
    expect(
      await service().openDisputeFor(id, '7', ' Mijoz olmadim deydi ', NOW),
    ).toEqual({
      at: NOW.toISOString(),
      by: 'Nodira K.',
      reason: 'Mijoz olmadim deydi',
      keepUntil: '2028-01-14T09:38:00.000Z',
    });
    await expect(
      service().openDisputeFor(id, '7', 'yana', NOW),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: ErrorCode.INVALID_STATE },
    });
    expect(await service().get(id, ADMIN, NOW)).toMatchObject({
      dispute: { by: 'Nodira K.', keepUntil: '2028-01-14T09:38:00.000Z' },
    });
    expect(await service().get(id, OPERATOR, NOW)).toMatchObject({
      dispute: null,
    });
    // bir vaqtda ikki yopish — bittasi o‘tadi
    const closed = await Promise.allSettled([
      service().closeDispute(id, '7', 'Kelishildi', NOW),
      service().closeDispute(id, '7', null, NOW),
    ]);
    expect(closed.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(await service().get(id, ADMIN, NOW)).toMatchObject({
      dispute: null,
    });
    await expect(
      service().openDisputeFor(id, '7', 'qayta', NOW),
    ).resolves.toMatchObject({ reason: 'qayta' });
    await expect(
      service().openDisputeFor('999999', '7', 'x', NOW),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service().openDisputeFor(id, '7', '  ', NOW),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('yorliqni qayta chop etish: sabab bilan sanaladi, kartada oxirgisi', async () => {
    const id = await addOrder();
    await service().logReprint(id, '7', 'Yirtilgan');
    expect(await service().logReprint(id, '55', 'Yopishmadi')).toMatchObject({
      by: 'Otabek N.',
      count: 2,
    });
    expect(await service().get(id, ADMIN, NOW)).toMatchObject({
      parcel: { label: { by: 'Otabek N.', count: 2 } },
    });
    await expect(
      service().logReprint('999999', '7', 'x'),
    ).rejects.toMatchObject({ status: 404 });
  });

  describe('Elchi’ga qayta yuborish', () => {
    it('rad etilgan so‘rov: faqat Elchi navbatiga «Tasdiqlandi», yangi hodisa raqami bilan; outbox ga yozilmaydi', async () => {
      const id = await addOrder({
        status: 'PICKING',
        shipmentId: null,
        elchiState: 'FAILED',
      });
      await db.query(
        `UPDATE checkout.parcel SET elchi_error = 'REJECTED: manzil' WHERE sales_order_id = $1`,
        [id],
      );
      expect(await service().resendToElchi(id)).toEqual({
        orderId: id,
        elchiState: 'PENDING',
      });
      expect(await parcelState(id)).toEqual({ state: 'PENDING', error: null });
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        pattern: ORDER_EVENTS.STATUS_CHANGED,
        event: {
          orderId: id,
          status: LeadOrderStatus.CONFIRMED,
          recipient: { phone: PHONE, regionSoato: '1726' },
        },
      });
      const [{ n }] = (await db.query(
        `SELECT count(*)::int AS n FROM checkout.outbox_event`,
      )) as Array<{ n: number }>;
      expect(n).toBe(0);
      // ikkinchi marta — endi FAILED emas
      await expect(service().resendToElchi(id)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('yaratilgan, kutilayotgan yoki topshirilgan buyurtma — 409; navbat yo‘q — 503 va holat o‘zgarmaydi', async () => {
      const created = await addOrder();
      const handed = await addOrder({
        status: 'HANDED_TO_ELCHI',
        elchiState: 'FAILED',
      });
      const cancelled = await addOrder({
        status: 'CANCELLED',
        elchiState: 'FAILED',
      });
      for (const id of [created, handed, cancelled])
        await expect(service().resendToElchi(id)).rejects.toMatchObject({
          status: 409,
        });
      const failed = await addOrder({ shipmentId: null, elchiState: 'FAILED' });
      queueDown = true;
      await expect(service().resendToElchi(failed)).rejects.toMatchObject({
        status: 503,
      });
      expect((await parcelState(failed)).state).toBe('FAILED');
      await expect(service().resendToElchi('999999')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('bir vaqtda ikki bosish — bitta yuboriladi', async () => {
      const id = await addOrder({ shipmentId: null, elchiState: 'FAILED' });
      const results = await Promise.allSettled([
        service().resendToElchi(id),
        service().resendToElchi(id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(emitted).toHaveLength(1);
    });
  });

  describe('Elchi’dan holatni so‘rash', () => {
    const inTransit = async () => {
      const id = await addOrder({ status: 'HANDED_TO_ELCHI' });
      await addHistory(id, 'PACKED', 'HANDED_TO_ELCHI', '2027-01-14T09:20:00Z');
      return id;
    };

    it('faqat oldinga qo‘llanadi; takror so‘rov — o‘zgarishsiz; jurnalda bitta hodisa', async () => {
      const id = await inTransit();
      expect(await service().refreshFromElchi(id, NOW)).toMatchObject({
        elchiStatus: 'on the road',
        status: LeadOrderStatus.IN_TRANSIT,
        applied: true,
        detail: null,
      });
      expect(await service().refreshFromElchi(id, NOW)).toMatchObject({
        status: LeadOrderStatus.IN_TRANSIT,
        applied: false,
        detail: 'Holat o‘zgarmagan',
      });
      // admin so‘rovi webhook emas: «48 soat xabar yo‘q» ogohlantirishi o‘chib qolmaydi
      expect(await service().get(id, ADMIN, NOW)).toMatchObject({
        parcel: { lastWebhookAt: null },
        elchiEvents: [{ title: 'on_the_road', state: 'ACCEPTED' }],
      });
      const [{ n }] = (await db.query(
        `SELECT count(*)::int AS n FROM checkout.elchi_webhook_event WHERE order_id = $1`,
        [id],
      )) as Array<{ n: number }>;
      expect(n).toBe(1);
      elchiStatus = 'sold';
      expect(await service().refreshFromElchi(id, NOW)).toMatchObject({
        status: LeadOrderStatus.DELIVERED,
        applied: true,
      });
      // yetkazilgan — endi so‘ralmaydi
      await expect(service().refreshFromElchi(id, NOW)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('pul holati va noma’lum holat qo‘llanmaydi; posilka Elchi’da bo‘lmasa 409', async () => {
      const id = await inTransit();
      for (const value of ['paid', 'partly_paid', 'nimadir']) {
        elchiStatus = value;
        expect(await service().refreshFromElchi(id, NOW)).toMatchObject({
          elchiStatus: value,
          status: LeadOrderStatus.HANDED_TO_ELCHI,
          applied: false,
        });
      }
      elchiStatus = '';
      expect(await service().refreshFromElchi(id, NOW)).toMatchObject({
        elchiStatus: null,
        status: LeadOrderStatus.HANDED_TO_ELCHI,
        applied: false,
        detail: 'Elchi bu posilkani topmadi',
      });
      const packed = await addOrder({ status: 'PACKED' });
      await expect(
        service().refreshFromElchi(packed, NOW),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service().refreshFromElchi('999999', NOW),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('CSV: lid-service javob bermasa fayl bo‘sh ustun bilan chiqmaydi — xato', async () => {
    await addOrder();
    const broken = new AdminOrdersService(
      db,
      new SellerOrdersService(db),
      statuses(),
      {} as never,
      integration as never,
      { send: () => throwError(() => new Error('lid yo‘q')) } as never,
      names,
    );
    const input = {
      filters: {} as never,
      until: NOW.toISOString(),
      afterId: null,
    };
    for (const column of [OrderExportColumn.STREAM, OrderExportColumn.SUBS])
      await expect(
        broken.exportChunk({ ...input, columns: [column] }),
      ).rejects.toThrow('lid yo‘q');
    await expect(
      broken.exportChunk({ ...input, columns: [OrderExportColumn.ORDER] }),
    ).resolves.toMatchObject({ nextAfterId: null });
    // ro‘yxatda esa — bo‘sh nom bilan ochiladi
    expect((await broken.list({}, ADMIN, NOW)).items[0].streamCode).toBeNull();
  });

  it('CSV: ro‘yxat filtri (`from`/`to`), so‘ralgan vaqtdan keyingisi kirmaydi, telefon oxirgi 4, narx nusxasi, sub, formula himoyasi', async () => {
    const a = await addOrder({ leadId: '7001', buyerName: '=1+1' });
    await addOrder({ createdAt: '2027-01-14T10:00:00Z' }); // keyin
    const old = await addOrder({ createdAt: '2027-01-10T10:00:00Z' });
    const until = NOW.toISOString();
    const filters = { from: '2027-01-14', to: '2027-01-14', sort: '-statusAt' };
    expect(await service().exportCount(filters as never, NOW)).toEqual({
      rows: 1,
    });
    const columns = Object.values(OrderExportColumn);
    const chunk = await service().exportChunk({
      filters: filters as never,
      columns,
      until,
      afterId: null,
    });
    expect(chunk.nextAfterId).toBeNull();
    expect(chunk.lines[0].split(';')).toHaveLength(21);
    expect(chunk.lines.slice(1)).toEqual([
      `L-${a};7001;14.01.2027 14:14;'=1+1;Toshkent shahri;****4567;k7m2qa;LANDING;292000;30000;Tasdiqlandi;${880_000 + Number(a)};140000;251000;251000;11000;65000;10000;11000;25000;sub1=fb-reels-1`,
    ]);
    const all = await service().exportChunk({
      filters: {} as never,
      columns: [OrderExportColumn.ORDER],
      until,
      afterId: null,
    });
    expect(all.lines.slice(1).map((l) => l.split(';')[0])).toEqual([
      `L-${old}`,
      `L-${a}`,
    ]);
    expect(
      (
        await service().exportChunk({
          filters: {} as never,
          columns: [OrderExportColumn.ORDER],
          until,
          afterId: old,
        })
      ).lines.map((l) => l.split(';')[0]),
    ).toEqual([`L-${a}`]);
  });
});
