import { Role, ROLES_KEY } from '@app/common';
import { of } from 'rxjs';
import { SellerOrdersController } from './seller-orders.controller';

describe('SellerOrdersController', () => {
  it('orders/updateOrder SELLER+OPERATOR, dashboard faqat SELLER', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, SellerOrdersController.prototype.orders),
    ).toEqual([Role.SELLER, Role.OPERATOR]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerOrdersController.prototype.updateOrder,
      ),
    ).toEqual([Role.SELLER, Role.OPERATOR]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerOrdersController.prototype.dashboard,
      ),
    ).toEqual([Role.SELLER]);
  });

  it('JWT actor ID sini orders RPC payloadga uzatadi', () => {
    const send = jest.fn(() => of({}));
    const controller = new SellerOrdersController({ send } as never);

    controller.orders({ sub: '401', role: Role.SELLER } as never, {
      page: 1,
      limit: 20,
    });

    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.list' },
      { ownerUserId: '401', query: { page: 1, limit: 20 } },
    );
  });

  it('JWT actor ID sini dashboard RPC payloadga uzatadi', () => {
    const send = jest.fn(() => of({}));
    const controller = new SellerOrdersController({ send } as never);

    controller.dashboard({ sub: '401', role: Role.SELLER } as never);

    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.dashboard.get' },
      { ownerUserId: '401' },
    );
  });
});
