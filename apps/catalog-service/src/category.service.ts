import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  CategoryTreeDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '@app/common';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  async getPublicTree(): Promise<CategoryTreeDto[]> {
    const categories = await this.categories.find({
      where: { isDeleted: false, isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return this.buildTree(categories);
  }

  async getAdminTree(): Promise<CategoryTreeDto[]> {
    const categories = await this.categories.find({
      where: { isDeleted: false },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return this.buildTree(categories);
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    const slug = this.toSlug(dto.name);
    await this.ensureSlugAvailable(slug);
    await this.ensureParentExists(dto.parentId);

    const category = this.categories.create({
      name: dto.name.trim(),
      slug,
      parentId: dto.parentId ?? null,
      iconUrl: dto.iconUrl ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.save(category);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.getById(id);

    if (dto.parentId !== undefined) {
      await this.ensureValidParent(id, dto.parentId);
    }

    if (dto.name !== undefined) {
      const slug = this.toSlug(dto.name);
      await this.ensureSlugAvailable(slug, id);
      category.name = dto.name.trim();
      category.slug = slug;
    }

    if (dto.parentId !== undefined) category.parentId = dto.parentId;
    if (dto.iconUrl !== undefined) category.iconUrl = dto.iconUrl;
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;

    return this.save(category);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const category = await this.getById(id);
    const child = await this.categories.findOne({
      where: { parentId: id, isDeleted: false },
    });
    if (child) {
      throw new ConflictException(
        'Ichki kategoriyalari bor kategoriyani o‘chirib bo‘lmaydi',
      );
    }

    category.isDeleted = true;
    await this.categories.save(category);
    return { id, deleted: true };
  }

  private async getById(id: string): Promise<Category> {
    const category = await this.categories.findOne({
      where: { id, isDeleted: false },
    });
    if (!category) throw new NotFoundException('Kategoriya topilmadi');
    return category;
  }

  private async ensureParentExists(parentId?: string | null): Promise<void> {
    if (parentId == null) return;
    await this.getById(parentId);
  }

  private async ensureValidParent(
    categoryId: string,
    parentId: string | null,
  ): Promise<void> {
    if (parentId == null) return;
    if (parentId === categoryId) {
      throw new BadRequestException('Kategoriya o‘ziga parent bo‘la olmaydi');
    }

    let current = await this.getById(parentId);
    const visited = new Set<string>();
    while (current.parentId) {
      if (current.parentId === categoryId) {
        throw new BadRequestException(
          'Kategoriya daraxtida sikl hosil qilib bo‘lmaydi',
        );
      }
      if (visited.has(current.id)) {
        throw new BadRequestException('Kategoriya daraxtida sikl mavjud');
      }
      visited.add(current.id);
      current = await this.getById(current.parentId);
    }
  }

  private async ensureSlugAvailable(
    slug: string,
    ignoredId?: string,
  ): Promise<void> {
    const existing = await this.categories.findOne({ where: { slug } });
    if (existing && existing.id !== ignoredId) {
      throw new ConflictException('Bunday slug bilan kategoriya mavjud');
    }
  }

  private async save(category: Category): Promise<Category> {
    try {
      return await this.categories.save(category);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException('Bunday slug bilan kategoriya mavjud');
      }
      throw error;
    }
  }

  private toSlug(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[ʻʼ’‘`]/g, "'")
      .replace(/o'/g, 'o')
      .replace(/g'/g, 'g')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!slug) {
      throw new BadRequestException(
        'Kategoriya nomidan yaroqli slug hosil qilib bo‘lmadi',
      );
    }
    return slug;
  }

  private buildTree(categories: Category[]): CategoryTreeDto[] {
    const nodes = new Map<string, CategoryTreeDto>();
    for (const category of categories) {
      nodes.set(category.id, {
        id: category.id,
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
        iconUrl: category.iconUrl,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        children: [],
      });
    }

    const roots: CategoryTreeDto[] = [];
    for (const category of categories) {
      const node = nodes.get(category.id)!;
      if (category.parentId === null) {
        roots.push(node);
      } else {
        nodes.get(category.parentId)?.children.push(node);
      }
    }
    return roots;
  }
}
