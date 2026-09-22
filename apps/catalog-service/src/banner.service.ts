import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BannerDto,
  CreateBannerDto,
  ReorderBannersDto,
  StorefrontBannerDto,
  UpdateBannerDto,
} from '@app/common';
import { Banner } from './entities/banner.entity';

@Injectable()
export class BannerService {
  constructor(
    @InjectRepository(Banner)
    private readonly banners: Repository<Banner>,
  ) {}

  /** Admin ro'yxati — nofaol va muddati tugaganlari ham ko'rinadi. */
  async adminList(): Promise<BannerDto[]> {
    const rows = await this.banners.find({
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const now = new Date();
    return rows.map((banner) => this.toAdminDto(banner, now));
  }

  /**
   * Storefront bosh sahifasi. Muddat filtri SQL'da — muddati tugagan banner
   * hech qachon javobga tushmaydi, cron yoki qo'lda o'chirish kerak emas.
   */
  async storefrontList(): Promise<StorefrontBannerDto[]> {
    const rows = await this.banners
      .createQueryBuilder('banner')
      .where('banner.isActive = true')
      .andWhere('(banner.startsAt IS NULL OR banner.startsAt <= now())')
      .andWhere('(banner.endsAt IS NULL OR banner.endsAt > now())')
      .orderBy('banner.sortOrder', 'ASC')
      .addOrderBy('banner.id', 'ASC')
      .getMany();
    return rows.map((banner) => this.toPublicDto(banner));
  }

  async create(dto: CreateBannerDto): Promise<BannerDto> {
    const startsAt = this.toDate(dto.startsAt);
    const endsAt = this.toDate(dto.endsAt);
    this.assertPeriod(startsAt, endsAt);
    const banner = this.banners.create({
      title: dto.title.trim(),
      imageUrl: dto.imageUrl.trim(),
      linkUrl: dto.linkUrl?.trim() || null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      startsAt,
      endsAt,
    });
    return this.toAdminDto(await this.banners.save(banner));
  }

  async update(id: string, dto: UpdateBannerDto): Promise<BannerDto> {
    const banner = await this.getById(id);
    if (dto.title !== undefined) banner.title = dto.title.trim();
    if (dto.imageUrl !== undefined) banner.imageUrl = dto.imageUrl.trim();
    if (dto.linkUrl !== undefined) banner.linkUrl = dto.linkUrl?.trim() || null;
    if (dto.sortOrder !== undefined) banner.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) banner.isActive = dto.isActive;
    if (dto.startsAt !== undefined) banner.startsAt = this.toDate(dto.startsAt);
    if (dto.endsAt !== undefined) banner.endsAt = this.toDate(dto.endsAt);
    this.assertPeriod(banner.startsAt, banner.endsAt);
    return this.toAdminDto(await this.banners.save(banner));
  }

  /**
   * Drag-and-drop tartibi: panel butun ro'yxatni yangi `sortOrder` bilan
   * yuboradi. Bittasi ham topilmasa hech narsa saqlanmaydi — yarim
   * qo'llanilgan tartib qolmasligi kerak.
   */
  async reorder(dto: ReorderBannersDto): Promise<BannerDto[]> {
    const ids = dto.items.map((item) => String(item.id));
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Bir banner ikki marta berilgan');
    const found = await this.banners.find({ where: { id: In(ids) } });
    if (found.length !== ids.length)
      throw new NotFoundException('Bannerlardan biri topilmadi');

    const orderById = new Map(
      dto.items.map((item) => [String(item.id), item.sortOrder]),
    );
    for (const banner of found) banner.sortOrder = orderById.get(banner.id)!;
    await this.banners.save(found);
    return this.adminList();
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const banner = await this.getById(id);
    await this.banners.remove(banner);
    return { id, deleted: true };
  }

  private async getById(id: string): Promise<Banner> {
    if (!/^[1-9]\d{0,18}$/.test(String(id)))
      throw new NotFoundException('Banner topilmadi');
    const banner = await this.banners.findOne({ where: { id: String(id) } });
    if (!banner) throw new NotFoundException('Banner topilmadi');
    return banner;
  }

  private toDate(value?: string | null): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new BadRequestException('Sana formati noto‘g‘ri');
    return date;
  }

  private assertPeriod(startsAt: Date | null, endsAt: Date | null): void {
    if (startsAt && endsAt && endsAt <= startsAt)
      throw new BadRequestException(
        'Tugash vaqti boshlanish vaqtidan keyin bo‘lishi kerak',
      );
  }

  /** Shu daqiqada storefront’da ko‘rinadimi — panelda holat ustuni uchun. */
  private visible(banner: Banner, now: Date): boolean {
    if (!banner.isActive) return false;
    if (banner.startsAt && banner.startsAt > now) return false;
    if (banner.endsAt && banner.endsAt <= now) return false;
    return true;
  }

  private toPublicDto(banner: Banner): StorefrontBannerDto {
    return {
      id: String(banner.id),
      title: banner.title,
      imageUrl: banner.imageUrl,
      linkUrl: banner.linkUrl,
      sortOrder: banner.sortOrder,
    };
  }

  private toAdminDto(banner: Banner, now = new Date()): BannerDto {
    return {
      ...this.toPublicDto(banner),
      isActive: banner.isActive,
      startsAt: banner.startsAt,
      endsAt: banner.endsAt,
      isVisible: this.visible(banner, now),
      createdAt: banner.createdAt,
      updatedAt: banner.updatedAt,
    };
  }
}
