import { of } from 'rxjs';
import { UnauthorizedException } from '@nestjs/common';
import { IS_PUBLIC_KEY, Role } from '@app/common';
import { BuyerOrdersController } from './buyer-orders.controller';

describe('BuyerOrdersController', () => {
  it('buyer buyurtmalar ro‘yxatini sahifalash bilan so‘raydi', async () => {
    const send = jest.fn(() => of({ items: [], total: 0 }));
    const controller = new BuyerOrdersController({ send } as never);

    await controller.list({ user: { sub: '9', role: Role.BUYER } } as never, {
      page: 2,
      limit: 10,
    });

    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.orders.list-by-buyer' },
      { customerId: '9', query: { page: 2, limit: 10 } },
    );
  });

  it('buyer id va order idni checkout tracking RPCga uzatadi', async () => {
    const send = jest.fn(() => of({ orderId: '42', shipments: [] }));
    const controller = new BuyerOrdersController({ send } as never);

    await expect(
      controller.tracking(
        { user: { sub: '9', role: Role.BUYER }, headers: {} } as never,
        '42',
      ),
    ).resolves.toMatchObject({ orderId: '42' });
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.order.tracking' },
      { orderId: '42', customerId: '9', sessionId: undefined },
    );
  });

  it('guest sessionni checkout tracking RPCga uzatadi', async () => {
    const send = jest.fn(() => of({ orderId: '42', shipments: [] }));
    const controller = new BuyerOrdersController({ send } as never);

    await controller.tracking(
      { headers: { 'x-session-id': ' guest-session ' } } as never,
      '42',
    );

    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.order.tracking' },
      { orderId: '42', customerId: undefined, sessionId: 'guest-session' },
    );
  });

  it('buyer order tafsilotlarini ownership bilan so‘raydi', async () => {
    const send = jest.fn(() => of({ id: '42', sellerOrders: [] }));
    const controller = new BuyerOrdersController({ send } as never);

    await expect(
      controller.details(
        { user: { sub: '9', role: Role.BUYER }, headers: {} } as never,
        '42',
      ),
    ).resolves.toMatchObject({ id: '42' });
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.order.details' },
      { orderId: '42', customerId: '9', sessionId: undefined },
    );
  });

  it('guest order tafsilotlarini session bilan so‘raydi', async () => {
    const send = jest.fn(() => of({ id: '42', sellerOrders: [] }));
    const controller = new BuyerOrdersController({ send } as never);

    await controller.details(
      { headers: { 'x-session-id': 'guest-session' } } as never,
      '42',
    );

    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.order.details' },
      { orderId: '42', customerId: undefined, sessionId: 'guest-session' },
    );
  });

  it('token ham session ham bo‘lmasa 401', () => {
    const controller = new BuyerOrdersController({} as never);
    expect(() => controller.tracking({ headers: {} } as never, '42')).toThrow(
      UnauthorizedException,
    );
  });

  it('endpoint optional auth uchun public belgilanadi', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        BuyerOrdersController.prototype.tracking,
      ),
    ).toBe(true);
  });
});
