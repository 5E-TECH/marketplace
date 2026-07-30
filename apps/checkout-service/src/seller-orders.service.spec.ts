import { SalesOrderSellerStatus } from '@app/common';
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

  it('TC2: buyurtma bo‘lmasa bo‘sh sahifa qaytaradi', async () => {
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

  it('TC3: dashboard aggregate va bo‘sh qiymatlarni to‘g‘ri map qiladi', async () => {
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
