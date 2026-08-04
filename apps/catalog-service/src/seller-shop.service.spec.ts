import { NotFoundException } from '@nestjs/common';
import { ShopStatus } from '@app/common';
import { SellerShopService } from './seller-shop.service';

describe('SellerShopService', () => {
  const shop = {
    id: '10',
    ownerUserId: '42',
    name: 'Old Shop',
    status: ShopStatus.PENDING,
    isDeleted: false,
  };
  let findOne: jest.Mock;
  let merge: jest.Mock;
  let save: jest.Mock;
  let service: SellerShopService;

  beforeEach(() => {
    findOne = jest.fn();
    merge = jest.fn((target, dto) => Object.assign(target, dto));
    save = jest.fn(async (value) => value);
    service = new SellerShopService({ findOne, merge, save } as any);
  });

  it('GET faqat JWT ownerUserId ga tegishli shopni oladi', async () => {
    findOne.mockResolvedValue({ ...shop });

    await expect(service.getMine('42')).resolves.toMatchObject({
      id: '10',
      ownerUserId: '42',
    });
    expect(findOne).toHaveBeenCalledWith({
      where: { ownerUserId: '42', isDeleted: false },
    });
  });

  it('PATCH faqat o‘z shop profilini yangilaydi', async () => {
    findOne.mockResolvedValue({ ...shop });

    const result = await service.updateMine('42', {
      name: 'New Shop',
      address: 'Toshkent',
    });

    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: '42' }),
      { name: 'New Shop', address: 'Toshkent' },
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('New Shop');
  });

  it('boshqa owner uchun shop topilmasa 404 qaytaradi', async () => {
    findOne.mockResolvedValue(null);

    await expect(service.getMine('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(save).not.toHaveBeenCalled();
  });
});
