import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { CheckoutPaymentMethod } from '@app/common';
import { CheckoutService } from './checkout.service';
import { Cart } from './entities/cart.entity';

describe('CheckoutService (C2.9)', () => {
  const dto = (paymentMethod = CheckoutPaymentMethod.COD) => ({
    paymentMethod,
    address: {
      recipientName: 'Ali Valiyev',
      phone: '+998901234567',
      address: 'Toshkent, Amir Temur 1',
      regionId: '1',
      districtId: '2',
    },
  });

  function setup(reserveFails = false) {
    const cart = {
      id: '9',
      customerId: '5',
      status: 'active',
      items: [
        {
          productId: '10',
          variantId: '11',
          shopId: '7',
          quantity: 2,
          unitPriceSnapshot: 100,
        },
        {
          productId: '20',
          variantId: '21',
          shopId: '8',
          quantity: 1,
          unitPriceSnapshot: 300,
        },
      ],
    };
    let orderId = 0;
    let sellerId = 0;
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(Cart);
        return {
          findOne: jest.fn().mockResolvedValue(cart),
          save: jest.fn(async (value) => value),
        };
      }),
      query: jest.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO checkout.sales_order\n'))
          return [{ id: String(++orderId) }];
        if (sql.includes('INSERT INTO checkout.sales_order_seller'))
          return [{ id: String(++sellerId), deliveryFee: Number(params[3]) }];
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (run) => run(manager)),
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(cart),
      })),
    };
    const inventory = {
      send: jest.fn(() =>
        reserveFails
          ? throwError(() => new BadRequestException('Qoldiq yetarli emas'))
          : of({ reservationId: '55' }),
      ),
    };
    const integration = {
      send: jest.fn(() => of({ amount: 20 })),
    };
    return {
      service: new CheckoutService(
        dataSource as never,
        inventory as never,
        integration as never,
      ),
      queries,
      inventory,
      cart,
      integration,
    };
  }

  it('TC1: ikki shop uchun ikki seller order yaratadi', async () => {
    const { service } = setup();
    const result = await service.create('5', dto());
    expect(result.sellerOrders).toHaveLength(2);
    expect(result.sellerOrders.map((order) => order.shopId)).toEqual([
      '7',
      '8',
    ]);
    expect(result).toMatchObject({
      subtotal: 500,
      deliveryFee: 40,
      totalAmount: 540,
    });
    expect(result.sellerOrders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shopId: '7', deliveryFee: 20 }),
        expect.objectContaining({ shopId: '8', deliveryFee: 20 }),
      ]),
    );
  });

  it('TC2: inventory.reserve ni 30 daqiqalik TTL bilan chaqiradi', async () => {
    const { service, inventory } = setup();
    const result = await service.create('5', dto(), 'request-1');
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: 'inventory.reserve' },
      expect.objectContaining({
        orderRef: '1',
        ttlMs: 1_800_000,
        idempotencyKey: 'request-1',
        items: [
          { variantId: '11', quantity: 2 },
          { variantId: '21', quantity: 1 },
        ],
      }),
    );
    expect(result.reservationId).toBe('55');
  });

  it('TC3: inventory rad etsa transaction xato bilan tugaydi', async () => {
    const { service, cart } = setup(true);
    await expect(service.create('5', dto())).rejects.toThrow(
      'Qoldiq yetarli emas',
    );
    expect(cart.status).toBe('active');
  });

  it.each([
    [CheckoutPaymentMethod.ONLINE, 'PENDING_PAYMENT'],
    [CheckoutPaymentMethod.COD, 'DRAFT'],
  ] as const)('TC4: %s uchun %s status beradi', async (method, status) => {
    const { service } = setup();
    await expect(service.create('5', dto(method))).resolves.toMatchObject({
      status,
    });
  });

  it('C2.19 TC3: guest session savatidan buyer customer_id bilan order yaratadi', async () => {
    const { service, queries, cart } = setup();
    cart.customerId = null as never;
    (cart as typeof cart & { sessionId: string }).sessionId = 'guest-session';

    await service.create('77', dto(), 'guest-checkout-1', 'guest-session');

    const insert = queries.find((entry) =>
      entry.sql.includes('INSERT INTO checkout.sales_order\n'),
    );
    expect(insert?.params[0]).toBe('77');
    expect(cart.status).toBe('converted');
  });

  it('C2.20 TC3: storefront preview har shop uchun alohida posilka qaytaradi', async () => {
    const { service, integration } = setup();

    await expect(
      service.preview('5', undefined, dto().address),
    ).resolves.toMatchObject({
      subtotal: 500,
      deliveryFee: 40,
      totalAmount: 540,
      packages: [
        { shopId: '7', subtotal: 200, deliveryFee: 20, totalAmount: 220 },
        { shopId: '8', subtotal: 300, deliveryFee: 20, totalAmount: 320 },
      ],
    });
    expect(integration.send).toHaveBeenCalledTimes(2);
  });
});
