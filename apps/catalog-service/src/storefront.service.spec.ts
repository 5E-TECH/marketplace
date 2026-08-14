import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ProductStatus,
  ShopStatus,
  StorefrontProductsQueryDto,
} from '@app/common';
import { StorefrontService } from './storefront.service';

describe('StorefrontService', () => {
  const query = (values: Partial<StorefrontProductsQueryDto> = {}) =>
    Object.assign(new StorefrontProductsQueryDto(), values);
  let productRepo: { createQueryBuilder: jest.Mock };
  let shopRepo: { findOne: jest.Mock };
  let service: StorefrontService;
  let qb: Record<string, jest.Mock>;

  beforeEach(() => {
    qb = {};
    for (const method of [
      'innerJoinAndSelect',
      'leftJoinAndSelect',
      'where',
      'andWhere',
      'setParameter',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[{ id: '1' }], 1]);
    qb.getOne = jest.fn();
    productRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    shopRepo = { findOne: jest.fn() };
    service = new StorefrontService(productRepo as any, shopRepo as any);
  });

  it('ro‘yxatda faqat active product va active shopni oladi', async () => {
    await service.listProducts(query());

    expect(qb.innerJoinAndSelect).toHaveBeenCalledWith(
      'product.shop',
      'shop',
      'shop.is_deleted = FALSE AND shop.status = :shopStatus',
      { shopStatus: ShopStatus.ACTIVE },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'product.status = :productStatus',
      { productStatus: ProductStatus.ACTIVE },
    );
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'product.category',
      'category',
    );
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'product.variants',
      'variant',
      'variant.is_deleted = FALSE AND variant.is_active = TRUE',
    );
  });

  it('kategoriya, narx, qidiruv, sort va paginationni qo‘llaydi', async () => {
    await expect(
      service.listProducts(
        query({
          categoryId: '7',
          minPrice: 100,
          maxPrice: 500,
          search: 'phone',
          sort: 'price:asc',
          page: 2,
          limit: 10,
        }),
      ),
    ).resolves.toMatchObject({ total: 1, page: 2, limit: 10, totalPages: 1 });

    expect(qb.andWhere).toHaveBeenCalledWith(
      'product.category_id = :categoryId',
      { categoryId: '7' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('product.price >= :minPrice', {
      minPrice: 100,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('product.price <= :maxPrice', {
      maxPrice: 500,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('product.price', 'ASC');
    expect(qb.skip).toHaveBeenCalledWith(10);
  });

  it('noto‘g‘ri narx oralig‘ini rad etadi', async () => {
    await expect(
      service.listProducts(query({ minPrice: 500, maxPrice: 100 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('draft yoki suspended shop mahsulot detailini 404 qiladi', async () => {
    qb.getOne.mockResolvedValue(null);
    await expect(service.getProduct('12')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('suspended shop sahifasini 404 qiladi', async () => {
    shopRepo.findOne.mockResolvedValue(null);
    await expect(service.getShop('yopiq-shop', query())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(shopRepo.findOne).toHaveBeenCalledWith({
      where: {
        slug: 'yopiq-shop',
        status: ShopStatus.ACTIVE,
        isDeleted: false,
      },
    });
  });

  it('active shop sahifasiga faqat uning active mahsulotlarini qo‘shadi', async () => {
    shopRepo.findOne.mockResolvedValue({ id: '9', slug: 'active-shop' });
    const result = await service.getShop('active-shop', query());

    expect(qb.andWhere).toHaveBeenCalledWith('product.shop_id = :shopId', {
      shopId: '9',
    });
    expect(result).toMatchObject({
      shop: { id: '9' },
      products: { total: 1 },
    });
  });
  it('shop ID bo‘yicha faqat shu active shop mahsulotlarini qaytaradi', async () => {
    shopRepo.findOne.mockResolvedValue({ id: '9', status: ShopStatus.ACTIVE });

    await expect(service.getShopProducts('9', query())).resolves.toMatchObject({
      items: [{ id: '1' }],
      total: 1,
    });
    expect(shopRepo.findOne).toHaveBeenCalledWith({
      where: {
        id: '9',
        status: ShopStatus.ACTIVE,
        isDeleted: false,
      },
    });
    expect(qb.andWhere).toHaveBeenCalledWith('product.shop_id = :shopId', {
      shopId: '9',
    });
  });

  it('mavjud bo‘lmagan yoki faol bo‘lmagan shop ID uchun 404 qaytaradi', async () => {
    shopRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getShopProducts('404', query()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
