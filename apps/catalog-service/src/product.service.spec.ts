import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ProductStatus, ShopStatus } from '@app/common';
import { of } from 'rxjs';
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
  let searchClient: { emit: jest.Mock };
  let notificationClient: { emit: jest.Mock };

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
    searchClient = { emit: jest.fn(() => of(undefined)) };
    notificationClient = { emit: jest.fn(() => of(undefined)) };
    service = new ProductService(
      productRepo as any,
      shopRepo as any,
      categoryRepo as any,
      variantRepo as any,
      searchClient as any,
      notificationClient as any,
    );
  });

  // BE-07: og‘irlik, o‘lchamlar va bazaviy narx majburiy; optovikda shartnoma (OPT-1)
  const PHYS = {
    basePrice: 140000,
    weightGrams: 450,
    lengthMm: 200,
    widthMm: 120,
    heightMm: 80,
  };
  const CONTRACT = { contractNumber: 'K-2026/014', contractDate: '2026-11-20' };

  it('BE-07 TC1: yangi mahsulot PENDING_REVIEW — qidiruvga va sotuvga chiqmaydi', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      ownerUserId: '42',
      name: 'Ali Market',
      status: ShopStatus.ACTIVE,
      isDeleted: false,
      ...CONTRACT,
    });
    productRepo.findOne.mockResolvedValue(null);

    await service.create('42', {
      name: 'Telefon',
      imageUrl: 'http://minio/telefon.jpg',
      ...PHYS,
    });

    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: ProductStatus.PENDING_REVIEW }),
    );
    expect(searchClient.emit).toHaveBeenCalledWith(
      'catalog.product.changed',
      expect.objectContaining({ productId: '10', active: false }),
    );
    expect(searchClient.emit.mock.calls[0][1]).not.toHaveProperty('shopName');
  });

  it('seller uchun slug va ownership bilan mahsulot yaratadi; narx berilmasa — bazaviy narx', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      ownerUserId: '42',
      ...CONTRACT,
    });
    categoryRepo.findOne.mockResolvedValue({ id: '3', isActive: true });
    productRepo.findOne.mockResolvedValue(null);

    await service.create('42', {
      name: 'O‘yin telefoni',
      categoryId: '3',
      imageUrl: 'http://minio/oyin-telefoni.jpg',
      ...PHYS,
    });

    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: '5',
        ownerUserId: '42',
        slug: 'oyin-telefoni',
        price: 140000,
        basePrice: 140000,
        weightGrams: 450,
        lengthMm: 200,
        widthMm: 120,
        heightMm: 80,
        cpaEnabled: true,
        isBad: false,
        status: ProductStatus.PENDING_REVIEW,
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

  it('BE-07 TC4: slug global — boshqa optovikda ham band bo‘lsa yangi slug', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      ownerUserId: '42',
      ...CONTRACT,
    });
    productRepo.findOne
      .mockResolvedValueOnce({ id: '1', shopId: '77', slug: 'iphone' })
      .mockResolvedValueOnce(null);

    await service.create('42', {
      name: 'iPhone',
      imageUrl: 'http://minio/iphone.jpg',
      ...PHYS,
    });

    expect(productRepo.findOne).toHaveBeenNthCalledWith(1, {
      where: { slug: 'iphone' },
    });
    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'iphone-2' }),
    );
  });

  it('mavjud bo‘lmagan kategoriya bilan yaratishni bloklaydi', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      ownerUserId: '42',
      ...CONTRACT,
    });
    categoryRepo.findOne.mockResolvedValue(null);

    await expect(
      service.create('42', {
        name: 'Telefon',
        categoryId: '404',
        imageUrl: 'http://minio/telefon.jpg',
        ...PHYS,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(productRepo.save).not.toHaveBeenCalled();
  });

  it('rasmsiz mahsulot yaratishni 400 bilan bloklaydi', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      ownerUserId: '42',
      ...CONTRACT,
    });
    productRepo.findOne.mockResolvedValue(null);

    await expect(
      service.create('42', { name: 'Telefon', ...PHYS }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(productRepo.save).not.toHaveBeenCalled();
  });

  it.each(['weightGrams', 'lengthMm', 'widthMm', 'heightMm'] as const)(
    'BE-07 TC3: %s siz mahsulot saqlanmaydi — 400',
    async (field) => {
      shopRepo.findOne.mockResolvedValue({
        id: '5',
        ownerUserId: '42',
        ...CONTRACT,
      });
      productRepo.findOne.mockResolvedValue(null);
      const dto = { name: 'Telefon', imageUrl: 'http://minio/t.jpg', ...PHYS };
      delete (dto as Record<string, unknown>)[field];
      await expect(service.create('42', dto as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(productRepo.save).not.toHaveBeenCalled();
    },
  );

  it('BE-07 OPT-1: shartnomasiz optovikka mahsulot qo‘shib bo‘lmaydi — 409', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '9',
      ownerUserId: null,
      isDeleted: false,
      contractNumber: null,
      contractDate: null,
    });
    await expect(
      service.adminCreate('9', {
        wholesalerId: '9',
        name: 'Telefon',
        imageUrl: 'http://minio/t.jpg',
        ...PHYS,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(productRepo.save).not.toHaveBeenCalled();
  });

  it('gallerydagi birinchi yaroqli rasmni asosiy rasm qiladi', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      ownerUserId: '42',
      ...CONTRACT,
    });
    productRepo.findOne.mockResolvedValue(null);

    await service.create('42', {
      name: 'Telefon',
      images: ['  ', ' http://minio/telefon.jpg '],
      ...PHYS,
    });

    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'http://minio/telefon.jpg',
        images: ['http://minio/telefon.jpg'],
      }),
    );
  });

  it('BE-07 TC1/TC5/TC7: admin foydalanuvchisiz optovik nomidan mahsulot qo‘shadi, BAD belgisi bilan', async () => {
    shopRepo.findOne.mockResolvedValue({
      id: '9',
      ownerUserId: null,
      name: 'Gadget Trade',
      isDeleted: false,
      ...CONTRACT,
    });
    productRepo.findOne.mockResolvedValue(null);

    await service.adminCreate('9', {
      wholesalerId: '9',
      name: 'Telefon',
      imageUrl: 'https://cdn.example.com/telefon.jpg',
      affiliateFee: 65000,
      isBad: true,
      ...PHYS,
    });

    expect(shopRepo.findOne).toHaveBeenCalledWith({
      where: { id: '9', isDeleted: false },
    });
    expect(productRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: '9',
        ownerUserId: null,
        name: 'Telefon',
        affiliateFee: 65000,
        isBad: true,
        status: ProductStatus.PENDING_REVIEW,
      }),
    );
  });

  describe('BE-07: moderatsiya', () => {
    const pending = (over: Record<string, unknown> = {}) => ({
      id: '10',
      shopId: '9',
      name: 'Telefon',
      slug: 'telefon',
      status: ProductStatus.PENDING_REVIEW,
      isBlocked: false,
      isDeleted: false,
      cpaEnabled: true,
      isBad: false,
      moderationNote: null,
      ...PHYS,
      ...over,
    });
    beforeEach(() => {
      shopRepo.findOne.mockResolvedValue({
        id: '9',
        name: 'Gadget Trade',
        status: ShopStatus.ACTIVE,
        isDeleted: false,
      });
      (variantRepo as any).count = jest.fn(async () => 1);
    });

    it('TC2: tasdiq — ACTIVE, qidiruvga chiqadi', async () => {
      productRepo.findOne.mockResolvedValue(pending());
      const saved = await service.adminApprove('10');
      expect(saved).toMatchObject({
        status: ProductStatus.ACTIVE,
        moderationNote: null,
      });
      expect(searchClient.emit).toHaveBeenCalledWith(
        'catalog.product.changed',
        expect.objectContaining({ productId: '10', active: true }),
      );
    });

    it('og‘irliksiz eski mahsulotni tasdiqlab bo‘lmaydi — 400', async () => {
      productRepo.findOne.mockResolvedValue(pending({ weightGrams: null }));
      await expect(service.adminApprove('10')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('tasdiqlangan mahsulotni qayta tasdiqlash — 409', async () => {
      productRepo.findOne.mockResolvedValue(
        pending({ status: ProductStatus.ACTIVE }),
      );
      await expect(service.adminApprove('10')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('TC6: CPA mahsulotida ikki faol variant bo‘lsa tasdiqlanmaydi — 400', async () => {
      (variantRepo as any).count = jest.fn(async () => 2);
      productRepo.findOne.mockResolvedValue(pending());
      await expect(service.adminApprove('10')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rad — REJECTED, sabab saqlanadi, qidiruvdan chiqadi', async () => {
      productRepo.findOne.mockResolvedValue(pending());
      const saved = await service.adminReject('10', '  Rasm sifatsiz  ');
      expect(saved).toMatchObject({
        status: ProductStatus.REJECTED,
        moderationNote: 'Rasm sifatsiz',
      });
      expect(searchClient.emit).toHaveBeenCalledWith(
        'catalog.product.changed',
        expect.objectContaining({ productId: '10', active: false }),
      );
    });

    it('TC7: admin BAD belgisini va CPA ni o‘zgartiradi; holat tahrirda o‘zgarmaydi', async () => {
      productRepo.findOne
        .mockResolvedValueOnce(pending())
        .mockResolvedValue(null);
      const saved = await service.adminUpdate('10', {
        isBad: true,
        cpaEnabled: false,
        affiliateFee: 65000,
      });
      expect(saved).toMatchObject({
        isBad: true,
        cpaEnabled: false,
        affiliateFee: 65000,
        status: ProductStatus.PENDING_REVIEW,
      });
    });
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

  it('C4.5: admin suspend mahsulotni bloklaydi va searchdan yashiradi', async () => {
    const product = {
      id: '10',
      shopId: '5',
      ownerUserId: '42',
      name: 'Telefon',
      status: ProductStatus.ACTIVE,
      isBlocked: false,
      isDeleted: false,
    };
    productRepo.findOne.mockResolvedValue(product);

    await expect(service.adminSuspend('10')).resolves.toMatchObject({
      isBlocked: true,
    });
    expect(searchClient.emit).toHaveBeenCalledWith(
      'catalog.product.changed',
      expect.objectContaining({ productId: '10', active: false }),
    );
  });

  it('C6.6 TC1/TC2/TC4: admin hide storefront/searchdan yashiradi va sellerga sabab yuboradi', async () => {
    const product = {
      id: '10',
      shopId: '5',
      ownerUserId: '42',
      name: 'Telefon',
      status: ProductStatus.ACTIVE,
      isBlocked: false,
      isDeleted: false,
    };
    productRepo.findOne.mockResolvedValue(product);

    await expect(
      service.adminHide('10', 'Rasm qoidalarga zid'),
    ).resolves.toMatchObject({ isBlocked: true });
    expect(searchClient.emit).toHaveBeenCalledWith(
      'catalog.product.changed',
      expect.objectContaining({ productId: '10', active: false }),
    );
    expect(notificationClient.emit).toHaveBeenCalledWith('product.hidden', {
      sellerUserId: '42',
      productId: '10',
      productName: 'Telefon',
      shopId: '5',
      reason: 'Rasm qoidalarga zid',
    });
  });

  it('C4.5: admin reactivate mahsulotni qayta indekslaydi', async () => {
    const product = {
      id: '10',
      shopId: '5',
      name: 'Telefon',
      status: ProductStatus.ACTIVE,
      isBlocked: true,
      isDeleted: false,
    };
    productRepo.findOne.mockResolvedValue(product);
    shopRepo.findOne.mockResolvedValue({
      id: '5',
      name: 'Market',
      status: ShopStatus.ACTIVE,
      isDeleted: false,
    });

    await expect(service.adminReactivate('10')).resolves.toMatchObject({
      isBlocked: false,
    });
    expect(searchClient.emit).toHaveBeenCalledWith(
      'catalog.product.changed',
      expect.objectContaining({ productId: '10', active: true }),
    );
  });

  it('C4.5: noto‘g‘ri product moderatsiya holati 409', async () => {
    productRepo.findOne.mockResolvedValue({
      id: '10',
      isBlocked: true,
      isDeleted: false,
    });
    await expect(service.adminSuspend('10')).rejects.toBeInstanceOf(
      ConflictException,
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
