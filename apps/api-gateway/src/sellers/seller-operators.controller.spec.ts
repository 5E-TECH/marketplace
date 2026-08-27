import { of } from 'rxjs';
import { SellerOperatorsController } from './seller-operators.controller';

describe('SellerOperatorsController', () => {
  it('operator update’da sellerning shopId sini identityga uzatadi', async () => {
    const identity = { send: jest.fn(() => of({ id: '10' })) };
    const catalog = { send: jest.fn(() => of({ id: '5' })) };
    const controller = new SellerOperatorsController(
      identity as never,
      catalog as never,
    );
    const dto = { name: 'Yangi ism', isActive: false };

    await expect(
      controller.update({ sub: '42', role: 'SELLER' } as never, '10', dto),
    ).resolves.toEqual({ id: '10' });
    expect(identity.send).toHaveBeenCalledWith(
      { cmd: 'identity.operator.update' },
      { shopId: '5', operatorId: '10', dto },
    );
  });
});
