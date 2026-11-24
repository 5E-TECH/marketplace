import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';

type RepositoryMock = Pick<
  jest.Mocked<Repository<Category>>,
  'find' | 'findOne' | 'create' | 'save'
>;

const category = (
  id: string,
  name: string,
  parentId: string | null = null,
  overrides: Partial<Category> = {},
): Category =>
  ({
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    parentId,
    iconUrl: null,
    sortOrder: 0,
    isActive: true,
    isDeleted: false,
    ...overrides,
  }) as Category;

describe('CategoryService', () => {
  let repository: RepositoryMock;
  let service: CategoryService;
  let productCount: jest.Mock;

  beforeEach(() => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((value) => value as Category),
      save: jest.fn(async (value) => value as Category),
      manager: { count: (productCount = jest.fn(async () => 0)) },
    } as unknown as RepositoryMock;
    service = new CategoryService(
      repository as unknown as Repository<Category>,
    );
  });

  it('public kategoriyalarni parent → children daraxtiga aylantiradi', async () => {
    repository.find.mockResolvedValue([
      category('1', 'Elektronika'),
      category('2', 'Telefonlar', '1'),
      category('3', 'Smartfonlar', '2'),
    ]);

    await expect(service.getPublicTree()).resolves.toEqual([
      expect.objectContaining({
        id: '1',
        children: [
          expect.objectContaining({
            id: '2',
            children: [expect.objectContaining({ id: '3', children: [] })],
          }),
        ],
      }),
    ]);
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isDeleted: false, isActive: true },
      }),
    );
  });

  it('parent bilan yaratadi va nomdan slug hosil qiladi', async () => {
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(category('1', 'Elektronika'));

    await service.create({
      name: 'O‘yin qurilmalari',
      parentId: '1',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'O‘yin qurilmalari',
        slug: 'oyin-qurilmalari',
        parentId: '1',
      }),
    );
  });

  it('takroriy slug uchun 409 qaytaradi', async () => {
    repository.findOne.mockResolvedValue(category('1', 'Telefonlar'));

    await expect(service.create({ name: 'Telefonlar' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('mavjud bo‘lmagan parent uchun 404 qaytaradi', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.create({ name: 'Telefonlar', parentId: '404' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('descendantni parent qilib sikl hosil qilishni bloklaydi', async () => {
    repository.findOne
      .mockResolvedValueOnce(category('1', 'Root'))
      .mockResolvedValueOnce(category('2', 'Child', '1'));

    await expect(service.update('1', { parentId: '2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bolasi bor kategoriyani o‘chirishni bloklaydi', async () => {
    repository.findOne
      .mockResolvedValueOnce(category('1', 'Root'))
      .mockResolvedValueOnce(category('2', 'Child', '1'));

    await expect(service.remove('1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('bolasi yo‘q kategoriyani soft-delete qiladi', async () => {
    const target = category('1', 'Root');
    repository.findOne
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);

    await expect(service.remove('1')).resolves.toEqual({
      id: '1',
      deleted: true,
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', isDeleted: true }),
    );
  });

  it('BE-25: mahsuloti bor kategoriyani o‘chirish — 409, o‘chirilmaydi', async () => {
    repository.findOne
      .mockResolvedValueOnce(category('1', 'Root'))
      .mockResolvedValueOnce(null);
    productCount.mockResolvedValueOnce(2);

    await expect(service.remove('1')).rejects.toMatchObject({
      status: 409,
      message: 'Mahsuloti bor kategoriyani o‘chirib bo‘lmaydi',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('BE-25: berilgan slug nomdan hosil qilingani o‘rniga; belgilar saqlanadi, berilmasa — null (meros)', async () => {
    repository.findOne.mockResolvedValue(null);
    await service.create({ name: 'Uy-ro‘zg‘or', slug: 'uy', isBad: false });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'uy',
        isBad: false,
        expiryTracked: null,
      }),
    );
  });

  it('BE-25: faqat slug yoki faqat belgi o‘zgaradi; null — ota toifadan', async () => {
    const target = category('1', 'Kosmetika', null, {
      isBad: true,
      expiryTracked: true,
    });
    repository.findOne
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null);
    await service.update('1', { slug: 'kosmetika-2' });
    expect(target).toMatchObject({
      name: 'Kosmetika',
      slug: 'kosmetika-2',
      isBad: true,
    });
    repository.findOne.mockResolvedValueOnce(target);
    await service.update('1', { isBad: null, expiryTracked: false });
    expect(target).toMatchObject({
      slug: 'kosmetika-2',
      isBad: null,
      expiryTracked: false,
    });
  });

  it('BE-25: slug band — 409', async () => {
    repository.findOne
      .mockResolvedValueOnce(category('1', 'Kosmetika'))
      .mockResolvedValueOnce(category('2', 'Parfyumeriya'));
    await expect(
      service.update('1', { slug: 'parfyumeriya' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('BE-25: daraxtda toifaning o‘z belgilari (null — meros)', async () => {
    repository.find.mockResolvedValue([
      category('1', 'BAD', null, { isBad: true, expiryTracked: null }),
    ]);
    await expect(service.getAdminTree()).resolves.toEqual([
      expect.objectContaining({ isBad: true, expiryTracked: null }),
    ]);
  });
});
