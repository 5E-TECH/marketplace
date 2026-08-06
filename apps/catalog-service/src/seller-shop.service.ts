import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateSellerShopDto } from '@app/common';
import { Shop } from './entities/shop.entity';

@Injectable()
export class SellerShopService {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
  ) {}

  async getMine(ownerUserId: string): Promise<Shop> {
    const shop = await this.shops.findOne({
      where: { ownerUserId, isDeleted: false },
    });
    if (!shop) {
      throw new NotFoundException('Sotuvchining do‘koni topilmadi');
    }
    return shop;
  }

  async updateMine(
    ownerUserId: string,
    dto: UpdateSellerShopDto,
  ): Promise<Shop> {
    const shop = await this.getMine(ownerUserId);
    this.shops.merge(shop, dto);
    return this.shops.save(shop);
  }

  /** Elchi market id'ni shopga yozadi (id bo'yicha; elchi-integration chaqiradi). */
  async setElchiMarketId(
    shopId: string,
    elchiMarketId: string,
  ): Promise<{ shopId: string; elchiMarketId: string }> {
    const shop = await this.shops.findOne({
      where: { id: shopId, isDeleted: false },
    });
    if (!shop) {
      throw new NotFoundException('Do‘kon topilmadi');
    }
    shop.elchiMarketId = elchiMarketId;
    await this.shops.save(shop);
    return { shopId, elchiMarketId };
  }
}
