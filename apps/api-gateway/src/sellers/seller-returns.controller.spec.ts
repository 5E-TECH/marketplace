import { of } from 'rxjs';
import { Role, ROLES_KEY } from '@app/common';
import { SellerReturnsController } from './seller-returns.controller';

describe('SellerReturnsController (C4.2)', () => {
  it('sotuvchi va operator uchun', () => {
    for (const method of [
      'list',
      'get',
      'review',
      'approve',
      'reject',
    ] as const) {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          SellerReturnsController.prototype[method],
        ),
      ).toEqual([Role.SELLER, Role.OPERATOR]);
    }
  });

  it('operator JWT shopId, owner esa ownerUserId bilan scope qilinadi', async () => {
    const send = jest.fn(() => of({ id: '3' }));
    const controller = new SellerReturnsController({ send } as never);
    const operator = { sub: '71', role: Role.OPERATOR, shopId: '7' };
    const owner = { sub: '70', role: Role.SELLER };

    await controller.approve(operator as never, '3', { comment: 'OK' });
    await controller.reject(owner as never, '3', { reason: 'Ishlatilgan' });

    expect(send).toHaveBeenNthCalledWith(
      1,
      { cmd: 'seller.returns.approve' },
      {
        shopId: '7',
        returnId: '3',
        actor: { id: '71', role: Role.OPERATOR },
        comment: 'OK',
      },
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { cmd: 'seller.returns.reject' },
      {
        ownerUserId: '70',
        returnId: '3',
        actor: { id: '70', role: Role.SELLER },
        comment: 'Ishlatilgan',
      },
    );
  });
});
