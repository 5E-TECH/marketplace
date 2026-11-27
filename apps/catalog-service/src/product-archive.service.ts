import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom, timeout } from 'rxjs';
import { Repository } from 'typeorm';
import {
  PRODUCT_ARCHIVE_RPC,
  ProductStatus,
  RmqClient,
  WHOLESALER_CABINET_RPC,
  WholesalerStockTotals,
} from '@app/common';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductService } from './product.service';

/** Gateway catalog ni 10 s kutadi — ichki ikki so‘rov undan qisqa bo‘lsin. */
const RPC_TIMEOUT_MS = 4_000;
const ID = /^[1-9]\d{0,18}$/;

/**
 * BE-25 (FE-25): admin mahsulotni arxivlaydi. Karta, narx qarorlari va audit saqlanadi; ro‘yxatda «Arxiv»
 * (`status=ARCHIVED`), offer sotuvdan tushadi (`isWithdrawn`), qidiruvdan olinadi.
 *
 * Arxivlanmaydi (dizayn p-a2 4.4 «qoldig‘i yoki ochiq buyurtmasi bor mahsulot arxivlanmaydi»; qoidalar [taklif]):
 * - sotuvdagi (to‘xtatilmagan ACTIVE) mahsulot — avval to‘xtatiladi;
 * - omborda yoki bandda dona bor (inventory, optovik paneli bilan bir hisob);
 * - ochiq buyurtma bor (checkout: topshirilgungacha va Elchi’da yakunlanmagan holatlar).
 * Ombor yoki buyurtma xizmati javob bermasa — arxivlanmaydi (503).
 */
@Injectable()
export class ProductArchiveService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    private readonly productService: ProductService,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  async archive(productId: string): Promise<Product> {
    const id = String(productId ?? '');
    if (!ID.test(id)) throw new NotFoundException('Mahsulot topilmadi');
    const product = await this.load(id);
    this.assertArchivable(product);

    // o‘chirilgan variantlar ham — ularda qoldiq qolgan bo‘lishi mumkin
    const variants = await this.variants.find({ where: { productId: id } });
    if (variants.length) {
      const summary = await this.call<{ totals: WholesalerStockTotals }>(
        this.inventory,
        WHOLESALER_CABINET_RPC.STOCK_SUMMARY,
        {
          wholesalerId: String(product.shopId),
          variants: variants.map((v) => ({
            productId: id,
            productName: product.name,
            variantId: String(v.id),
            sku: v.sku,
          })),
        },
      );
      const held =
        Number(summary?.totals?.onHand ?? 0) +
        Number(summary?.totals?.reserved ?? 0);
      if (held > 0)
        throw new ConflictException(
          `Omborda yoki buyurtmalarda ${held} dona bor — arxivlab bo‘lmaydi`,
        );
    }
    const open = await this.call<Record<string, number>>(
      this.checkout,
      PRODUCT_ARCHIVE_RPC.OPEN_ORDERS,
      { productIds: [id] },
    );
    const orders = Number(open?.[id] ?? 0);
    if (orders > 0)
      throw new ConflictException(
        `Ochiq buyurtmasi bor (${orders} ta) — arxivlab bo‘lmaydi`,
      );

    const saved = await this.products.manager.transaction(async (m) => {
      const repo = m.getRepository(Product);
      const locked = await repo.findOne({
        where: { id, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Mahsulot topilmadi');
      // tekshiruvdan keyin boshqa admin qayta yoqqan yoki arxivlagan bo‘lishi mumkin
      this.assertArchivable(locked);
      locked.status = ProductStatus.ARCHIVED;
      return repo.save(locked);
    });
    await this.productService.publishRemoved(saved);
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

  private assertArchivable(product: Product): void {
    if (product.status === ProductStatus.ARCHIVED)
      throw new ConflictException('Mahsulot allaqachon arxivda');
    if (product.status === ProductStatus.ACTIVE && !product.isBlocked)
      throw new ConflictException(
        'Sotuvdagi mahsulot arxivlanmaydi — avval to‘xtating',
      );
  }

  private async call<T>(
    client: ClientProxy,
    cmd: string,
    data: unknown,
  ): Promise<T> {
    try {
      return await firstValueFrom(
        client.send<T>({ cmd }, data).pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Ombor yoki buyurtma ma’lumoti olinmadi — mahsulot arxivlanmadi',
      );
    }
  }
}
