import { of } from 'rxjs';
import { ReturnReason, Role, ROLES_KEY } from '@app/common';
import { BuyerReturnsController } from './buyer-returns.controller';

describe('BuyerReturnsController (C4.2)', () => {
  const user = { sub: '5', role: Role.BUYER };

  it('faqat BUYER roli', () => {
    for (const method of ['create', 'list', 'get'] as const) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          BuyerReturnsController.prototype[method],
        ),
      ).toEqual([Role.BUYER]);
    }
  });

  it('xaridor id si JWT dan olinadi (body/query dan emas)', async () => {
    const send = jest.fn(() => of({ items: [] }));
    const controller = new BuyerReturnsController({ send } as never);
    const dto = {
      items: [{ orderItemId: '31', quantity: 1 }],
      reason: ReturnReason.DEFECTIVE,
    };

    await controller.create(user as never, '10', dto);
    await controller.list(user as never, { page: 1, limit: 20 });
    await controller.get(user as never, '3');

    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'checkout.returns.create' },
      { orderId: '10', customerId: '5', dto },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'checkout.returns.list-by-buyer' },
      { customerId: '5', query: { page: 1, limit: 20 } },
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      { cmd: 'checkout.returns.get-by-buyer' },
      { customerId: '5', returnId: '3' },
    );
  });
});
