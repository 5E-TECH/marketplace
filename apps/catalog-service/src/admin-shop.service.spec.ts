import { of } from 'rxjs';
import { ShopStatus } from '@app/common';
import { AdminShopService } from './admin-shop.service';

function makeService(shop?: any) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(() => Promise.resolve([[{ id: '1' }], 1])),
  };
  const shops: any = {
    findOne: jest.fn(() => Promise.resolve(shop ?? null)),
    save: jest.fn((s: unknown) => Promise.resolve(s)),
    createQueryBuilder: jest.fn(() => qb),
  };
  const notifEmit = jest.fn(() => of(undefined));
  const intgEmit = jest.fn(() => of(undefined));
  const service = new AdminShopService(
    shops,
    { emit: notifEmit } as never,
    { emit: intgEmit } as never,
  );
  return { service, shops, qb, notifEmit, intgEmit };
}

describe('AdminShopService (C1.7)', () => {
  it('TC1: adminList status filtri qo‘llaydi', async () => {
    const { service, qb } = makeService();
    const res = await service.adminList({
      status: ShopStatus.PENDING,
      page: 1,
      limit: 20,
    } as never);

    expect(qb.andWhere).toHaveBeenCalledWith('shop.status = :status', {
      status: ShopStatus.PENDING,
    });
    expect(res).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('TC2: approve -> ACTIVE + shop.approved event (HAM notification, HAM integration)', async () => {
    const shop: any = {
      id: '9',
      ownerUserId: '42',
      name: 'Zamon',
      phone: '+998901234567',
      status: ShopStatus.PENDING,
    };
    const { service, shops, notifEmit, intgEmit } = makeService(shop);

    const result = await service.adminApprove('9');

    expect(result.status).toBe(ShopStatus.ACTIVE);
    expect(shops.save).toHaveBeenCalled();
    const event = {
      sellerUserId: '42',
      shopId: '9',
      shopName: 'Zamon',
      phone: '+998901234567',
    };
    expect(notifEmit).toHaveBeenCalledWith('shop.approved', event);
    expect(intgEmit).toHaveBeenCalledWith('shop.approved', event);
  });

  it('TC2 idempotent: allaqachon ACTIVE -> event yuborilmaydi', async () => {
    const shop: any = { id: '9', status: ShopStatus.ACTIVE };
    const { service, notifEmit, intgEmit } = makeService(shop);

    await service.adminApprove('9');

    expect(notifEmit).not.toHaveBeenCalled();
    expect(intgEmit).not.toHaveBeenCalled();
  });

  it('TC3: reject -> REJECTED + shop.rejected (notification), integration EMAS', async () => {
    const shop: any = {
      id: '9',
      ownerUserId: '42',
      name: 'Zamon',
      phone: '+998',
      status: ShopStatus.PENDING,
    };
    const { service, notifEmit, intgEmit } = makeService(shop);

    const result = await service.adminReject('9', 'Hujjat yetarli emas');

    expect(result.status).toBe(ShopStatus.REJECTED);
    expect(notifEmit).toHaveBeenCalledWith(
      'shop.rejected',
      expect.objectContaining({ shopId: '9', reason: 'Hujjat yetarli emas' }),
    );
    expect(intgEmit).not.toHaveBeenCalled();
  });
});
