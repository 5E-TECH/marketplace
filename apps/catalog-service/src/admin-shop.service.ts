import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { AdminShopsQueryDto, RmqClient, ShopStatus } from '@app/common';
import { Shop } from './entities/shop.entity';

/**
 * Admin do'kon moderatsiyasi (C1.7). list / approve / reject.
 * approve → status ACTIVE + `shop.approved` event (HAM notification, HAM
 * elchi-integration — har biri o'z queue'sida tinglaydi, shu bois IKKALASIGA
 * emit qilinadi). reject → REJECTED + `shop.rejected` (notification).
 * User faollashtirish + default ombor — gateway orkestratsiyasida (bu yerda EMAS).
 */
@Injectable()
export class AdminShopService {
  private readonly logger = new Logger(AdminShopService.name);

  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
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

  async adminApprove(shopId: string): Promise<Shop> {
    const shop = await this.getById(shopId);
    if (shop.status === ShopStatus.ACTIVE) {
      return shop; // idempotent
    }
    shop.status = ShopStatus.ACTIVE;
    const saved = await this.shops.save(shop);

    const event = {
      sellerUserId: saved.ownerUserId,
      shopId: saved.id,
      shopName: saved.name,
      phone: saved.phone,
    };
    await this.emit(this.notifications, 'shop.approved', event);
    await this.emit(this.integration, 'shop.approved', event);
    return saved;
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
