import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import {
  CatalogDisplayLookupRequest,
  CatalogDisplayLookupResult,
  CatalogOfferListQuery,
  CatalogOfferSnapshot,
  CatalogOrderSnapshot,
  CatalogOrderSnapshotMany,
  isLeadBigintId,
  INBOUND_RPC,
  ModerationSummaryDto,
  PriceQueueDto,
  ProductStatus,
  RmqClient,
  ShopStatus,
  InventoryVariantStock,
  INVENTORY_STOCK_SUMMARY,
  CreativeType,
} from '@app/common';
import { ProductVariant } from './entities/product-variant.entity';
import { CategoryFlags, loadCategoryFlags } from './category-flags';
import { CreativeService } from './creative.service';
import { Product } from './entities/product.entity';
import {
  OfferPricing,
  PricingContext,
  PricingService,
} from './pricing.service';

/** Bitta so‘rovda qaytariladigan offerlar soni (lead-service o‘zi sahifalaydi). */
const LIST_LIMIT = 500;
/** inventory.available kutish chegarasi, ms (lead→catalog RPC 10 s dan ancha qisqa). */
const INVENTORY_TIMEOUT_MS = 1500;

/**
 * lead-service uchun katalog offer ma’lumoti (`LEAD_CATALOG_RPC`, BE-11 shartnomasi). BE-07 maydonlari:
 * mahsulot, og‘irlik, BAD, sotuvchi haqi, sotuvchilarga ochiqligi va sotuvdan olinganligi.
 * Narx (tasdiqlangan, eng katta) va ko‘rinadigan yetkazish — BE-09; qoldiq — BE-16 (HQ ombor). Keyingi kartalar
 * to‘ldiradi: kreativlar va video — BE-08/BE-27. Narx tasdiqlanmagan offerni lead-service ochmaydi.
 */
@Injectable()
export class CatalogOfferService {
  private readonly logger = new Logger(CatalogOfferService.name);

  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly pricing: PricingService,
    @InjectRepository(ProductVariant)
    private readonly variants: Repository<ProductVariant>,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    private readonly creatives: CreativeService,
  ) {}

  /**
   * BE-16: bo‘sh qoldiq HQ omborda — mahsulotning faol varianti(lari) bo‘yicha (CPA da bitta). Inventory javob
   * bermasa — null (noma’lum): kelayotgan lid rad etilmaydi, sotuvchi esa yangi sahifa ocholmaydi.
   */
  private async stockOf(
    productIds: string[],
  ): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>(
      productIds.map((id) => [id, 0]),
    );
    if (!productIds.length) return result;
    const variants = await this.variants.find({
      where: { productId: In(productIds), isActive: true, isDeleted: false },
      select: { id: true, productId: true },
    });
    if (!variants.length) return result;
    try {
      // qisqa kutish: inventory osilib qolsa offer (va lid qabul qilish) uning ortidan kutib qolmasin
      const available = await firstValueFrom(
        this.inventory
          .send<Record<string, number>>(
            { cmd: 'inventory.available' },
            { variantIds: variants.map((v) => String(v.id)) },
          )
          .pipe(timeout(INVENTORY_TIMEOUT_MS)),
      );
      for (const v of variants) {
        const key = String(v.productId);
        result.set(
          key,
          (result.get(key) ?? 0) + (available[String(v.id)] ?? 0),
        );
      }
    } catch (error) {
      // noma’lum (null): sahifa va lid qabul qilish ochiq qoladi, yangi sahifa ochish — yopiq (lead-service)
      for (const id of productIds) result.set(id, null);
      this.logger.warn(`Qoldiq olinmadi: ${(error as Error).message}`);
    }
    return result;
  }

  async get(productId: string): Promise<CatalogOfferSnapshot | null> {
    if (!/^\d+$/.test(String(productId ?? ''))) return null;
    const product = await this.base()
      .where('product.id = :id', { id: String(productId) })
      .getOne();
    if (!product) return null;
    const id = String(product.id);
    // har sahifa ko‘rinishida va lid qabulida chaqiriladi — so‘rovlar parallel
    const [stock, creatives, flags, ctx] = await Promise.all([
      this.stockOf([id]),
      this.creatives.forProducts([id]),
      this.categoryFlags([product]),
      this.pricing.context(),
    ]);
    return toSnapshot(
      product,
      this.pricingOf(product, ctx),
      // null (noma’lum) saqlanadi — `?? 0` uni 0 ga aylantirib yuborardi
      stock.get(id),
      creatives.get(id) ?? [],
      flags(product.categoryId),
    );
  }

  /**
   * `productIds` berilsa — mavjud mahsulotlar holatidan qat’i nazar (o‘chirilgani ham, «Mening sahifalarim» uchun).
   * Aks holda faqat sotuvchilarga ochiq offerlar, qidiruv va kategoriya bo‘yicha.
   */
  async list(
    query: CatalogOfferListQuery = {},
  ): Promise<CatalogOfferSnapshot[]> {
    const qb = this.base();
    if (query.productIds) {
      const ids = query.productIds.map(String).filter((id) => /^\d+$/.test(id));
      if (!ids.length) return [];
      qb.where('product.id IN (:...ids)', { ids });
    } else {
      qb.where('product.is_deleted = FALSE')
        .andWhere('product.is_blocked = FALSE')
        .andWhere('product.cpa_enabled = TRUE')
        .andWhere('product.status = :active', { active: ProductStatus.ACTIVE })
        .andWhere('shop.is_deleted = FALSE')
        .andWhere('shop.status = :shopActive', {
          shopActive: ShopStatus.ACTIVE,
        });
      const search = query.search?.trim();
      if (search)
        qb.andWhere(
          new Brackets((w) =>
            w
              .where('product.name ILIKE :search')
              .orWhere('product.description ILIKE :search'),
          ),
          { search: `%${search}%` },
        );
      if (query.categoryId && /^\d+$/.test(String(query.categoryId)))
        qb.andWhere('product.category_id = :categoryId', {
          categoryId: String(query.categoryId),
        });
    }
    const rows = await qb
      // take() + join: TypeORM xossa nomini talab qiladi (ustun nomi emas)
      .orderBy('product.createdAt', 'DESC')
      .addOrderBy('product.id', 'DESC')
      .take(LIST_LIMIT)
      .getMany();
    if (!rows.length) return [];
    const ctx = await this.pricing.context();
    const stock = await this.stockOf(rows.map((row) => String(row.id)));
    const creatives = await this.creatives.forProducts(
      rows.map((row) => String(row.id)),
    );
    const flags = await this.categoryFlags(rows);
    return rows.map((row) =>
      toSnapshot(
        row,
        this.pricingOf(row, ctx),
        stock.get(String(row.id)),
        creatives.get(String(row.id)) ?? [],
        flags(row.categoryId),
      ),
    );
  }

  /** Toifa belgisi faqat toifasi bor, o‘zi BAD bo‘lmagan mahsulotga kerak — aks holda toifalar o‘qilmaydi. */
  private async categoryFlags(
    products: Product[],
  ): Promise<(categoryId: string | null) => CategoryFlags | undefined> {
    return products.some((p) => !p.isBad && p.categoryId)
      ? loadCategoryFlags(this.products.manager)
      : () => undefined;
  }

  /** Narx sozlamasi buzilgan bo‘lsa ham offer qaytadi — narxsiz (lead-service uni ochmaydi). */
  private pricingOf(
    product: Product,
    ctx: PricingContext,
  ): OfferPricing | undefined {
    try {
      return this.pricing.offerPricing(product, ctx);
    } catch {
      return undefined;
    }
  }

  /**
   * BE-18: liddan buyurtma uchun narx nusxasi (NRX-10). Mahsulot yo‘q bo‘lsa — null. Faol variant — CPA da bitta
   * (BE-07); bir nechta bo‘lsa eng kichik ID li. Tasdiqlanmagan narx — `approvedPrice: null`.
   */
  async orderSnapshot(
    productId: string,
    quantity: number,
    whereDeliver: string,
  ): Promise<CatalogOrderSnapshot | null> {
    if (!/^\d+$/.test(String(productId ?? ''))) return null;
    const product = await this.orderBase()
      .where('product.id = :id', { id: String(productId) })
      .getOne();
    if (!product) return null;
    return this.snapshotOf(product, quantity, whereDeliver);
  }

  /**
   * BE-34: ko‘p tovarli buyurtma (saytdan) — har tovar narx nusxasi so‘rov tartibida (topilmagani — null) va butun
   * posilka yetkazishi jami og‘irlik bo‘yicha (`PricingService.combinedDelivery`).
   */
  async orderSnapshotMany(
    items: Array<{ productId: string; quantity: number }>,
    whereDeliver: string,
  ): Promise<CatalogOrderSnapshotMany> {
    const list = Array.isArray(items) ? items : [];
    const ids = list
      .map((item) => String(item?.productId ?? ''))
      .filter((id) => /^\d+$/.test(id));
    const products = ids.length
      ? await this.orderBase()
          .where('product.id IN (:...ids)', { ids })
          .getMany()
      : [];
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const snapshots: Array<CatalogOrderSnapshot | null> = [];
    for (const item of list) {
      const product = byId.get(String(item?.productId ?? ''));
      snapshots.push(
        product
          ? await this.snapshotOf(product, Number(item.quantity), whereDeliver)
          : null,
      );
    }
    const delivery =
      list.length && snapshots.every(Boolean)
        ? await this.pricing.combinedDelivery(
            list.map((item) => ({
              product: byId.get(String(item.productId))!,
              quantity: Number(item.quantity),
            })),
            whereDeliver,
          )
        : null;
    return { items: snapshots, delivery };
  }

  private async snapshotOf(
    product: Product,
    quantity: number,
    whereDeliver: string,
  ): Promise<CatalogOrderSnapshot> {
    const variant = await this.variants.findOne({
      where: {
        productId: String(product.id),
        isActive: true,
        isDeleted: false,
      },
      order: { id: 'ASC' },
    });
    const pricing = await this.pricing.orderPricing(
      product,
      quantity,
      whereDeliver,
    );
    return {
      productId: String(product.id),
      productName: product.name,
      variantId: variant ? String(variant.id) : null,
      sku: variant?.sku ?? null,
      barcode: variant?.barcode ?? null,
      wholesalerId: String(product.shopId),
      weightGrams: product.weightGrams!,
      cpaAvailable: isCpaAvailable(product),
      withdrawn: isWithdrawn(product),
      ...pricing,
      fiscal: {
        mxikCode: product.mxikCode ?? null,
        packageCode: product.packageCode ?? null,
        wholesalerTin: product.shop.tin ?? null,
      },
    };
  }

  /**
   * BE-27: moderatsiya hisoblagichlari (FE-12). Pilotda mahsulotlar soni kichik (TZ: 30–50 SKU) — narx holati
   * har mahsulot uchun kalkulyator bilan hisoblanadi (bazada saqlanmaydi, tarif va siyosatga bog‘liq).
   */
  async moderationSummary(): Promise<ModerationSummaryDto> {
    const products = await this.base()
      .where('product.is_deleted = FALSE')
      .getMany();
    const byStatus: Record<string, number> = {
      ALL: products.length,
      PENDING_REVIEW: 0,
      ACTIVE: 0,
      REJECTED: 0,
      BLOCKED: 0,
      DRAFT: 0,
      ARCHIVED: 0,
    };
    for (const p of products) {
      // BE-25 (FE-25): arxivdagi mahsulot — «Arxiv» da (bloklangan bo‘lsa ham), «To‘xtatilgan» da emas
      if (p.status === ProductStatus.ARCHIVED) byStatus.ARCHIVED++;
      else if (p.isBlocked) byStatus.BLOCKED++;
      else if (p.status in byStatus) byStatus[p.status]++;
    }
    const ctx = await this.pricing.context();
    // BE-25 (FE-12): hisoblagich = «Diqqat» filtri qatorlari soni (bir qoida)
    const [outOfStock, expirySoon] = await Promise.all([
      this.outOfStockIds(products),
      this.expirySoonIds(),
    ]);
    return {
      productsPending: byStatus.PENDING_REVIEW,
      pricesPending: this.pricePending(products, ctx).length,
      byStatus,
      outOfStock: outOfStock?.length ?? null,
      expirySoon: expirySoon?.length ?? null,
    };
  }

  /**
   * Sotuvdagi CPA mahsulotlari (offer qoidasi), bo‘sh qoldig‘i 0 — moderatsiya `outOfStock` va `attention=OUT_OF_STOCK`.
   * Ombor javob bermasa — null.
   */
  async outOfStockIds(all?: Product[]): Promise<string[] | null> {
    const products =
      all ?? (await this.base().where('product.is_deleted = FALSE').getMany());
    const onSale = products.filter(isCpaAvailable);
    const stock = await this.stockOf(onSale.map((p) => String(p.id)));
    if ([...stock.values()].some((v) => v === null)) return null;
    return [...stock].filter(([, v]) => (v ?? 0) <= 0).map(([id]) => id);
  }

  /**
   * Sotuvdan chiqqan partiyasi (muddat − 60 kun o‘tgan, BE-17 OMB-3) omborda turgan mahsulotlar [taklif] —
   * moderatsiya `expirySoon` va `attention=EXPIRY_SOON`. Ombor javob bermasa — null.
   */
  async expirySoonIds(): Promise<string[] | null> {
    let lots: Array<{ variantId?: string }>;
    try {
      lots = await firstValueFrom(
        this.inventory
          .send<Array<{ variantId?: string }>>(
            { cmd: INBOUND_RPC.LOTS },
            { state: 'BLOCKED' },
          )
          .pipe(timeout(INVENTORY_TIMEOUT_MS)),
      );
    } catch (error) {
      this.logger.warn(`Partiyalar olinmadi: ${(error as Error).message}`);
      return null;
    }
    if (!Array.isArray(lots)) return null;
    const variantIds = [
      ...new Set(
        lots
          .map((l) => String(l?.variantId ?? ''))
          .filter((id) => /^\d+$/.test(id)),
      ),
    ];
    if (!variantIds.length) return [];
    // o‘chirilgan yoki nofaol variant ham — partiya omborda turibdi
    const variants = await this.variants.find({
      where: { id: In(variantIds) },
      select: { id: true, productId: true },
    });
    const productIds = [...new Set(variants.map((v) => String(v.productId)))];
    if (!productIds.length) return [];
    const alive = await this.products.find({
      where: { id: In(productIds), isDeleted: false },
      select: { id: true },
    });
    return alive.map((p) => String(p.id));
  }

  /**
   * BE-25 (FE-12): ro‘yxat qatorlari uchun — ombor (HQ: omborda, band, sotsa bo‘ladigan, yo‘lda), mijoz narxi, video.
   * Javob bermagan qism `unavailable` da, qatorda esa null.
   */
  async adminListExtras(products: Product[]): Promise<{
    byId: Map<
      string,
      {
        stock: InventoryVariantStock | null;
        listPrice: ReturnType<PricingService['listPrice']>;
        hasVideo: boolean;
      }
    >;
    unavailable: Array<'stock' | 'listPrice'>;
  }> {
    const ids = products.map((p) => String(p.id));
    const unavailable: Array<'stock' | 'listPrice'> = [];
    const variants = ids.length
      ? await this.variants.find({
          where: { productId: In(ids), isActive: true, isDeleted: false },
          select: { id: true, productId: true },
        })
      : [];
    const [stock, creatives, ctx] = await Promise.all([
      variants.length
        ? firstValueFrom(
            this.inventory
              .send<Record<string, InventoryVariantStock>>(
                { cmd: INVENTORY_STOCK_SUMMARY },
                { variantIds: variants.map((v) => String(v.id)) },
              )
              .pipe(timeout(INVENTORY_TIMEOUT_MS)),
          ).catch((error: unknown) => {
            this.logger.warn(
              `Ro‘yxat qoldig‘i olinmadi: ${(error as Error)?.message}`,
            );
            unavailable.push('stock');
            return null;
          })
        : Promise.resolve({} as Record<string, InventoryVariantStock>),
      this.creatives.forProducts(ids),
      this.pricing.context().catch((error: unknown) => {
        this.logger.warn(
          `Ro‘yxat narxi: sozlama yo‘q — ${(error as Error)?.message}`,
        );
        unavailable.push('listPrice');
        return null;
      }),
    ]);
    const byId = new Map<
      string,
      {
        stock: InventoryVariantStock | null;
        listPrice: ReturnType<PricingService['listPrice']>;
        hasVideo: boolean;
      }
    >();
    for (const p of products) {
      const id = String(p.id);
      const own = variants.filter((x) => String(x.productId) === id);
      const rows = stock
        ? own
            .map((v) => stock[String(v.id)])
            .filter((row): row is InventoryVariantStock => !!row)
        : [];
      // ombor qatori bor — yig‘indi; qatori yo‘q (postavka bo‘lmagan): sotuvdagi CPA mahsulotda nollar («Qoldiq tugagan»
      // filtri va hisoblagichi bilan bir xil), boshqasida null — «postavka yo‘q» (dizayn p-a2 2.3); ombor javob
      // bermasa — null va `unavailable`
      const sum: InventoryVariantStock | null =
        stock && own.length && (rows.length || isCpaAvailable(p))
          ? rows.reduce(
              (acc, row) => ({
                onHand: acc.onHand + row.onHand,
                reserved: acc.reserved + row.reserved,
                available: acc.available + row.available,
                incoming: acc.incoming + row.incoming,
              }),
              { onHand: 0, reserved: 0, available: 0, incoming: 0 },
            )
          : null;
      byId.set(id, {
        stock: sum,
        listPrice: ctx ? this.pricing.listPrice(p, ctx) : null,
        hasVideo: (creatives.get(id) ?? []).some(
          (c) => c.type === CreativeType.VIDEO,
        ),
      });
    }
    return { byId, unavailable };
  }

  /** Narx qarori kutayotganlar: CPA, yashirilmagan, tasdiq kutayotgan yoki sotuvdagi, tasdiqlangan narxi yo‘q yoki amalda emas. */
  private pricePending(products: Product[], ctx: PricingContext): Product[] {
    return products.filter(
      (p) =>
        p.cpaEnabled &&
        !p.isBlocked &&
        [ProductStatus.PENDING_REVIEW, ProductStatus.ACTIVE].includes(
          p.status,
        ) &&
        !this.approvalCurrentSafe(p, ctx),
    );
  }

  /** BE-25 (FE-13): narx navbati — `pricesPending` bilan bir xil qoida, eskisi oldin. */
  async priceQueue(): Promise<PriceQueueDto> {
    const products = await this.base()
      .where('product.is_deleted = FALSE')
      .andWhere('product.cpa_enabled = TRUE')
      .getMany();
    const ctx = await this.pricing.context();
    const items = this.pricePending(products, ctx)
      .map((product) => {
        const price = this.pricing.queuePrice(product, ctx);
        return {
          productId: String(product.id),
          name: product.name,
          shopName: product.shop?.name ?? null,
          basePrice: product.basePrice ?? null,
          recommended: price?.recommended ?? null,
          deliveryMode: price?.deliveryMode ?? null,
          queuedAt: this.pricing.queuedAt(product, ctx).toISOString(),
        };
      })
      .sort(
        (a, b) =>
          a.queuedAt.localeCompare(b.queuedAt) ||
          Number(a.productId) - Number(b.productId),
      );
    return { items, total: items.length };
  }

  /** Bitta mahsulotning buzilgan narx sozlamasi hisoblagichni yiqitmasin — u narx qarorini kutadi deb sanaladi. */
  private approvalCurrentSafe(product: Product, ctx: PricingContext): boolean {
    try {
      return this.pricing.approvalCurrent(product, ctx);
    } catch (error) {
      this.logger.warn(
        `Narx holati hisoblanmadi (${product.id}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  private base() {
    return this.products
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.shop', 'shop')
      .leftJoinAndSelect('product.category', 'category');
  }

  /**
   * BE-41: buyurtma narx nusxasi uchun — optovik STIR i (`select: false`) chekdagi komitent sifatida o‘qiladi.
   * Faqat ichki `catalog.order.snapshot*` RPC lari uchun: bitta va ko‘p tovarli (sayt, BE-34) yo‘l bir xil so‘rov
   * bilan, aks holda sayt buyurtmasida STIR bo‘sh qolib, Elchi’ga chek maydonlari ketmaydi.
   */
  private orderBase() {
    return this.base().addSelect('shop.tin');
  }

  /**
   * BE-29: do‘kon nomi, mahsulot va variant rasmi ID lar bo‘yicha (checkout boshqa sxemaga SQL yozmasligi uchun). Eski
   * JOIN lar kabi o‘chirilganlari ham qaytadi; noto‘g‘ri yoki takroriy ID tashlanadi.
   */
  async displayLookup(
    request: Partial<CatalogDisplayLookupRequest> | null | undefined,
  ): Promise<CatalogDisplayLookupResult> {
    const ids = (list: unknown) => [
      ...new Set(
        (Array.isArray(list) ? list : []).map(String).filter(isLeadBigintId),
      ),
    ];
    const shopIds = ids(request?.shopIds);
    const productIds = ids(request?.productIds);
    const variantIds = ids(request?.variantIds);
    const db = this.products.manager;
    const shops = shopIds.length
      ? ((await db.query(
          `SELECT id::text AS id, name FROM catalog.shop WHERE id = ANY($1::bigint[])`,
          [shopIds],
        )) as Array<{ id: string; name: string | null }>)
      : [];
    const products = productIds.length
      ? ((await db.query(
          `SELECT id::text AS id, name, NULLIF(image_url, '') AS "imageUrl",
                  category_id::text AS "categoryId", is_bad AS "isBad"
             FROM catalog.product WHERE id = ANY($1::bigint[])`,
          [productIds],
        )) as Array<{
          id: string;
          name: string | null;
          imageUrl: string | null;
          categoryId: string | null;
          isBad: boolean;
        }>)
      : [];
    const flags = products.length ? await loadCategoryFlags(db) : null;
    const variants = variantIds.length
      ? ((await db.query(
          `SELECT v.id::text AS id, p.name,
                  COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''),
                           p.images->>0) AS "imageUrl"
             FROM catalog.product_variant v
             JOIN catalog.product p ON p.id = v.product_id
            WHERE v.id = ANY($1::bigint[])`,
          [variantIds],
        )) as Array<{
          id: string;
          name: string | null;
          imageUrl: string | null;
        }>)
      : [];
    return {
      shops: shops.map((row) => ({ id: row.id, name: row.name ?? null })),
      products: products.map((row) => ({
        id: row.id,
        name: row.name ?? null,
        imageUrl: row.imageUrl ?? null,
        expiryTracked:
          !!row.isBad || !!flags?.(row.categoryId ?? null).expiryTracked,
      })),
      variants: variants.map((row) => ({
        id: row.id,
        name: row.name ?? null,
        imageUrl: row.imageUrl || null,
      })),
    };
  }
}

/** Sotuvchilarga ochiq: CPA yoqilgan, admin tasdiqlagan, bloklanmagan, o‘chirilmagan, optovigi faol (BE-07). */
export function isCpaAvailable(product: Product): boolean {
  return (
    product.cpaEnabled &&
    product.status === ProductStatus.ACTIVE &&
    !product.isBlocked &&
    !product.isDeleted &&
    !!product.shop &&
    !product.shop.isDeleted &&
    product.shop.status === ShopStatus.ACTIVE
  );
}

/** Sotuvdan olingan: o‘chirilgan, bloklangan, CPA o‘chirilgan, rad etilgan yoki arxivda, optovigi to‘xtatilgan. */
export function isWithdrawn(product: Product): boolean {
  return (
    product.isDeleted ||
    product.isBlocked ||
    !product.cpaEnabled ||
    [ProductStatus.REJECTED, ProductStatus.ARCHIVED].includes(product.status) ||
    !product.shop ||
    product.shop.isDeleted ||
    [ShopStatus.SUSPENDED, ShopStatus.REJECTED].includes(product.shop.status)
  );
}

export function toSnapshot(
  product: Product,
  pricing?: OfferPricing,
  stock: number | null = 0,
  creatives: CatalogOfferSnapshot['creatives'] = [],
  flags?: CategoryFlags,
): CatalogOfferSnapshot {
  const images = product.images?.length
    ? product.images
    : product.imageUrl
      ? [product.imageUrl]
      : [];
  return {
    productId: String(product.id),
    name: product.name,
    subtitle: null,
    description: product.description,
    images,
    videoUrl: null, // BE-08/BE-27
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    attributes: Object.entries(product.attributes ?? {})
      .filter(([, value]) =>
        ['string', 'number', 'boolean'].includes(typeof value),
      )
      .map(([name, value]) => ({ name, value: String(value) })),
    weightGrams: product.weightGrams,
    // TZ 8: BAD belgisi mahsulotda yoki toifasida (BE-25)
    isBad: product.isBad || !!flags?.isBad,
    cpaAvailable: isCpaAvailable(product),
    withdrawn: isWithdrawn(product),
    // BE-09: tasdiqlangan narx, eng katta narx (NRX-4) va ko‘rinadigan yetkazish (bir dona)
    approvedPrice: pricing?.approvedPrice ?? null,
    maxSalePrice: pricing?.maxSalePrice ?? null,
    affiliateFee: product.affiliateFee,
    centerDeliveryFee: pricing?.centerDeliveryFee ?? 0,
    addressDeliveryFee: pricing?.addressDeliveryFee ?? 0,
    stock, // BE-16: HQ ombordagi bo‘sh (band qilinmagan) qoldiq
    // BE-08: admin yuklagan kreativlar (SOT-9), tartib bilan
    creatives,
    // BE-45: upsell juftligi (operator qo‘ng‘iroqda taklif qiladi)
    upsellProductId:
      product.upsellProductId == null ? null : String(product.upsellProductId),
    createdAt: new Date(product.createdAt).toISOString(),
  };
}
