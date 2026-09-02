import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { AdminShopsQueryDto, RmqClient, ShopStatus } from '@app/common';
import { Shop } from './entities/shop.entity';
import { Product } from './entities/product.entity';

/**
 * Admin do'kon moderatsiyasi (C1.7). list / approve / publish-approved / reject.
 * approve → status ACTIVE (event YO'Q). `shop.approved` event alohida
 * `publishShopApproved` orqali — gateway uni approve orkestratsiyasi OXIRIDA
 * (user faollashtirilib, default ombor tayyor bo'lgach) chaqiradi, shunda event
 * tarqalganda lokal holat izchil bo'ladi. reject → REJECTED + `shop.rejected`.
 * User faollashtirish + default ombor — gateway orkestratsiyasida (bu yerda EMAS).
 */
@Injectable()
export class AdminShopService {
  private readonly logger = new Logger(AdminShopService.name);

  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
  ) {}

  async adminList(query: AdminShopsQueryDto) {
    const page = Math.max(1, Number(query?.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit ?? 20)));

    const qb = this.shops
      .createQueryBuilder('shop')
      .where('shop.is_deleted = FALSE');
    if (query?.status) {
      qb.andWhere('shop.status = :status', { status: query.status });
    }
    if (query?.search?.trim()) {
      qb.andWhere('shop.name ILIKE :s', { s: `%${query.search.trim()}%` });
    }
    qb.orderBy('shop.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * C1.28 — do'konlar sonini holat bo'yicha (admin dashboard uchun). Yangi
   * platformada barcha son 0 (groupBy hech nima qaytarmaydi → base 0'lar).
   */
  async countByStatus(): Promise<{
    total: number;
    PENDING: number;
    ACTIVE: number;
    SUSPENDED: number;
    REJECTED: number;
  }> {
    const rows = await this.shops
      .createQueryBuilder('shop')
      .select('shop.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('shop.is_deleted = FALSE')
      .groupBy('shop.status')
      .getRawMany<{ status: string; count: string }>();

    const base = { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 };
    let total = 0;
    for (const row of rows) {
      const n = Number(row.count);
      total += n;
      if (row.status in base) {
        base[row.status as keyof typeof base] = n;
      }
    }
    return { total, ...base };
  }

  async adminApprove(shopId: string): Promise<Shop> {
    const shop = await this.getById(shopId);
    if (shop.status === ShopStatus.ACTIVE) {
      return shop; // idempotent
    }
    shop.status = ShopStatus.ACTIVE;
    return this.shops.save(shop);
  }

  async adminDetail(shopId: string) {
    const shop = await this.getById(shopId);
    const products = await this.products.count({
      where: { shopId: shop.id, isDeleted: false },
    });
    return { shop, products };
  }

  async adminSuspend(shopId: string): Promise<Shop> {
    const shop = await this.getById(shopId);
    if (shop.status !== ShopStatus.ACTIVE) {
      throw new ConflictException(
        'Faqat ACTIVE do‘konni suspend qilish mumkin',
      );
    }
    shop.status = ShopStatus.SUSPENDED;
    return this.shops.save(shop);
  }

  async adminActivate(shopId: string): Promise<Shop> {
    const shop = await this.getById(shopId);
    if (shop.status !== ShopStatus.SUSPENDED) {
      throw new ConflictException(
        'Faqat SUSPENDED do‘konni qayta faollashtirish mumkin',
      );
    }
    shop.status = ShopStatus.ACTIVE;
    return this.shops.save(shop);
  }

  /**
   * `shop.approved` event'ni chiqaradi (HAM notification, HAM elchi-integration —
   * har biri o'z queue'sida tinglaydi, shu bois IKKALASIGA emit qilinadi).
   * Gateway buni approve OXIRIDA — user faollashtirilib, default ombor tayyor
   * bo'lgach — chaqiradi (emit-after-consistency). Consumer'lar idempotent, shu
   * bois qayta chaqirilsa ham xavfsiz (at-least-once).
   */
  async publishShopApproved(payload: {
    sellerUserId: string;
    shopId: string;
    shopName?: string;
    phone?: string | null;
  }): Promise<void> {
    await this.emit(this.notifications, 'shop.approved', payload);
    await this.emit(this.integration, 'shop.approved', payload);
  }

  async adminReject(shopId: string, reason?: string): Promise<Shop> {
    const shop = await this.getById(shopId);
    shop.status = ShopStatus.REJECTED;
    const saved = await this.shops.save(shop);

    await this.emit(this.notifications, 'shop.rejected', {
      sellerUserId: saved.ownerUserId,
      shopId: saved.id,
      shopName: saved.name,
      phone: saved.phone,
      reason: reason ?? null,
    });
    return saved;
  }

  private async getById(shopId: string): Promise<Shop> {
    const shop = await this.shops.findOne({
      where: { id: shopId, isDeleted: false },
    });
    if (!shop) {
      throw new NotFoundException('Do‘kon topilmadi');
    }
    return shop;
  }

  private async emit(
    client: ClientProxy,
    pattern: string,
    payload: unknown,
  ): Promise<void> {
    try {
      await firstValueFrom(client.emit(pattern, payload));
    } catch (error) {
      this.logger.warn(
        `${pattern} event yuborilmadi: ${(error as Error).message}`,
      );
    }
  }
}
