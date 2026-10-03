import { BadRequestException, NotFoundException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { In } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  CheckoutPaymentMethod,
} from '@app/common';
import { CheckoutService } from './checkout.service';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';

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

  function setup(reserveFails = false, minimumOrderAmount = 0) {
    const cart = {
      id: '9',
      customerId: '5',
      status: 'active',
      items: [
        {
          id: '101',
          productId: '10',
          variantId: '11',
          shopId: '7',
          quantity: 2,
          unitPriceSnapshot: 100,
          productNameSnapshot: 'Smartfon X',
        },
        {
          id: '102',
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
    const cartItems = { delete: jest.fn().mockResolvedValue({ affected: 1 }) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === CartItem) return cartItems;
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
          // `.toFixed(2)` ATAYLAB — SATR qaytaramiz. node-postgres `numeric`
          // ustunini aniqlikni yo'qotmaslik uchun aynan shunday beradi. Avval
          // bu mock `Number()` qaytarardi va shu sabab jonli tizimdagi satr
          // birikmasi nuqsonini (10000 + "0.00" = "100000.00") butun to'plam
          // yashil turib o'tkazib yuborgandi. Mock haqiqatdan soddaroq bo'lsa,
          // testlar kodni emas, mockni tekshiradi.
          return [
            {
              id: String(++sellerId),
              deliveryFee: Number(params[3]).toFixed(2),
            },
          ];
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
      send: jest.fn((_pattern?: unknown, _request?: unknown) =>
        of({ amount: 20 }),
      ),
    };
    const identity = {
      send: jest.fn(() => of({ minimumOrderAmount })),
    };
    return {
      service: new CheckoutService(
        dataSource as never,
        inventory as never,
        integration as never,
        identity as never,
      ),
      queries,
      inventory,
      cart,
      cartItems,
      integration,
      identity,
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
    expect(insert?.params[10]).toBe('guest-session');
    expect(cart.status).toBe('converted');
  });

  it('C2.20 TC1: checkout har posilka uchun alohida dostavka narxini saqlaydi', async () => {
    const { service, integration } = setup();

    const result = await service.create('5', dto());

    expect(integration.send).toHaveBeenCalledTimes(2);
    expect(result.sellerOrders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shopId: '7', deliveryFee: 20 }),
        expect.objectContaining({ shopId: '8', deliveryFee: 20 }),
      ]),
    );
  });

  it('C2.20 TC2: jami subtotal va barcha posilkalar dostavkasiga teng', async () => {
    const { service } = setup();

    await expect(service.create('5', dto())).resolves.toMatchObject({
      subtotal: 500,
      deliveryFee: 40,
      totalAmount: 540,
    });
  });

  it('C6.2: yangi minimal buyurtma summasini darhol qo‘llaydi', async () => {
    const { service, inventory, identity } = setup(false, 501);

    await expect(service.create('5', dto())).rejects.toThrow(
      'Minimal buyurtma summasi 501',
    );
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.settings.get' },
      {},
    );
    expect(inventory.send).not.toHaveBeenCalled();
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

  it('C2.20: manzil o‘zgarganda Elchi tarifini qayta hisoblaydi', async () => {
    const { service, integration } = setup();
    integration.send.mockImplementation(
      (_pattern: unknown, request: { districtId: string }) =>
        of({ amount: request.districtId === '3' ? 35 : 20 }),
    );

    const first = await service.preview('5', undefined, dto().address);
    const changedAddress = { ...dto().address, districtId: '3' };
    const second = await service.preview('5', undefined, changedAddress);

    expect(first).toMatchObject({ deliveryFee: 40, totalAmount: 540 });
    expect(second).toMatchObject({ deliveryFee: 70, totalAmount: 570 });
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.tariff.get' },
      expect.objectContaining({ districtId: '3' }),
    );
  });

  it('C1.46 TC4: CENTER preview Elchidan markaz tarifini so‘raydi', async () => {
    const { service, integration } = setup();
    const address = {
      ...dto().address,
      whereDeliver: CheckoutDeliveryDestination.CENTER,
    };

    await service.preview('5', undefined, address);

    expect(integration.send).toHaveBeenCalledTimes(2);
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.tariff.get' },
      expect.objectContaining({
        whereDeliver: CheckoutDeliveryDestination.CENTER,
      }),
    );
  });

  it('C1.46 TC4: tanlangan yetkazish turi sales_orderga saqlanadi', async () => {
    const { service, queries } = setup();
    const checkout = {
      ...dto(),
      address: {
        ...dto().address,
        whereDeliver: CheckoutDeliveryDestination.CENTER,
      },
    };

    await service.create('5', checkout);

    const insert = queries.find((entry) =>
      entry.sql.includes('INSERT INTO checkout.sales_order\n'),
    );
    expect(insert?.sql).toContain('where_deliver');
    expect(insert?.params[9]).toBe(CheckoutDeliveryDestination.CENTER);
  });

  it('mahsulot nomi buyurtma bandiga o‘tadi, surat yo‘q bo‘lsa zaxira nom yoziladi', async () => {
    /**
     * Regressiya: avval `product_name` INSERT'ga qattiq `''` qilib yozilardi.
     * Natijada productiondagi HAR BIR buyurtma bandining nomi bo'sh bo'lib
     * qolgan va Elchi posilka yaratishni rad etgan:
     *   POST /partner/shipments → 400 "items.0.name should not be empty"
     * ya'ni sotuvchi buyurtmani umuman jo'nata olmasdi.
     *
     * Ikkinchi band ATAYLAB suratsiz — ustun qo'shilishidan oldin savatga
     * tushgan qatorlar shunday bo'ladi. Ular uchun ham Elchi'ga bo'sh nom
     * ketmasligi kerak.
     */
    const { service, queries } = setup();
    await service.create('5', dto());
    const names = queries
      .filter((q) => q.sql.includes('INSERT INTO checkout.sales_order_item'))
      .map((q) => q.params[2]);
    expect(names).toEqual(['Smartfon X', 'Mahsulot #20']);
    expect(names.every((n) => String(n).trim().length > 0)).toBe(true);
  });

  describe('tanlangan savat qatorlari (cartItemIds)', () => {
    const sellerItemInserts = (queries: Array<{ sql: string }>) =>
      queries.filter((q) =>
        q.sql.includes('INSERT INTO checkout.sales_order_item'),
      );

    it('faqat tanlangan qator buyurtmaga o‘tadi va savatdan o‘chadi, qolgani savatda qoladi', async () => {
      const { service, inventory, cart, cartItems, queries } = setup();

      const result = await service.create('5', {
        ...dto(),
        cartItemIds: ['102'],
      });

      expect(result).toMatchObject({
        subtotal: 300,
        deliveryFee: 20,
        totalAmount: 320,
      });
      expect(result.sellerOrders.map((order) => order.shopId)).toEqual(['8']);
      expect(sellerItemInserts(queries)).toHaveLength(1);
      expect(inventory.send).toHaveBeenCalledWith(
        { cmd: 'inventory.reserve' },
        expect.objectContaining({ items: [{ variantId: '21', quantity: 1 }] }),
      );
      expect(cartItems.delete).toHaveBeenCalledWith({
        cartId: '9',
        id: In(['102']),
      });
      // Savat `converted` bo'lmaydi — belgilanmagan qator xaridorda qoladi.
      expect(cart.status).toBe('active');
    });

    it('hamma qator tanlansa savat avvalgidek converted bo‘ladi', async () => {
      const { service, cart, cartItems } = setup();

      await service.create('5', { ...dto(), cartItemIds: ['101', '102'] });

      expect(cart.status).toBe('converted');
      expect(cartItems.delete).not.toHaveBeenCalled();
    });

    it('savatda yo‘q qator → 404, buyurtma ham rezerv ham yaratilmaydi', async () => {
      const { service, inventory, queries, cart, cartItems } = setup();

      await expect(
        service.create('5', { ...dto(), cartItemIds: ['101', '999'] }),
      ).rejects.toThrow(
        new NotFoundException('Savatda topilmagan qatorlar: 999'),
      );
      expect(queries).toHaveLength(0);
      expect(inventory.send).not.toHaveBeenCalled();
      expect(cartItems.delete).not.toHaveBeenCalled();
      expect(cart.status).toBe('active');
    });

    it('minimal summa faqat tanlangan qatorlar bo‘yicha tekshiriladi', async () => {
      const { service, inventory } = setup(false, 301);

      await expect(
        service.create('5', { ...dto(), cartItemIds: ['102'] }),
      ).rejects.toThrow('Minimal buyurtma summasi 301');
      expect(inventory.send).not.toHaveBeenCalled();
    });

    it('preview faqat tanlangan qatorlar posilkasini hisoblaydi', async () => {
      const { service, integration } = setup();

      await expect(
        service.preview('5', undefined, dto().address, ['101']),
      ).resolves.toMatchObject({
        subtotal: 200,
        deliveryFee: 20,
        totalAmount: 220,
        packages: [{ shopId: '7', subtotal: 200 }],
      });
      expect(integration.send).toHaveBeenCalledTimes(1);
    });
  });
});
