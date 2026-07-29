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

  beforeEach(() => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((value) => value as Category),
      save: jest.fn(async (value) => value as Category),
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
});
