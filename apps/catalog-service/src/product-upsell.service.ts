import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductStatus } from '@app/common';
import { Product } from './entities/product.entity';

const ID = /^[1-9]\d{0,18}$/;

/**
 * BE-45 (OPR-4): admin mahsulotga upsell juftligini belgilaydi — operator tasdiqlash qo‘ng‘irog‘ida shu mahsulotni
 * taklif qiladi. Bitta juftlik offer bo‘yicha (admin-offer 3.4 oynasi) [taklif].
 *
 * Juftlik bo‘lmaydi: o‘zi bilan (DB CHECK ham); arxivdagi, rad etilgan, o‘chirilgan yoki CPA o‘chirilgan mahsulot bilan.
 * Qoldig‘i 0 yoki hozir to‘xtatilgan juftlik saqlanadi — operator ekrani «taklif qilinmaydi» deydi (`LeadUpsellOfferDto`).
 */
@Injectable()
export class ProductUpsellService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  async setPair(productId: string, pairId: string | null): Promise<Product> {
    const id = String(productId ?? '');
    if (!ID.test(id)) throw new NotFoundException('Mahsulot topilmadi');
    await this.load(id);
    if (pairId !== null && pairId !== undefined) {
      const target = String(pairId);
      if (!ID.test(target))
        throw new BadRequestException('productId musbat son bo‘lishi kerak');
      if (target === id)
        throw new BadRequestException(
          'Mahsulotni o‘ziga juftlik qilib bo‘lmaydi',
        );
      const pair = await this.products.findOne({
        where: { id: target, isDeleted: false },
        relations: { shop: true },
      });
      if (!pair) throw new NotFoundException('Juftlik mahsuloti topilmadi');
      if (
        [ProductStatus.ARCHIVED, ProductStatus.REJECTED].includes(
          pair.status,
        ) ||
        !pair.cpaEnabled
      )
        throw new ConflictException(
          'Juftlik mahsuloti sotuvchilarga ochiq emas (arxivda, rad etilgan yoki CPA o‘chirilgan)',
        );
      await this.products.update({ id }, { upsellProductId: target });
    } else {
      await this.products.update({ id }, { upsellProductId: null });
    }
    return this.load(id);
  }

  private async load(id: string): Promise<Product> {
    const product = await this.products.findOne({
      where: { id, isDeleted: false },
      relations: { shop: true },
    });
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    return product;
  }
}
