import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@app/common';
import { ProductService } from './product.service';

describe('ProductService', () => {
  let productRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let shopRepo: { findOne: jest.Mock };
  let categoryRepo: { findOne: jest.Mock };
  let variantRepo: { create: jest.Mock; save: jest.Mock };
  let service: ProductService;

  beforeEach(() => {
    productRepo = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: value.id ?? '10', ...value })),
      createQueryBuilder: jest.fn(),
    };
    shopRepo = { findOne: jest.fn() };
    categoryRepo = { findOne: jest.fn() };
    variantRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: '100', ...value })),
    };
    service = new ProductService(
      productRepo as any,
      shopRepo as any,
      categoryRepo as any,
      variantRepo as any,
    );
  });

  it('seller uchun slug va ownership bilan mahsulot yaratadi', async () => {
    shopRepo.findOne.mockResolvedValue({ id: '5', ownerUserId: '42' });
    categoryRepo.findOne.mockResolvedValue({ id: '3', isActive: true });
    productRepo.findOne.mockResolvedValue(null);

    await service.create('42', {
      name: 'O‘yin telefoni',
      categoryId: '3',
      price: 1200000,
    });

    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: '5',
        ownerUserId: '42',
        slug: 'oyin-telefoni',
        price: 1200000,
        status: ProductStatus.DRAFT,
      }),
    );
    expect(variantRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: '10',
        sku: 'PRODUCT-10-DEFAULT',
        name: 'Default',
        price: null,
        isActive: true,
      }),
    );
    expect(variantRepo.save).toHaveBeenCalledTimes(1);
  });

  it('bir shopdagi takroriy nom uchun unique slug yaratadi', async () => {
    shopRepo.findOne.mockResolvedValue({ id: '5', ownerUserId: '42' });
    productRepo.findOne
      .mockResolvedValueOnce({ id: '1', shopId: '5', slug: 'iphone' })
      .mockResolvedValueOnce(null);

    await service.create('42', { name: 'iPhone', price: 100 });

    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'iphone-2' }),
    );
  });

  it('mavjud bo‘lmagan kategoriya bilan yaratishni bloklaydi', async () => {
    shopRepo.findOne.mockResolvedValue({ id: '5', ownerUserId: '42' });
    categoryRepo.findOne.mockResolvedValue(null);

    await expect(
      service.create('42', {
        name: 'Telefon',
        categoryId: '404',
        price: 100,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(productRepo.save).not.toHaveBeenCalled();
  });

  it('boshqa seller mahsulotini tahrirlashni 403 bilan bloklaydi', async () => {
    productRepo.findOne.mockResolvedValue({
      id: '10',
      ownerUserId: '99',
      isDeleted: false,
    });

    await expect(
      service.update('42', '10', { name: 'Begona mahsulot' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productRepo.save).not.toHaveBeenCalled();
  });

  it('o‘z mahsulotini soft-delete qiladi', async () => {
    const product = {
      id: '10',
      ownerUserId: '42',
      isDeleted: false,
    };
    productRepo.findOne.mockResolvedValue(product);

    await expect(service.remove('42', '10')).resolves.toEqual({
      id: '10',
      deleted: true,
    });
    expect(productRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true }),
    );
  });

  it('productga rasm qo‘shadi va cover sifatida belgilaydi', async () => {
    productRepo.findOne.mockResolvedValue({
      id: '10',
      ownerUserId: '42',
      images: ['http://minio/old.jpg'],
      imageUrl: null,
      isDeleted: false,
    });

    await service.addImage('42', '10', 'http://minio/new.jpg', true);

    expect(productRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        images: ['http://minio/old.jpg', 'http://minio/new.jpg'],
        imageUrl: 'http://minio/new.jpg',
      }),
    );
  });

  it('/products/my owner, filter, search va paginationni qo‘llaydi', async () => {
    const qb: Record<string, jest.Mock> = {};
    for (const method of [
      'where',
      'andWhere',
      'setParameter',
      'orderBy',
      'skip',
      'take',
    ]) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest
      .fn()
      .mockResolvedValue([[{ id: '10', ownerUserId: '42' }], 21]);
    productRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(
      service.getMine('42', {
        search: 'phone',
        status: ProductStatus.ACTIVE,
        categoryId: '3',
        page: 2,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
    expect(qb.where).toHaveBeenCalledWith(
      'product.owner_user_id = :ownerUserId',
      { ownerUserId: '42' },
    );
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
  });
});
