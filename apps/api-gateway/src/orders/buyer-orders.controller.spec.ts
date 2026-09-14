import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { BuyerOrdersController } from './buyer-orders.controller';

describe('BuyerOrdersController', () => {
  it('buyer id va order idni checkout tracking RPCga uzatadi', async () => {
    const send = jest.fn(() => of({ orderId: '42', shipments: [] }));
    const controller = new BuyerOrdersController({ send } as never);

    await expect(
      controller.tracking({ sub: '9', role: Role.BUYER }, '42'),
    ).resolves.toMatchObject({ orderId: '42' });
    expect(send).toHaveBeenCalledWith(
      { cmd: 'checkout.order.tracking' },
      { orderId: '42', customerId: '9' },
    );
  });

  it('endpoint faqat BUYER roliga ochiq', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, BuyerOrdersController.prototype.tracking),
    ).toEqual([Role.BUYER]);
  });
});
