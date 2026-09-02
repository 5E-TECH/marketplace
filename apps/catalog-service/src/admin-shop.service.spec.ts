import { of } from 'rxjs';
import { ConflictException } from '@nestjs/common';
import { ShopStatus } from '@app/common';
import { AdminShopService } from './admin-shop.service';

function makeService(shop?: any) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(() => Promise.resolve([[{ id: '1' }], 1])),
    getRawMany: jest.fn(() => Promise.resolve([])),
  };
  const shops: any = {
    findOne: jest.fn(() => Promise.resolve(shop ?? null)),
    save: jest.fn((s: unknown) => Promise.resolve(s)),
    createQueryBuilder: jest.fn(() => qb),
  };
  const products: any = { count: jest.fn(() => Promise.resolve(4)) };
  const notifEmit = jest.fn(() => of(undefined));
  const intgEmit = jest.fn(() => of(undefined));
  const service = new AdminShopService(
    shops,
    products,
    { emit: notifEmit } as never,
    { emit: intgEmit } as never,
  );
  return { service, shops, products, qb, notifEmit, intgEmit };
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

  it('C1.28: countByStatus holatlar bo‘yicha sanaydi (yo‘q holat = 0)', async () => {
    const { service, qb } = makeService();
    qb.getRawMany.mockResolvedValueOnce([
      { status: 'PENDING', count: '3' },
      { status: 'ACTIVE', count: '8' },
      { status: 'REJECTED', count: '1' },
    ]);

    const res = await service.countByStatus();

    expect(res).toEqual({
      total: 12,
      PENDING: 3,
      ACTIVE: 8,
      SUSPENDED: 0,
      REJECTED: 1,
    });
    expect(qb.groupBy).toHaveBeenCalledWith('shop.status');
  });

  it('C1.28: yangi platforma -> countByStatus hammasi 0', async () => {
    const { service, qb } = makeService();
    qb.getRawMany.mockResolvedValueOnce([]);

    await expect(service.countByStatus()).resolves.toEqual({
      total: 0,
      PENDING: 0,
      ACTIVE: 0,
      SUSPENDED: 0,
      REJECTED: 0,
    });
  });

  it('TC2: approve -> ACTIVE + save (event YO‘Q — u publishShopApproved da)', async () => {
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
    // approve endi emit qilmaydi — emit-after-consistency (gateway oxirida)
    expect(notifEmit).not.toHaveBeenCalled();
    expect(intgEmit).not.toHaveBeenCalled();
  });

  it('TC2 idempotent: allaqachon ACTIVE -> save chaqirilmaydi', async () => {
    const shop: any = { id: '9', status: ShopStatus.ACTIVE };
    const { service, shops } = makeService(shop);

    const result = await service.adminApprove('9');

    expect(result.status).toBe(ShopStatus.ACTIVE);
    expect(shops.save).not.toHaveBeenCalled();
  });

  it('TC2b: publishShopApproved -> shop.approved HAM notification HAM integration', async () => {
    const { service, notifEmit, intgEmit } = makeService();
    const event = {
      sellerUserId: '42',
      shopId: '9',
      shopName: 'Zamon',
      phone: '+998901234567',
    };

    await service.publishShopApproved(event);

    expect(notifEmit).toHaveBeenCalledWith('shop.approved', event);
    expect(intgEmit).toHaveBeenCalledWith('shop.approved', event);
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

  it('C1.32 TC1: detail profil va product count qaytaradi', async () => {
    const shop: any = { id: '9', status: ShopStatus.ACTIVE };
    const { service, products } = makeService(shop);

    await expect(service.adminDetail('9')).resolves.toEqual({
      shop,
      products: 4,
    });
    expect(products.count).toHaveBeenCalledWith({
      where: { shopId: '9', isDeleted: false },
    });
  });

  it('C1.32 TC2/TC3: ACTIVE suspend bo‘ladi, SUSPENDED activate bo‘ladi', async () => {
    const active: any = { id: '9', status: ShopStatus.ACTIVE };
    const first = makeService(active);
    await expect(first.service.adminSuspend('9')).resolves.toMatchObject({
      status: ShopStatus.SUSPENDED,
    });

    const second = makeService({ id: '9', status: ShopStatus.SUSPENDED });
    await expect(second.service.adminActivate('9')).resolves.toMatchObject({
      status: ShopStatus.ACTIVE,
    });
  });

  it('C1.32 TC4: PENDING do‘konni suspend qilish 409', async () => {
    const { service, shops } = makeService({
      id: '9',
      status: ShopStatus.PENDING,
    });

    await expect(service.adminSuspend('9')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(shops.save).not.toHaveBeenCalled();
  });
});
