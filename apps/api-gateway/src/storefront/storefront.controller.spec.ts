import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import { SITE_ORDER_RPC, SiteOrderDto } from '@app/common';
import { StorefrontController } from './storefront.controller';

/** BE-34: asosiy sayt — mehmon savati va buyurtma (gateway). */
describe('StorefrontController (BE-34)', () => {
  const SESSION = 'guest-session-0001';
  const cart = {
    id: '5',
    customerId: null,
    sessionId: SESSION,
    items: [
      {
        id: '31',
        productId: '501',
        variantId: '901',
        shopId: '15',
        quantity: 2,
        unitPriceSnapshot: 251_000,
        lineTotal: 502_000,
        productName: 'Simsiz quloqchin',
        imageUrl: null,
      },
    ],
    totalAmount: 502_000,
    totalQuantity: 2,
  };
  const make = (clearFails = false) => {
    const checkout = {
      send: jest.fn((pattern: { cmd: string }) =>
        pattern.cmd === 'cart.clear' && clearFails
          ? throwError(() => new Error('checkout band'))
          : of(cart),
      ),
    };
    const lead = {
      send: jest.fn(() => of({ leadId: '7001', confirmMode: 'SMS' })),
    };
    const controller = new StorefrontController(
      {} as never,
      checkout as never,
      lead as never,
    );
    return { controller, checkout, lead };
  };
  const order = {
    name: 'Aziza',
    phone: '+998901234567',
    regionSoato: '1726',
    districtSoato: '1726266',
    addressLine: 'Turkiston ko‘chasi, 27-uy',
    whereDeliver: 'ADDRESS',
    confirmMode: 'SMS',
    consentVersion: '2026-11-16',
  };

  it('savat ochiq shaklda: optovik, variant va egasi yo‘q (TC3)', async () => {
    const { controller, checkout } = make();
    const result = await controller.cart(SESSION);
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'cart.get' },
      { owner: { sessionId: SESSION } },
    );
    expect(result).toEqual({
      items: [
        {
          id: '31',
          productId: '501',
          productName: 'Simsiz quloqchin',
          imageUrl: null,
          quantity: 2,
          unitPrice: 251_000,
          lineTotal: 502_000,
        },
      ],
      totalAmount: 502_000,
      totalQuantity: 2,
    });
    expect(JSON.stringify(result)).not.toMatch(/shopId|variantId|sessionId/);
  });

  it('x-session-id yo‘q yoki noto‘g‘ri — 400', async () => {
    const { controller } = make();
    await expect(controller.cart(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.cart('qisqa')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('TC1: buyurtma — savatdagi hamma tovar bitta so‘rovda lidga, keyin savat bo‘shaydi', async () => {
    const { controller, checkout, lead } = make();
    await expect(
      controller.order(order as never, '203.0.113.7', SESSION, 'jest'),
    ).resolves.toEqual({ leadId: '7001', confirmMode: 'SMS' });
    expect(lead.send).toHaveBeenCalledWith(
      { cmd: SITE_ORDER_RPC.CREATE },
      {
        order,
        lines: [{ productId: '501', quantity: 2 }],
        ip: '203.0.113.7',
        userAgent: 'jest',
      },
    );
    expect(checkout.send).toHaveBeenLastCalledWith(
      { cmd: 'cart.clear' },
      { owner: { sessionId: SESSION } },
    );
  });

  it('savat bo‘shatilmasa ham lid yaratilgan javob qaytadi', async () => {
    const { controller } = make(true);
    await expect(
      controller.order(order as never, '', SESSION, undefined),
    ).resolves.toMatchObject({ leadId: '7001' });
  });

  it('TC2: ko‘cha/uy bo‘sh (faqat bo‘shliq) — 400, maydon nomi bilan', async () => {
    const errors = await validate(
      plainToInstance(SiteOrderDto, { ...order, addressLine: '   ' }),
    );
    expect(errors.map((error) => error.property)).toEqual(['addressLine']);
    const ok = await validate(plainToInstance(SiteOrderDto, order));
    expect(ok).toEqual([]);
  });
});
