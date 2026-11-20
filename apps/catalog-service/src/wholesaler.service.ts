import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import {
  AdminWholesalersQueryDto,
  CreateWholesalerDto,
  ShopStatus,
  UpdateWholesalerDto,
  WholesalerDto,
  WholesalerPageDto,
} from '@app/common';
import { Shop } from './entities/shop.entity';

/**
 * BE-07: optovik (TZ 6.9, OPT-1). Ishga tushishda admin kiritadi (FE-25) — foydalanuvchisiz, rekvizitlar va
 * shartnoma bilan. Yozuv `catalog.shop` jadvalida (mahsulot, buyurtma va ombor shu ID ga bog‘langan).
 */
@Injectable()
export class WholesalerService {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
  ) {}

  async create(dto: CreateWholesalerDto): Promise<WholesalerDto> {
    const shop = this.shops.create({
      ownerUserId: null,
      name: dto.name,
      // Nom + STIR: bir xil optovikni ikki marta kiritish 409 beradi (uq_catalog_shop_slug)
      slug: `${slugify(dto.name)}-${dto.tin}`,
      description: dto.description ?? null,
      status: ShopStatus.ACTIVE, // admin kiritdi — tasdiq shu
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      legalType: dto.legalType,
      tin: dto.tin,
      bankName: dto.bankName,
      bankAccount: dto.bankAccount,
      bankMfo: dto.bankMfo,
      contractNumber: dto.contractNumber,
      contractDate: dto.contractDate,
    });
    return this.view(await this.save(shop));
  }

  async list(query: AdminWholesalersQueryDto): Promise<WholesalerPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.shops
      .createQueryBuilder('shop')
      .where('shop.is_deleted = FALSE');
    const search = query.search?.trim();
    if (search)
      qb.andWhere(
        new Brackets((w) =>
          w.where('shop.name ILIKE :search').orWhere('shop.tin = :tin'),
        ),
        { search: `%${search}%`, tin: search },
      );
    const [rows, total] = await qb
      .orderBy('shop.createdAt', 'DESC')
      .addOrderBy('shop.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items: rows.map((row) => this.view(row)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async get(id: string): Promise<WholesalerDto> {
    return this.view(await this.find(id));
  }

  async update(id: string, dto: UpdateWholesalerDto): Promise<WholesalerDto> {
    const shop = await this.find(id);
    const fields = [
      'name',
      'legalType',
      'tin',
      'bankName',
      'bankAccount',
      'bankMfo',
      'contractNumber',
      'contractDate',
      'phone',
      'address',
      'description',
    ] as const;
    for (const field of fields)
      if (dto[field] !== undefined)
        (shop as unknown as Record<string, unknown>)[field] = dto[field];
    return this.view(await this.save(shop));
  }

  private async find(id: string): Promise<Shop> {
    const shop = await this.shops.findOne({
      where: { id: String(id), isDeleted: false },
    });
    if (!shop) throw new NotFoundException('Optovik topilmadi');
    return shop;
  }

  private async save(shop: Shop): Promise<Shop> {
    try {
      return await this.shops.save(shop);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      )
        throw new ConflictException('Bunday optovik allaqachon bor');
      throw error;
    }
  }

  private view(shop: Shop): WholesalerDto {
    return {
      id: String(shop.id),
      name: shop.name,
      slug: shop.slug,
      status: shop.status,
      legalType: shop.legalType,
      tin: shop.tin,
      bankName: shop.bankName,
      bankAccount: shop.bankAccount,
      bankMfo: shop.bankMfo,
      contractNumber: shop.contractNumber,
      contractDate: shop.contractDate,
      phone: shop.phone,
      address: shop.address,
      description: shop.description,
      ownerUserId: shop.ownerUserId ?? null,
      createdAt: shop.createdAt,
    };
  }
}

/** OPT-1: komissiya shartnomasi kiritilganmi (raqami va sanasi). Shartnomasiz mahsulot qo‘shib bo‘lmaydi. */
export const hasContract = (
  shop: Pick<Shop, 'contractNumber' | 'contractDate'>,
) => !!shop.contractNumber?.trim() && !!shop.contractDate;

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[ʻʼ’‘`]/g, "'")
      .replace(/o'/g, 'o')
      .replace(/g'/g, 'g')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'optovik'
  );
}
