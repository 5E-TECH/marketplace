import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { CheckoutPaymentMethod, IS_PUBLIC_KEY, Role } from '@app/common';
import { CheckoutController } from './checkout.controller';

describe('CheckoutController (C2.19)', () => {
  const dto = {
    paymentMethod: CheckoutPaymentMethod.COD,
    address: {
      recipientName: 'Ali',
      phone: '+998901234567',
      address: 'Toshkent',
    },
  };

  const setup = () => {
    const checkout = jest.fn(() => of({ id: '99' }));
    const identity = jest.fn(() => of({ id: '77' }));
    return {
      controller: new CheckoutController(
        { send: checkout } as never,
        { send: identity } as never,
      ),
      checkout,
      identity,
    };
  };

  it('checkout token bo‘lmasa ham public', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, CheckoutController.prototype.create),
    ).toBe(true);
  });

  it('TC1/TC3: guest buyer yaratib session cart bilan checkout qiladi', async () => {
    const { controller, checkout, identity } = setup();

    await controller.create(undefined, dto, 'request-1', 'guest-session');

    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.customer.create' },
      { phone: '+998901234567', name: 'Ali' },
    );
    expect(checkout).toHaveBeenCalledWith(
      { cmd: 'checkout.create' },
      expect.objectContaining({
        customerId: '77',
        sessionId: 'guest-session',
        idempotencyKey: 'request-1',
      }),
    );
  });

  it('login user uchun eski checkout oqimini saqlaydi', async () => {
    const { controller, checkout, identity } = setup();
    await controller.create(
      { sub: '42', role: Role.BUYER },
      dto,
      undefined,
      'ignored-session',
    );
    expect(identity).not.toHaveBeenCalled();
    expect(checkout).toHaveBeenCalledWith(
      { cmd: 'checkout.create' },
      expect.objectContaining({ customerId: '42', sessionId: undefined }),
    );
  });

  it('guest session headersiz checkout 400', () => {
    const { controller } = setup();
    expect(() => controller.create(undefined, dto)).toThrow(
      BadRequestException,
    );
  });

  it('C2.20: guest delivery preview session bilan checkout servisiga uzatiladi', async () => {
    const { controller, checkout } = setup();
    await controller.preview(undefined, 'guest-session', {
      address: dto.address,
    });
    expect(checkout).toHaveBeenCalledWith(
      { cmd: 'checkout.delivery.preview' },
      {
        customerId: undefined,
        sessionId: 'guest-session',
        address: dto.address,
      },
    );
  });
});
