import { of } from 'rxjs';
import { LegacyRole, ROLES_KEY, SalesOrderSellerStatus } from '@app/common';
import { SellerOrdersController } from './seller-orders.controller';

describe('SellerOrdersController — operator scope (C1.38)', () => {
  it('orders + updateOrder SELLER va OPERATOR uchun (@Roles)', () => {
    for (const m of [
      'orders',
      'updateOrder',
      'label',
      'labelsBatch',
    ] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, SellerOrdersController.prototype[m]),
      ).toEqual([LegacyRole.SELLER, LegacyRole.OPERATOR]);
    }
    // dashboard faqat SELLER
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SellerOrdersController.prototype.dashboard,
      ),
    ).toEqual([LegacyRole.SELLER]);
  });

  it('BE-05: tokendagi shopId e’tiborsiz — scope faqat ownerUserId', async () => {
    const send = jest.fn(() => of({}));
    const ctrl = new SellerOrdersController({ send } as never);

    await ctrl.updateOrder(
      { role: LegacyRole.OPERATOR, shopId: '5', sub: '10' } as never,
      '7',
      { status: SalesOrderSellerStatus.SHIPMENT_CREATED },
    );
    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.update-status' },
      { ownerUserId: '10', orderId: '7', status: 'SHIPMENT_CREATED' },
    );

    await ctrl.updateOrder(
      { role: LegacyRole.SELLER, sub: '42' } as never,
      '7',
      {
        status: SalesOrderSellerStatus.DELIVERED,
      },
    );
    expect(send).toHaveBeenCalledWith(
      { cmd: 'seller.orders.update-status' },
      { ownerUserId: '42', orderId: '7', status: 'DELIVERED' },
    );
  });
});
