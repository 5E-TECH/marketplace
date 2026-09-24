import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BANNER_LINK_PATTERN,
  BannerDto,
  CreateBannerDto,
  MAX_BANNERS,
  PUBLIC_MEDIA_FOLDERS,
  ReorderBannersDto,
  STOREFRONT_BANNER_LIMIT,
  StorefrontBannerDto,
  UpdateBannerDto,
} from '@app/common';
import { Banner } from './entities/banner.entity';

const BIGINT_MAX = BigInt('9223372036854775807');

/** `bigint` ustuniga sig'adigan musbat id. Kattasi Postgres'da 500 berardi. */
export const isBannerId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value) <= BIGINT_MAX;

@Injectable()
export class BannerService {
  constructor(
    @InjectRepository(Banner)
    private readonly banners: Repository<Banner>,
    private readonly config: ConfigService,
  ) {}

  /** Admin ro'yxati — nofaol va muddati tugaganlari ham ko'rinadi. */
  async adminList(): Promise<BannerDto[]> {
    return this.list(this.banners);
  }

  /**
   * Storefront bosh sahifasi. Muddat filtri SQL'da — muddati tugagan banner
   * hech qachon javobga tushmaydi, cron yoki qo'lda o'chirish kerak emas.
   * Bosh sahifa cheksiz uzaymasligi uchun eng yuqoridagi
   * `STOREFRONT_BANNER_LIMIT` tasi qaytadi.
   */
  async storefrontList(): Promise<StorefrontBannerDto[]> {
    const rows = await this.banners
      .createQueryBuilder('banner')
      .where('banner.isActive = true')
      .andWhere('(banner.startsAt IS NULL OR banner.startsAt <= now())')
      .andWhere('(banner.endsAt IS NULL OR banner.endsAt > now())')
      .orderBy('banner.sortOrder', 'ASC')
      .addOrderBy('banner.id', 'ASC')
      .limit(STOREFRONT_BANNER_LIMIT)
      .getMany();
    return rows.map((banner) => this.toPublicDto(banner));
  }

  /**
   * Soni `MAX_BANNERS` bilan cheklangan — aks holda tartiblash so'rovi
   * (`ArrayMaxSize(MAX_BANNERS)`) 400 bera boshlardi. Advisory lock ikki
   * admin bir vaqtda oxirgi o'rinni egallab, chegaradan oshib ketishining
   * oldini oladi.
   */
  async create(dto: CreateBannerDto): Promise<BannerDto> {
    const title = this.requiredText(dto.title, 'Sarlavha');
    const imageUrl = this.mediaUrl(dto.imageUrl);
    const linkUrl = this.link(dto.linkUrl);
    const startsAt = this.toDate(dto.startsAt);
    const endsAt = this.toDate(dto.endsAt);
    this.assertPeriod(startsAt, endsAt);

    return this.banners.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'catalog:banner:create',
      ]);
      const repository = manager.getRepository(Banner);
      if ((await repository.count()) >= MAX_BANNERS) {
        throw new BadRequestException(
          `Bannerlar soni ${MAX_BANNERS} tadan oshmasligi kerak — keraksizlarini o‘chiring`,
        );
      }
      const saved = await repository.save(
        repository.create({
          title,
          imageUrl,
          linkUrl,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
          startsAt,
          endsAt,
        }),
      );
      return this.toAdminDto(saved);
    });
  }

  /**
   * Faqat yuborilgan maydonlar o'zgaradi. Qator qulflanadi — parallel
   * tahrirda muddat tekshiruvi eskirgan qiymatga tayanmasin. `save()` emas,
   * `UPDATE` ishlatiladi: o'chirilgan banner qaytadan yaratilib qolmasin.
   */
  async update(id: string, dto: UpdateBannerDto): Promise<BannerDto> {
    const patch: Partial<Banner> = {};
    if (dto.title != null)
      patch.title = this.requiredText(dto.title, 'Sarlavha');
    if (dto.imageUrl != null) patch.imageUrl = this.mediaUrl(dto.imageUrl);
    if (dto.linkUrl !== undefined) patch.linkUrl = this.link(dto.linkUrl);
    if (dto.sortOrder != null) patch.sortOrder = dto.sortOrder;
    if (dto.isActive != null) patch.isActive = dto.isActive;
    if (dto.startsAt !== undefined) patch.startsAt = this.toDate(dto.startsAt);
    if (dto.endsAt !== undefined) patch.endsAt = this.toDate(dto.endsAt);

    return this.banners.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Banner);
      const banner = await this.lockedById(repository, id);
      this.assertPeriod(
        patch.startsAt !== undefined ? patch.startsAt : banner.startsAt,
        patch.endsAt !== undefined ? patch.endsAt : banner.endsAt,
      );
      if (!Object.keys(patch).length) return this.toAdminDto(banner);
      await repository.update({ id: banner.id }, patch);
      const updated = await repository.findOneOrFail({
        where: { id: banner.id },
      });
      return this.toAdminDto(updated);
    });
  }

  /**
   * Panel butun ro'yxatni yangi `sortOrder` bilan yuboradi. Hammasi bitta
   * tranzaksiyada: bittasi topilmasa hech narsa saqlanmaydi. Qatorlar
   * qulflanadi, shuning uchun parallel o'chirish kutadi va o'chirilgan
   * banner tartiblash natijasida qayta paydo bo'lmaydi.
   */
  async reorder(dto: ReorderBannersDto): Promise<BannerDto[]> {
    const ids = dto.items.map((item) => String(item.id));
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Bir banner ikki marta berilgan');
    if (!ids.every(isBannerId))
      throw new NotFoundException('Bannerlardan biri topilmadi');

    return this.banners.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Banner);
      const found = await repository.find({
        where: { id: In(ids) },
        lock: { mode: 'pessimistic_write' },
      });
      if (found.length !== ids.length)
        throw new NotFoundException('Bannerlardan biri topilmadi');
      for (const item of dto.items) {
        await repository.update(
          { id: String(item.id) },
          { sortOrder: item.sortOrder },
        );
      }
      return this.list(repository);
    });
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.banners.manager.transaction(async (manager) => {
      const repository = manager.getRepository(Banner);
      const banner = await this.lockedById(repository, id);
      await repository.delete({ id: banner.id });
      return { id: banner.id, deleted: true };
    });
  }

  private async list(repository: Repository<Banner>): Promise<BannerDto[]> {
    const rows = await repository.find({
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const now = new Date();
    return rows.map((banner) => this.toAdminDto(banner, now));
  }

  private async lockedById(
    repository: Repository<Banner>,
    id: string,
  ): Promise<Banner> {
    const key = String(id);
    if (!isBannerId(key)) throw new NotFoundException('Banner topilmadi');
    const banner = await repository.findOne({
      where: { id: key },
      lock: { mode: 'pessimistic_write' },
    });
    if (!banner) throw new NotFoundException('Banner topilmadi');
    return banner;
  }

  /** Validatsiya kesishdan oldin ishlaydi — faqat bo'sh joydan iborat qiymat shu yerda ushlanadi. */
  private requiredText(value: string, label: string): string {
    const text = String(value).trim();
    if (!text)
      throw new BadRequestException(`${label} bo‘sh bo‘lmasligi kerak`);
    return text;
  }

  /**
   * Faqat platforma media omboridagi ochiq papkalardagi rasm. Boshqa hostdagi
   * rasmni storefront (`getSafeImageSrc`, next/image) ham, admin CSP ham
   * ko'rsatmaydi — oldin bu jimgina kulrang placeholder bo'lib chiqardi.
   */
  private mediaUrl(value: string): string {
    const raw = this.requiredText(value, 'Rasm manzili');
    const base = this.config
      .getOrThrow<string>('MINIO_PUBLIC_URL')
      .replace(/\/+$/, '');
    const bucket = this.config.get<string>('MINIO_BUCKET', 'marketplace-media');
    let url: URL;
    let root: URL;
    try {
      url = new URL(raw);
      root = new URL(`${base}/${bucket}/`);
    } catch {
      throw new BadRequestException('Rasm manzili noto‘g‘ri');
    }
    const inPublicFolder = PUBLIC_MEDIA_FOLDERS.some((folder) =>
      url.pathname.startsWith(`${root.pathname}${folder}/`),
    );
    if (url.origin !== root.origin || !inPublicFolder || url.search || url.hash)
      throw new BadRequestException(
        'Rasm admin paneldagi "Rasm yuklash" orqali yuklangan bo‘lishi kerak',
      );
    // URL normallashtirilgan holda saqlanadi (`..` segmentlari yechilgan).
    return url.toString();
  }

  private link(value: string | null | undefined): string | null {
    const href = value?.trim();
    if (!href) return null;
    if (!BANNER_LINK_PATTERN.test(href))
      throw new BadRequestException('Havola noto‘g‘ri');
    return href;
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
