import { of } from 'rxjs';
import { SellerOrdersService } from './seller-orders.service';

describe('SellerOrdersService.adminStats (C1.28)', () => {
  const prevRate = process.env.PLATFORM_COMMISSION_RATE;
  afterEach(() => {
    if (prevRate === undefined) delete process.env.PLATFORM_COMMISSION_RATE;
    else process.env.PLATFORM_COMMISSION_RATE = prevRate;
  });

  it('TC4: GMV = tasdiqlangan buyurtmalar summasi + sanoqlar', async () => {
    delete process.env.PLATFORM_COMMISSION_RATE;
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { ordersTotal: '5', ordersToday: '2', gmv: '54000000' },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.adminStats()).resolves.toEqual({
      ordersTotal: 5,
      ordersToday: 2,
      gmv: 54000000,
      revenue: 0,
    });
    // GMV faqat tasdiqlangan (CONFIRMED+) statuslardan olinadi
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "status IN ('CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED')",
      ),
    );
    // "bugun" — Asia/Tashkent kuni bo'yicha (bitta AT TIME ZONE)
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("AT TIME ZONE 'Asia/Tashkent'"),
    );
  });

  it('daromad = GMV × PLATFORM_COMMISSION_RATE', async () => {
    process.env.PLATFORM_COMMISSION_RATE = '0.05';
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { ordersTotal: '1', ordersToday: '0', gmv: '1000000' },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.adminStats()).resolves.toMatchObject({
      gmv: 1000000,
      revenue: 50000,
    });
  });

  it('C6.2: daromadni joriy platforma komissiyasi bilan hisoblaydi', async () => {
    process.env.PLATFORM_COMMISSION_RATE = '0.99';
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { ordersTotal: '1', ordersToday: '0', gmv: '1000000' },
        ]),
    };
    const identity = {
      send: jest.fn(() => of({ commissionPercent: 7.5 })),
    };
    const service = new SellerOrdersService(
      dataSource as never,
      undefined,
      identity as never,
    );

    await expect(service.adminStats()).resolves.toMatchObject({
      gmv: 1000000,
      revenue: 75000,
    });
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.settings.get' },
      {},
    );
  });

  it('TC3: yangi platforma -> adminStats hammasi 0', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { ordersTotal: '0', ordersToday: '0', gmv: '0' },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.adminStats()).resolves.toEqual({
      ordersTotal: 0,
      ordersToday: 0,
      gmv: 0,
      revenue: 0,
    });
  });
});

describe('SellerOrdersService admin orders (C1.30)', () => {
  it('TC1/TC2: barcha buyurtma + status/do‘kon filtri (SQL shartlari + params)', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ total: 2 }])
        .mockResolvedValueOnce([
          {
            id: '12',
            buyerName: 'Ali',
            status: 'CONFIRMED',
            paymentMethod: 'cod',
            totalAmount: '450000',
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            sellersCount: '2',
          },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    const res = await service.adminListOrders({
      status: 'CONFIRMED',
      shopId: '15',
      page: 1,
      limit: 20,
    });

    expect(res.total).toBe(2);
    expect(res.items[0]).toMatchObject({
      id: '12',
      totalAmount: 450000,
      sellersCount: 2,
    });
    // count query: status + do'kon EXISTS shartlari + params
    const [countSql, countParams] = dataSource.query.mock.calls[0];
    expect(countSql).toContain('so.status = $1');
    expect(countSql).toContain('sales_order_seller x');
    expect(countParams).toEqual(['CONFIRMED', '15']);
    // list query: limit/offset params oxirida
    expect(dataSource.query.mock.calls[1][1]).toEqual([
      'CONFIRMED',
      '15',
      20,
      0,
    ]);
  });

  it('TC3: adminGetOrder order + sub-order + item + shipment jamlaydi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: '12',
            buyerName: 'Ali',
            customerId: '9',
            status: 'CONFIRMED',
            paymentMethod: 'cod',
            totalAmount: '450000',
            deliveryAddress: 'Toshkent',
            createdAt: 'd1',
            updatedAt: 'd2',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: '31',
            shopId: '15',
            subtotal: '450000',
            codAmount: '450000',
            status: 'ON_THE_ROAD',
            elchiShipmentId: '987',
            trackingUrl: 'https://elchi.uz/track/987',
          },
        ])
        .mockResolvedValueOnce([
          {
            sellerOrderId: '31',
            productId: '88',
            productName: 'Telefon',
            variantId: '5',
            quantity: '2',
            unitPrice: '225000',
            lineTotal: '450000',
          },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    const res: any = await service.adminGetOrder('12');

    expect(res).toMatchObject({ id: '12', paymentMethod: 'cod' });
    expect(res.sellerOrders).toHaveLength(1);
    expect(res.sellerOrders[0]).toMatchObject({
      shopId: '15',
      elchiShipmentId: '987',
      trackingUrl: 'https://elchi.uz/track/987',
    });
    expect(res.sellerOrders[0].items[0]).toMatchObject({
      productName: 'Telefon',
      quantity: 2,
      lineTotal: 450000,
    });
  });

  it('adminGetOrder — topilmasa 404', async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([]) };
    const service = new SellerOrdersService(dataSource as never);
    await expect(service.adminGetOrder('999')).rejects.toThrow();
  });
});
