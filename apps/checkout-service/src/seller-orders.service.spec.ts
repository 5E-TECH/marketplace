import { SalesOrderSellerStatus } from '@app/common';
import { of } from 'rxjs';
import { SellerOrdersService } from './seller-orders.service';

describe('SellerOrdersService', () => {
  it('TC1: faqat berilgan shop buyurtmalarini pagination bilan qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            id: '31',
            salesOrderId: '12',
            buyerName: 'Ali',
            subtotal: '450000.00',
            codAmount: '450000.00',
            status: SalesOrderSellerStatus.ON_THE_ROAD,
            elchiShipmentId: '987',
            trackingUrl: 'https://elchi.uz/track/987',
            itemsCount: '2',
            createdAt: new Date('2026-07-30T09:00:00.000Z'),
          },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    const result = await service.findAll('15', {
      status: SalesOrderSellerStatus.ON_THE_ROAD,
      page: 1,
      limit: 20,
    });

    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('s.shop_id = $1'),
      ['15', SalesOrderSellerStatus.ON_THE_ROAD],
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('s.shop_id = $1'),
      ['15', SalesOrderSellerStatus.ON_THE_ROAD, 20, 0],
    );
    expect(result).toMatchObject({
      total: 1,
      items: [
        {
          id: '31',
          subtotal: 450000,
          itemsCount: 2,
          status: SalesOrderSellerStatus.ON_THE_ROAD,
        },
      ],
    });
  });

  it('TC2: dashboard sotuv soni va daromadni test ma’lumotiga mos qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            ordersTotal: '5',
            revenue: '1250000.50',
            pendingShipments: '2',
            delivered: '3',
          },
        ])
        .mockResolvedValueOnce([
          { productId: '88', name: 'Telefon', sold: '7' },
          { productId: '91', name: 'G‘ilof', sold: '4' },
        ])
        .mockResolvedValueOnce([
          { date: '2026-08-01', amount: '450000.25' },
          { date: '2026-08-02', amount: '800000.25' },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.dashboard('15', 4)).resolves.toEqual({
      ordersTotal: 5,
      revenue: 1250000.5,
      pendingShipments: 2,
      delivered: 3,
      lowStockCount: 4,
      topProducts: [
        { productId: '88', name: 'Telefon', sold: 7 },
        { productId: '91', name: 'G‘ilof', sold: 4 },
      ],
      salesByDay: [
        { date: '2026-08-01', amount: 450000.25 },
        { date: '2026-08-02', amount: 800000.25 },
      ],
    });
    for (const call of dataSource.query.mock.calls) {
      expect(call[1]).toEqual(['15']);
    }
  });

  it('TC3: buyurtma bo‘lmasa bo‘sh sahifa qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(
      service.findAll('15', { page: 1, limit: 20 }),
    ).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  it('TC3: buyurtmasiz dashboard barcha qiymatlarni 0 qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            ordersTotal: '0',
            revenue: '0',
            pendingShipments: '0',
            delivered: '0',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.dashboard('15', 0)).resolves.toEqual({
      ordersTotal: 0,
      revenue: 0,
      pendingShipments: 0,
      delivered: 0,
      lowStockCount: 0,
      topProducts: [],
      salesByDay: [],
    });
    for (const call of dataSource.query.mock.calls) {
      expect(call[1]).toEqual(['15']);
    }
  });
});

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
          { ordersTotal: '5', ordersToday: '2', gmv: '54000000.00' },
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
            totalAmount: '450000.00',
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

  it('buyer tracking order va barcha shop posilkalarini qaytaradi', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          orderId: '42',
          customerId: '9',
          sessionId: 'guest-session',
          orderStatus: 'CONFIRMED',
          orderUpdatedAt: '2026-09-14T10:00:00.000Z',
          sellerOrderId: '11',
          shopId: '3',
          shopName: 'Elchi do‘koni',
          shipmentId: '7',
          shipmentStatus: 'ON_THE_ROAD',
          trackingUrl: 'https://elchi.uz/track/7',
          updatedAt: '2026-09-14T10:30:00.000Z',
        },
        {
          orderId: '42',
          customerId: '9',
          sessionId: 'guest-session',
          orderStatus: 'CONFIRMED',
          orderUpdatedAt: '2026-09-14T10:00:00.000Z',
          sellerOrderId: '12',
          shopId: '4',
          shopName: 'Ikkinchi do‘kon',
          shipmentId: '8',
          shipmentStatus: 'SHIPMENT_CREATED',
          trackingUrl: null,
          updatedAt: '2026-09-14T10:20:00.000Z',
        },
      ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.buyerTracking('42', '9')).resolves.toEqual({
      orderId: '42',
      orderStatus: 'IN_TRANSIT',
      estimatedDeliveryAt: null,
      updatedAt: '2026-09-14T10:30:00.000Z',
      shipments: [
        {
          shipmentId: '7',
          shopId: '3',
          shopName: 'Elchi do‘koni',
          shipmentStatus: 'OUT_FOR_DELIVERY',
          trackingUrl: 'https://elchi.uz/track/7',
          updatedAt: '2026-09-14T10:30:00.000Z',
        },
        {
          shipmentId: '8',
          shopId: '4',
          shopName: 'Ikkinchi do‘kon',
          shipmentStatus: 'SHIPMENT_CREATED',
          trackingUrl: null,
          updatedAt: '2026-09-14T10:20:00.000Z',
        },
      ],
    });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE o.id=$1'),
      ['42'],
    );
  });

  it('buyer tracking to‘g‘ri guest session bilan ishlaydi', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          orderId: '42',
          customerId: '9',
          sessionId: 'guest-session',
          orderStatus: 'DRAFT',
          orderUpdatedAt: '2026-09-14T10:00:00.000Z',
          sellerOrderId: '11',
          shopId: '3',
          shopName: 'Elchi do‘koni',
          shipmentId: null,
          shipmentStatus: 'PENDING',
          trackingUrl: null,
          updatedAt: '2026-09-14T10:00:00.000Z',
        },
      ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(
      service.buyerTracking('42', undefined, 'guest-session'),
    ).resolves.toMatchObject({ orderId: '42' });
  });

  it.each([
    ['begona buyer', '10', undefined],
    ['begona guest', undefined, 'other-session'],
  ])('buyer tracking %s uchun 403 qiladi', async (_name, buyer, session) => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          orderId: '42',
          customerId: '9',
          sessionId: 'guest-session',
          orderStatus: 'DRAFT',
          orderUpdatedAt: '2026-09-14T10:00:00.000Z',
        },
      ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.buyerTracking('42', buyer, session)).rejects.toThrow(
      'ruxsat yo‘q',
    );
  });

  it('buyer tracking mavjud bo‘lmagan orderni 404 qiladi', async () => {
    const service = new SellerOrdersService({
      query: jest.fn().mockResolvedValue([]),
    } as never);

    await expect(service.buyerTracking('999', '9')).rejects.toThrow(
      'Buyurtma topilmadi',
    );
  });

  it('buyer order tafsilotlari mahsulot, summa, manzil va to‘lov turini qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { customerId: '9', sessionId: 'guest-session' },
        ])
        .mockResolvedValueOnce([
          {
            id: '42',
            buyerName: 'Ali',
            customerId: '9',
            status: 'CONFIRMED',
            paymentMethod: 'cod',
            totalAmount: '475000',
            deliveryFee: '25000',
            deliveryAddress: 'Toshkent',
            createdAt: '2026-09-14T10:00:00.000Z',
            updatedAt: '2026-09-14T10:30:00.000Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: '31',
            shopId: '15',
            subtotal: '450000',
            deliveryFee: '25000',
            codAmount: '475000',
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

    const result = await service.buyerOrderDetails('42', '9');

    expect(result).toMatchObject({
      id: '42',
      status: 'CONFIRMED',
      paymentMethod: 'cod',
      totalAmount: 475000,
      deliveryFee: 25000,
      deliveryAddress: 'Toshkent',
    });
    expect(result).not.toHaveProperty('customerId');
    expect(result.sellerOrders[0].items[0]).toMatchObject({
      productName: 'Telefon',
      quantity: 2,
      lineTotal: 450000,
    });
  });

  it('guest order tafsilotlarini to‘g‘ri session bilan qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { customerId: '9', sessionId: 'guest-session' },
        ])
        .mockResolvedValueOnce([
          {
            id: '42',
            customerId: '9',
            status: 'DRAFT',
            paymentMethod: 'cod',
            totalAmount: '100',
            deliveryFee: '10',
            createdAt: 'd1',
            updatedAt: 'd2',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(
      service.buyerOrderDetails('42', undefined, 'guest-session'),
    ).resolves.toMatchObject({ id: '42' });
  });

  it('buyer buyurtmalarini mahsulotlari bilan sahifalab qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            orderId: '42',
            createdAt: '2026-09-15T10:00:00.000Z',
            orderStatus: 'CONFIRMED',
            totalAmount: 115000,
            deliveryFee: 15000,
          },
        ])
        .mockResolvedValueOnce([
          {
            orderId: '42',
            productId: '7',
            name: 'Mahsulot',
            quantity: 1,
            unitPrice: 100000,
            imageUrl: null,
          },
        ]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(
      service.buyerOrders('9', { page: 1, limit: 20 }),
    ).resolves.toEqual({
      items: [
        {
          orderId: '42',
          createdAt: '2026-09-15T10:00:00.000Z',
          orderStatus: 'CONFIRMED',
          subtotal: 100000,
          deliveryFee: 15000,
          totalAmount: 115000,
          items: [
            {
              productId: '7',
              name: 'Mahsulot',
              quantity: 1,
              unitPrice: 100000,
              imageUrl: null,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE customer_id=$1'),
      ['9', 20, 0],
    );
  });

  it('buyer orderlari bo‘lmasa bo‘sh sahifa qaytaradi', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]),
    };
    const service = new SellerOrdersService(dataSource as never);

    await expect(service.buyerOrders('9')).resolves.toMatchObject({
      items: [],
      total: 0,
      totalPages: 0,
    });
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });
});
