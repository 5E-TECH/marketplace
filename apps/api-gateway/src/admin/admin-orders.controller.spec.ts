import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import {
  AdminOrdersQueryDto,
  OperatorOrdersQueryDto,
  OrderExportRequestDto,
  OrderReasonDto,
  Role,
  ROLES_KEY,
} from '@app/common';
import { ExportLinkService } from '../exports/export-link.service';
import { addressEdit } from '../orders/order-view';
import { AdminOrdersController } from './admin-orders.controller';

const down = () => throwError(() => new Error('javob yo‘q'));
const exportsService = () =>
  new ExportLinkService(new ConfigService({ JWT_SECRET: 'test-secret' }));

function makeController(
  send: jest.Mock,
  identity: jest.Mock = jest.fn(() => of({})),
  lead: unknown = down,
) {
  return new AdminOrdersController(
    { send } as never,
    { send: identity } as never,
    { send: lead } as never,
    exportsService(),
  );
}
const user = (role: Role, sub = '7') => ({ sub, role }) as never;
const errorsIn = async (cls: new () => object, body: unknown) =>
  (
    await validate(plainToInstance(cls, body) as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((e) => e.property);

describe('AdminOrdersController (C1.30/C6.4)', () => {
  it('TC4: list/get — ADMIN, SUPERADMIN va nazoratchi (BE-18 TC12); yorliq — faqat ADMIN/SUPERADMIN', () => {
    for (const m of ['list', 'get'] as const)
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype[m]),
      ).toEqual([Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN]);
    for (const m of ['label', 'sellerOrderLabel', 'labelsBatch'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype[m]),
      ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    }
  });

  it('C1.45 TC4/TC5: admin bitta va batch yorliqni checkoutdan oladi', async () => {
    const send = jest.fn(() =>
      of({
        fileName: 'shipments.pdf',
        contentType: 'application/pdf',
        base64: 'JVBERg==',
      }),
    );
    const ctrl = makeController(send);
    const res = { setHeader: jest.fn() };

    await ctrl.label('9', res as never);
    await ctrl.labelsBatch({ orderIds: ['9', '10'] }, res as never);
    await ctrl.sellerOrderLabel('14', '15', res as never);

    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'checkout.admin.order-label' },
      { orderId: '9' },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'checkout.admin.order-labels' },
      { orderIds: ['9', '10'] },
    );
    // Bitta posilka: buyurtma id'si ham uzatiladi — posilka shu buyurtmaga
    // tegishliligi checkoutda tekshiriladi (id fazolari aralashmasin).
    expect(send).toHaveBeenNthCalledWith(
      3,
      { cmd: 'checkout.admin.seller-order-label' },
      { orderId: '14', sellerOrderId: '15' },
    );
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('C1.45: partiyada chiqmagan yorliqlar X-Labels-Skipped headerida', async () => {
    const skipped = [
      { orderId: '7', reason: 'Elchi shipment QR tokeni mavjud emas' },
    ];
    const send = jest.fn(() =>
      of({
        fileName: 'shipments-1.pdf',
        contentType: 'application/pdf',
        base64: 'JVBERg==',
        skipped,
      }),
    );
    const res = { setHeader: jest.fn() };

    await makeController(send).labelsBatch(
      { orderIds: ['9', '7'] },
      res as never,
    );

    const [name, value] = res.setHeader.mock.calls[0];
    expect(name).toBe('X-Labels-Skipped');
    // Header faqat ASCII bo'lishi shart — sabablar esa o'zbekcha.
    expect(value).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(decodeURIComponent(value))).toEqual(skipped);
  });

  it('C1.45: token backfill faqat SUPERADMIN, dryRun audit yozmaydi', async () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminOrdersController.prototype.syncShipmentTokens,
      ),
    ).toEqual([Role.SUPERADMIN]);
    const checkoutSend = jest.fn(() => of({ items: [], nextAfterId: null }));
    const identitySend = jest.fn(() => of({}));
    const controller = makeController(checkoutSend, identitySend);
    const admin = { sub: '1', role: Role.SUPERADMIN } as never;

    await controller.syncShipmentTokens({ dryRun: true }, admin, '127.0.0.1');
    expect(identitySend).not.toHaveBeenCalled();

    await controller.syncShipmentTokens({ afterId: '6' }, admin, '127.0.0.1');
    expect(checkoutSend).toHaveBeenLastCalledWith(
      { cmd: 'checkout.admin.shipment-tokens-sync' },
      { afterId: '6' },
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'order.shipment-tokens-sync' }),
    );
  });

  it('C6.4: cancel ADMIN/SUPERADMIN (BE-18: nazoratchi ham), refund faqat SUPERADMIN', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype.cancel),
    ).toEqual([Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype.refund),
    ).toEqual([Role.SUPERADMIN]);
  });

  it('C6.4: refund checkoutga uzatiladi va audit yoziladi', async () => {
    const checkoutSend = jest.fn(() => of({ id: '12', status: 'REFUNDED' }));
    const identitySend = jest.fn(() => of({ id: 'audit-1' }));
    const controller = makeController(checkoutSend, identitySend);

    await expect(
      controller.refund(
        '12',
        { reason: 'Tovar yo‘q' },
        { sub: '1', role: Role.SUPERADMIN } as never,
        '127.0.0.1',
      ),
    ).resolves.toMatchObject({ status: 'REFUNDED' });
    expect(checkoutSend).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.order-refund' },
      expect.objectContaining({ orderId: '12', actorId: '1' }),
    );
    expect(identitySend).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'order.refund', entityId: '12' }),
    );
  });

  it('TC2: list -> checkout.admin.orders-list ga query uzatiladi', async () => {
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const ctrl = makeController(send);
    const query = { status: 'CONFIRMED', shopId: '15', page: 1, limit: 20 };
    await ctrl.list(query as never, user(Role.SUPERADMIN));
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'checkout.admin.orders-list' },
      { query, viewer: { kind: 'ADMIN', userId: '7' } },
    );
    await ctrl.list(query as never, user(Role.SUPERVISOR));
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'checkout.admin.orders-list' },
      { query, viewer: { kind: 'SUPERVISOR', userId: '7' } },
    );
  });

  it('TC3: get -> checkout.admin.order-get ga orderId', async () => {
    const send = jest.fn(() => of({ id: '12' }));
    const ctrl = makeController(send);
    await ctrl.get('12', user(Role.SUPERVISOR));
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.admin.order-get' },
      { orderId: '12', viewer: { kind: 'SUPERVISOR', userId: '7' } },
    );
  });

  describe('BE-25 (FE-26)', () => {
    const order = {
      id: '1042',
      lead: { leadId: '7001', whereDeliver: 'ADDRESS' },
      customer: {
        regionName: 'Toshkent shahri',
        districtName: 'Yunusobod tumani',
        addressLine: '4-mavze, 12-uy',
        addressConfirmedBy: { name: 'Dilnoza R.', at: null },
      },
      stream: { code: 'k7m2qa' },
    };
    const card = {
      createdAt: '2026-12-01T09:02:00.000Z',
      consentAt: '2026-12-01T09:02:00.000Z',
      address: { confirmedAt: '2026-12-01T09:12:30.000Z' },
      stream: { sub1: 'fb-reels-1' },
      postbacks: [{ event: 'lead' }],
      history: [
        { at: '2026-12-01T09:02:00.000Z', actor: 'Tizim', changes: null },
        {
          at: '2026-12-01T09:10:00.000Z',
          actor: 'Umida S.',
          changes: [{ field: 'addressLine', from: '4-mavze', to: '4-mavze 2' }],
        },
        {
          at: '2026-12-01T09:12:00.000Z',
          actor: 'Dilnoza R.',
          changes: [
            { field: 'addressLine', from: '4-mavze 2', to: '4-mavze, 12-uy' },
            { field: 'district', from: 'Chilonzor', to: 'Yunusobod tumani' },
          ],
        },
        { at: '2026-12-01T09:12:30.000Z', actor: 'Dilnoza R.', changes: [] },
      ],
    };

    it('karta: mijoz yozgan manzil (birinchi qiymat), tuzatgan odam, sub, rozilik; nazoratchiga postback yo‘q', async () => {
      const lead = jest.fn(() => of(card));
      const ctrl = makeController(
        jest.fn(() => of(order)),
        undefined,
        lead,
      );
      expect(await ctrl.get('1042', user(Role.ADMIN))).toMatchObject({
        customer: {
          consentAt: '2026-12-01T09:02:00.000Z',
          original: {
            regionName: 'Toshkent shahri',
            districtName: 'Chilonzor',
            addressLine: '4-mavze',
            whereDeliver: 'ADDRESS',
          },
          addressEditedBy: {
            name: 'Dilnoza R.',
            at: '2026-12-01T09:12:00.000Z',
          },
          addressConfirmedBy: {
            name: 'Dilnoza R.',
            at: '2026-12-01T09:12:30.000Z',
          },
        },
        stream: { code: 'k7m2qa', sub1: 'fb-reels-1' },
        postbacks: [{ event: 'lead' }],
      });
      expect(lead).toHaveBeenLastCalledWith(
        { cmd: 'lead.admin.card' },
        { leadId: '7001', viewer: { admin: true } },
      );
      const sup = await ctrl.get('1042', user(Role.SUPERVISOR));
      expect(sup.postbacks).toEqual([]);
      expect(lead).toHaveBeenLastCalledWith(
        { cmd: 'lead.admin.card' },
        { leadId: '7001', viewer: { admin: false } },
      );
      expect(addressEdit(card.history.slice(0, 1) as never)).toBeNull();
      // mijoz yozmagan maydon operatorniki bilan to‘ldirilmaydi
      const blank = await makeController(
        jest.fn(() => of(order)),
        undefined,
        () =>
          of({
            ...card,
            history: [
              {
                at: '2026-12-01T09:12:00.000Z',
                actor: 'Dilnoza R.',
                changes: [
                  { field: 'district', from: null, to: 'Yunusobod tumani' },
                ],
              },
            ],
          }),
      ).get('1042', user(Role.ADMIN));
      expect(blank.customer).toMatchObject({
        original: { districtName: null, regionName: 'Toshkent shahri' },
      });
    });

    it('lid-service javob bermasa karta baribir ochiladi', async () => {
      const ctrl = makeController(jest.fn(() => of(order)));
      expect(await ctrl.get('1042', user(Role.ADMIN))).toEqual(order);
    });

    it('amallar faqat adminga; checkout ga kim va sabab, auditga yoziladi', async () => {
      for (const m of [
        'export',
        'exportFile',
        'reprint',
        'dispute',
        'closeDispute',
        'resend',
        'refreshElchi',
      ] as const)
        expect(
          Reflect.getMetadata(ROLES_KEY, AdminOrdersController.prototype[m]),
        ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
      const send = jest.fn(() => of({ elchiStatus: 'sold', applied: true }));
      const identity = jest.fn(() => of({}));
      const ctrl = makeController(send, identity);
      const admin = user(Role.ADMIN);
      await ctrl.reprint('1042', { reason: 'Yirtilgan' }, admin, '::1');
      expect(send).toHaveBeenLastCalledWith(
        { cmd: 'checkout.admin.order-label-reprint' },
        { orderId: '1042', actorId: '7', reason: 'Yirtilgan' },
      );
      await ctrl.dispute('1042', { reason: 'Kelmadi' }, admin, '::1');
      await ctrl.closeDispute('1042', {}, admin, '::1');
      await ctrl.resend('1042', admin, '::1');
      await ctrl.refreshElchi('1042', admin, '::1');
      expect(
        identity.mock.calls.map(
          (call) => (call as unknown[])[1] as { action: string },
        ),
      ).toEqual(
        [
          'order.label.reprint',
          'order.dispute.open',
          'order.dispute.close',
          'order.elchi.resend',
          'order.elchi.refresh',
        ].map((action) =>
          expect.objectContaining({ action, actorId: '7', entityId: '1042' }),
        ),
      );
      expect(await errorsIn(OrderReasonDto, { reason: ' ' })).toEqual([
        'reason',
      ]);
    });

    it('CSV: audit yozilmasa havola yo‘q; FULL — 403; chipta lidlar eksportida ishlamaydi va boshqa adminga yopiq', async () => {
      const dto = { filters: { status: 'CONFIRMED' }, columns: ['order'] };
      const send = jest.fn((pattern: { cmd: string }) =>
        of(
          pattern.cmd.endsWith('count')
            ? { rows: 1 }
            : { lines: ['Buyurtma', 'L-1'], nextAfterId: null },
        ),
      );
      const ctrl = makeController(send as never);
      const admin = user(Role.ADMIN);
      const accepted = await ctrl.export(dto as never, admin, '');
      expect(accepted.file).toBe(`/api/v1/admin/orders/exports/${accepted.id}`);
      const file = await ctrl.exportFile(accepted.id, admin);
      const parts: Buffer[] = [];
      for await (const part of file.getStream()) parts.push(Buffer.from(part));
      expect(Buffer.concat(parts).toString('utf8')).toBe(
        '\uFEFFBuyurtma\r\nL-1\r\n',
      );
      await expect(
        ctrl.exportFile(accepted.id, user(Role.ADMIN, '8')),
      ).rejects.toMatchObject({ status: 404 });
      expect(exportsService().verify(accepted.id, 'leads', '7')).toBeNull();
      await expect(
        ctrl.export({ ...dto, phone: 'FULL' } as never, admin, ''),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        makeController(send as never, jest.fn(down) as never).export(
          dto as never,
          admin,
          '',
        ),
      ).rejects.toMatchObject({ status: 503 });
    });

    it('filtrlar: frontend yuboradigan so‘rov o‘tadi, noto‘g‘risi 400; operator boshqa operator filtrini bera olmaydi', async () => {
      expect(
        await errorsIn(AdminOrdersQueryDto, {
          search: 'L-1276',
          productId: '501',
          affiliateId: '77',
          regionSoato: '1726',
          whereDeliver: 'CENTER',
          confirmedById: '41',
          withCounts: 'true',
          sort: '-statusAt',
          dateFrom: '2026-12-01',
          dateTo: '2026-12-31',
          page: '1',
          limit: '1',
        }),
      ).toEqual([]);
      expect(
        (
          plainToInstance(AdminOrdersQueryDto, {
            withCounts: 'false',
          }) as AdminOrdersQueryDto
        ).withCounts,
      ).toBe(false);
      for (const body of [
        { regionSoato: "1' OR 1=1" },
        { whereDeliver: 'X' },
        { withCounts: 'ha' },
        { sort: 'phone' },
        { dateFrom: '2026' },
        { dateTo: '2026-02-30' },
        { phone: '1' },
      ])
        expect(await errorsIn(AdminOrdersQueryDto, body)).toEqual(
          Object.keys(body),
        );
      expect(
        await errorsIn(OperatorOrdersQueryDto, { confirmedById: '41' }),
      ).toEqual(['confirmedById']);
      expect(
        await errorsIn(OperatorOrdersQueryDto, {
          status: 'CONFIRMED',
          sort: 'statusAt',
          withCounts: 'true',
        }),
      ).toEqual([]);
      // AdminOrdersPage `csvFilters`: ro‘yxat so‘rovi `from`/`to` va `sort` bilan
      expect(
        await errorsIn(OrderExportRequestDto, {
          filters: {
            status: 'CONFIRMED',
            from: '2026-12-01',
            to: '2026-12-31',
            sort: '-statusAt',
            search: 'Aziza',
          },
          columns: ['order', 'priceSnapshot', 'subs'],
          phone: 'LAST4',
        }),
      ).toEqual([]);
      for (const filters of [[], [{ status: 'CONFIRMED' }], { page: 1 }])
        expect(
          await errorsIn(OrderExportRequestDto, {
            filters,
            columns: ['order'],
          }),
        ).toEqual(['filters']);
    });
  });
});
