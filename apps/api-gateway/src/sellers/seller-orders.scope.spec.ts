import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { SellerOrdersController } from './seller-orders.controller';

describe('SellerOrdersController — operator scope (C1.38)', () => {
  it('orders + updateOrder SELLER va OPERATOR uchun (@Roles)', () => {
    for (const m of ['orders', 'updateOrder'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, SellerOrdersController.prototype[m]),
      ).toEqual([Role.SELLER, Role.OPERATOR]);
    }
    // dashboard faqat SELLER
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerOrdersController.prototype.dashboard,
      ),
    ).toEqual([Role.SELLER]);
  });

  it('TC2/TC3 scope: operator -> shopId; seller -> ownerUserId', async () => {
    const send = jest.fn(() => of({}));
    const ctrl = new SellerOrdersController({ send } as never);

    await ctrl.updateOrder(
      { role: Role.OPERATOR, shopId: '5', sub: '10' } as never,
      '7',
      { status: 'SHIPMENT_CREATED' },
    );
    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.update-status' },
      { shopId: '5', orderId: '7', status: 'SHIPMENT_CREATED' },
    );

    await ctrl.updateOrder({ role: Role.SELLER, sub: '42' } as never, '7', {
      status: 'DELIVERED',
    });
    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.update-status' },
      { ownerUserId: '42', orderId: '7', status: 'DELIVERED' },
    );
  });
});
