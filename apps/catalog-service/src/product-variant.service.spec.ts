import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProductVariantService } from './product-variant.service';

describe('ProductVariantService', () => {
  let products: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let variants: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    merge: jest.Mock;
    save: jest.Mock;
  };
  let service: ProductVariantService;

  const product = {
    id: '10',
    ownerUserId: '42',
    hasVariants: false,
    isDeleted: false,
  };

  beforeEach(() => {
    products = {
      findOne: jest.fn().mockResolvedValue({ ...product }),
      save: jest.fn(async (value) => value),
    };
    variants = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((value) => value),
      merge: jest.fn((target, dto) => Object.assign(target, dto)),
      save: jest.fn(async (value) => ({ id: value.id ?? '20', ...value })),
    };
    service = new ProductVariantService(products as any, variants as any);
  });

  it('custom variant yaratadi, defaultni o‘chiradi va hasVariants=true qiladi', async () => {
    variants.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: '11',
      productId: '10',
      sku: 'PRODUCT-10-DEFAULT',
      isActive: true,
      isDeleted: false,
    });

    await expect(
      service.createVariant('42', '10', {
        sku: 'PHONE-BLACK',
        name: 'Qora',
        attributes: { color: 'Qora' },
        price: null,
      }),
    ).resolves.toMatchObject({
      productId: '10',
      sku: 'PHONE-BLACK',
      price: null,
    });

    expect(variants.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'PRODUCT-10-DEFAULT',
        isActive: false,
      }),
    );
    expect(products.save).toHaveBeenCalledWith(
      expect.objectContaining({ hasVariants: true }),
    );
  });

  it('duplicate SKU uchun 409 qaytaradi', async () => {
    variants.findOne.mockResolvedValue({ id: '99', sku: 'PHONE-BLACK' });

    await expect(
      service.createVariant('42', '10', { sku: 'PHONE-BLACK' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(variants.save).not.toHaveBeenCalled();
  });

  it('boshqa seller mahsulotiga variant qo‘shishni 403 bilan bloklaydi', async () => {
    products.findOne.mockResolvedValue({ ...product, ownerUserId: '99' });

    await expect(
      service.createVariant('42', '10', { sku: 'PHONE-BLACK' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mavjud bo‘lmagan variant uchun 404 qaytaradi', async () => {
    variants.findOne.mockResolvedValue(null);

    await expect(service.getVariant('42', '10', '404')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('oxirgi custom variant o‘chirilganda defaultni yoqadi', async () => {
    const customVariant = {
      id: '20',
      productId: '10',
      sku: 'PHONE-BLACK',
      isActive: true,
      isDeleted: false,
    };
    const defaultVariant = {
      id: '11',
      productId: '10',
      sku: 'PRODUCT-10-DEFAULT',
      isActive: false,
      isDeleted: false,
    };
    variants.findOne
      .mockResolvedValueOnce(customVariant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(defaultVariant);

    await expect(
      service.deleteProductVariant('42', '10', '20'),
    ).resolves.toEqual({ id: '20', deleted: true });
    expect(variants.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'PRODUCT-10-DEFAULT',
        isActive: true,
      }),
    );
    expect(products.save).toHaveBeenCalledWith(
      expect.objectContaining({ hasVariants: false }),
    );
  });

  it('default variantni o‘chirishni bloklaydi', async () => {
    variants.findOne.mockResolvedValue({
      id: '11',
      productId: '10',
      sku: 'PRODUCT-10-DEFAULT',
      isActive: true,
      isDeleted: false,
    });

    await expect(
      service.deleteProductVariant('42', '10', '11'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
