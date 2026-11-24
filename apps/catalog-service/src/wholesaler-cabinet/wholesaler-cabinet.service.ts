import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  CreateProductDto,
  ReviewWholesalerInput,
  SELF_CONTRACT_PREFIX,
  SelfRegisterWholesalerInput,
  ShopStatus,
  tashkentDate,
  WholesalerDocumentKind,
  WholesalerDocumentRecord,
  WholesalerPricingQueryDto,
  WholesalerProductsQueryDto,
  WholesalerProfileDto,
} from '@app/common';
import { Product } from '../entities/product.entity';
import { Shop, WHOLESALER_PRIVATE_COLUMNS } from '../entities/shop.entity';
import { PricingService } from '../pricing.service';
import { ProductService } from '../product.service';
import { hasContract, slugify, toWholesalerDto } from '../wholesaler.service';

/** Kabinetda mahsulot taklif qilib bo‘lmaydigan optovik holatlari (OPT-2). */
const BLOCKED: ReadonlySet<ShopStatus> = new Set([
  ShopStatus.REJECTED,
  ShopStatus.SUSPENDED,
]);

export type WholesalerProductView = Omit<
  Product,
  'marketTotal' | 'marketSource' | 'marketCheckedAt'
>;

/** Bozor narxi (raqobatchi summasi, manbasi, vaqti) optovikka berilmaydi — narx hisobidagi kabi. */
function withoutMarket(product: Product): WholesalerProductView {
  const {
    marketTotal: _total,
    marketSource: _source,
    marketCheckedAt: _at,
    ...view
  } = product;
  return view as WholesalerProductView;
}

/**
 * BE-30 (TZ 6.9 OPT-1–4, NRX-2): optovik kabineti — catalog tomoni. Optovik JWT foydalanuvchisi bo‘yicha
 * (`catalog.shop.owner_user_id`) aniqlanadi; boshqa optovikning mahsuloti va hujjati — 403.
 */
@Injectable()
export class WholesalerCabinetService {
  constructor(
    @InjectRepository(Shop) private readonly shops: Repository<Shop>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly productService: ProductService,
    private readonly pricing: PricingService,
  ) {}

  // ------------------------------------------------------------------ ro‘yxat (OPT-1)

  /** Ro‘yxatdan oldin: STIR bandmi (foydalanuvchi yaratilmasidan oldin 409). */
  async tinFree(tin: string): Promise<{ free: boolean }> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM catalog.shop WHERE tin = $1 AND is_deleted = FALSE AND status <> 'REJECTED' LIMIT 1`,
      [String(tin ?? '')],
    )) as unknown[];
    return { free: rows.length === 0 };
  }

  /**
   * O‘zi ro‘yxatdan o‘tgan optovik: holat PENDING (admin tasdig‘igacha), elektron shartnoma — raqam `OPT-E-<id>`,
   * sana — Toshkent bo‘yicha bugun [taklif, egaga savol 3]. Bir foydalanuvchiga bitta yozuv: takror — o‘sha.
   */
  async selfRegister(
    input: SelfRegisterWholesalerInput,
  ): Promise<WholesalerProfileDto> {
    const ownerUserId = String(input?.ownerUserId ?? '');
    if (!/^\d+$/.test(ownerUserId))
      throw new BadRequestException('ownerUserId noto‘g‘ri');
    const existing = await this.ownShop(ownerUserId, false);
    // rad etilgan ariza — yangi rekvizitlar bilan qayta yuboriladi (yana PENDING); boshqa holatda — o‘sha yozuv
    if (existing && existing.status !== ShopStatus.REJECTED)
      return this.profileView(existing);
    if (existing) {
      Object.assign(existing, {
        name: input.name.trim(),
        description: input.description ?? null,
        status: ShopStatus.PENDING,
        phone: input.phone,
        address: input.address ?? null,
        legalType: input.legalType,
        tin: input.tin,
        bankName: input.bankName,
        bankAccount: input.bankAccount,
        bankMfo: input.bankMfo,
        contractVersion: input.contractVersion,
        // shartnoma sanasi — qayta qabul kuni (PDF dagi sana qabul vaqti bilan mos)
        contractDate: tashkentDate(new Date()),
        contractAcceptedAt: new Date(),
        moderationNote: null,
      });
      return this.profileView(await this.save(existing));
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Shop);
      const shop = repo.create({
        ownerUserId,
        name: input.name.trim(),
        slug: `optovik-${randomUUID()}`,
        description: input.description ?? null,
        status: ShopStatus.PENDING,
        phone: input.phone,
        address: input.address ?? null,
        legalType: input.legalType,
        tin: input.tin,
        bankName: input.bankName,
        bankAccount: input.bankAccount,
        bankMfo: input.bankMfo,
        contractNumber: null,
        contractDate: tashkentDate(new Date()),
        contractVersion: input.contractVersion,
        contractAcceptedAt: new Date(),
        moderationNote: null,
      });
      const saved = await this.save(shop, repo);
      saved.slug = `${slugify(saved.name)}-${saved.id}`;
      saved.contractNumber = `${SELF_CONTRACT_PREFIX}${saved.id}`;
      return this.profileView(await this.save(saved, repo));
    });
  }

  /**
   * Admin: o‘zi ro‘yxatdan o‘tgan optovik — tasdiq (ACTIVE) yoki rad (REJECTED, izoh majburiy). Faqat elektron
   * shartnomali PENDING ariza (eski marketplace do‘konlari bu yo‘l bilan faollashmaydi); qator qulfi bilan — ikki
   * admin bir vaqtda qaror qilsa, ikkinchisi 409.
   */
  async review(input: ReviewWholesalerInput): Promise<WholesalerProfileDto> {
    const note = input?.note?.trim() || null;
    if (input?.decision === 'REJECT' && !note)
      throw new BadRequestException('Rad etish sababi majburiy');
    const id = (await this.byId(input?.wholesalerId)).id;
    await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `SELECT status, contract_version AS "contractVersion" FROM catalog.shop
          WHERE id = $1 AND is_deleted = FALSE FOR UPDATE`,
        [id],
      )) as Array<{ status: ShopStatus; contractVersion: string | null }>;
      if (row?.status !== ShopStatus.PENDING || !row.contractVersion)
        throw new ConflictException(
          `${row?.status ?? '—'} holatidagi yozuvni ko‘rib bo‘lmaydi — faqat o‘zi ro‘yxatdan o‘tgan PENDING optovik`,
        );
      await manager.query(
        `UPDATE catalog.shop SET status = $2, moderation_note = $3, updated_at = now() WHERE id = $1`,
        [
          id,
          input.decision === 'APPROVE'
            ? ShopStatus.ACTIVE
            : ShopStatus.REJECTED,
          input.decision === 'REJECT' ? note : null,
        ],
      );
    });
    return this.profileView(await this.byId(id));
  }

  /**
   * Admin kiritgan optovikka kabinet egasi (identity foydalanuvchisi gateway da yaratiladi). Egasi bor bo‘lsa — faqat
   * o‘sha foydalanuvchi (takror); bitta foydalanuvchi — bitta optovik. Egasiz qo‘shilgan mahsulotlar ham bog‘lanadi.
   */
  async linkOwner(input: {
    wholesalerId: string;
    ownerUserId: string;
  }): Promise<WholesalerProfileDto> {
    const ownerUserId = String(input?.ownerUserId ?? '');
    if (!/^\d+$/.test(ownerUserId))
      throw new BadRequestException('ownerUserId noto‘g‘ri');
    const id = (await this.byId(input?.wholesalerId)).id;
    try {
      await this.dataSource.transaction(async (manager) => {
        const [row] = (await manager.query(
          `SELECT owner_user_id::text AS owner FROM catalog.shop WHERE id = $1 FOR UPDATE`,
          [id],
        )) as Array<{ owner: string | null }>;
        if (row?.owner && row.owner !== ownerUserId)
          throw new ConflictException(
            'Optovikning kabinet egasi allaqachon bor',
          );
        await manager.query(
          `UPDATE catalog.shop SET owner_user_id = $1, updated_at = now() WHERE id = $2`,
          [ownerUserId, id],
        );
        await manager.query(
          `UPDATE catalog.product SET owner_user_id = $1
            WHERE shop_id = $2 AND owner_user_id IS NULL`,
          [ownerUserId, id],
        );
      });
    } catch (error) {
      const driver = (error as QueryFailedError).driverError as
        { code?: string } | undefined;
      if (error instanceof QueryFailedError && driver?.code === '23505')
        throw new ConflictException(
          'Bu foydalanuvchi boshqa optovikka bog‘langan',
        );
      throw error;
    }
    return this.profileView(await this.byId(id));
  }

  async me(ownerUserId: string): Promise<WholesalerProfileDto> {
    return this.profileView(await this.requireOwnShop(ownerUserId));
  }

  // ------------------------------------------------------------------ mahsulot taklifi (OPT-2)

  /** Shartnomasiz — 403 (TC1); rad etilgan yoki to‘xtatilgan optovik — 403. Mahsulot admin tasdig‘igacha sotilmaydi. */
  async createProduct(
    ownerUserId: string,
    dto: CreateProductDto,
  ): Promise<WholesalerProductView> {
    const shop = await this.requireOwnShop(ownerUserId);
    if (BLOCKED.has(shop.status))
      throw new ForbiddenException(
        `Optovik holati ${shop.status} — mahsulot taklif qilib bo‘lmaydi`,
      );
    if (!hasContract(shop))
      throw new ForbiddenException(
        'Komissiya shartnomasi yo‘q — mahsulot taklif qilib bo‘lmaydi (OPT-1)',
      );
    // admin belgilari (CPA, BAD) va sotuvchi haqi optovikdan olinmaydi — sukut; admin tasdiqda belgilaydi
    const proposal: CreateProductDto = {
      name: dto.name,
      categoryId: dto.categoryId,
      description: dto.description,
      basePrice: dto.basePrice,
      // sotuvchi haqi (A) — platforma belgilaydi (TZ 2-bo‘lim), optovik faqat bazaviy narx (B) beradi
      affiliateFee: null,
      weightGrams: dto.weightGrams,
      lengthMm: dto.lengthMm,
      widthMm: dto.widthMm,
      heightMm: dto.heightMm,
      imageUrl: dto.imageUrl,
      images: dto.images,
      attributes: dto.attributes,
    };
    return withoutMarket(
      await this.productService.adminCreate(String(shop.id), proposal as never),
    );
  }

  async listProducts(
    ownerUserId: string,
    query: WholesalerProductsQueryDto = {},
  ) {
    const shop = await this.requireOwnShop(ownerUserId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.products.findAndCount({
      where: { shopId: shop.id, isDeleted: false },
      order: { id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: items.map(withoutMarket),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async getProduct(
    ownerUserId: string,
    productId: string,
  ): Promise<WholesalerProductView> {
    const shop = await this.requireOwnShop(ownerUserId);
    return withoutMarket(await this.ownProduct(shop, productId));
  }

  // ------------------------------------------------------------------ narx hisobi (NRX-2)

  /**
   * Admin ko‘radigan hisob (BE-09) — tavsiya narx, zararsizlik, qat’iy pastki chegara, taqsimot, platforma natijasi.
   * Ichki siyosat parametrlari va Elchi tarifi berilmaydi.
   */
  async pricingView(
    ownerUserId: string,
    productId: string,
    query: WholesalerPricingQueryDto = {},
  ) {
    const shop = await this.requireOwnShop(ownerUserId);
    const product = await this.ownProduct(shop, productId);
    const view = await this.pricing.calculate(String(product.id), {
      price: query.price,
    });
    // BE-25: yaxlitlanmagan tavsiya va eng katta haq — admin ekrani uchun (ulardan ichki M va K chiqariladi)
    const { recommendedBaseExact: _exact, ...calculation } = view.calculation;
    const { maxAffiliateFee: _max, ...evaluation } = view.evaluation;
    return {
      productId: view.productId,
      basePrice: product.basePrice,
      affiliateFee: product.affiliateFee,
      calculation,
      evaluation,
      approvedPrice: view.approvedPrice,
      priceStatus: view.priceStatus,
    };
  }

  // ------------------------------------------------------------------ panel uchun

  /** Optovik variantlari (panel qoldig‘i inventory dan shu ro‘yxat bo‘yicha). */
  async variants(wholesalerId: string) {
    return (await this.dataSource.query(
      `SELECT p.id::text AS "productId", p.name AS "productName", v.id::text AS "variantId", v.sku
         FROM catalog.product_variant v
         JOIN catalog.product p ON p.id = v.product_id
        WHERE p.shop_id = $1 AND p.is_deleted = FALSE AND v.is_deleted = FALSE
        ORDER BY p.id, v.id`,
      [String(wholesalerId)],
    )) as Array<{
      productId: string;
      productName: string;
      variantId: string;
      sku: string;
    }>;
  }

  // ------------------------------------------------------------------ yopiq hujjatlar

  /** Fayl file-service da tekshirilib yopiq joyga ko‘chirilgandan keyin (gateway) — yozuv. */
  async addDocument(input: {
    ownerUserId: string;
    kind: WholesalerDocumentKind;
    productId?: string | null;
    objectKey: string;
    fileName: string;
    contentType: string;
    size: number;
  }): Promise<WholesalerDocumentRecord> {
    const shop = await this.requireOwnShop(input.ownerUserId);
    if (!input.objectKey?.startsWith(`private/wholesaler/${shop.id}/`))
      throw new ForbiddenException('Fayl boshqa optovikka tegishli');
    let productId: string | null = null;
    if (input.kind === WholesalerDocumentKind.CERTIFICATE) {
      if (!input.productId)
        throw new BadRequestException('Sertifikat uchun productId majburiy');
      productId = String((await this.ownProduct(shop, input.productId)).id);
    }
    const [row] = (await this.dataSource.query(
      `INSERT INTO catalog.wholesaler_document
         (shop_id, kind, product_id, object_key, file_name, content_type, size_bytes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (object_key) DO NOTHING
       RETURNING ${DOCUMENT_COLUMNS}`,
      [
        shop.id,
        input.kind,
        productId,
        input.objectKey,
        input.fileName,
        input.contentType,
        input.size,
        input.ownerUserId,
      ],
    )) as DocumentRow[];
    if (row) return documentRecord(row);
    // qayta tasdiq (javob yetib kelmagan) — o‘sha yozuv; kalit optovik papkasida, shuning uchun boshqa optovikniki emas
    const [existing] = (await this.dataSource.query(
      `SELECT ${DOCUMENT_COLUMNS} FROM catalog.wholesaler_document WHERE object_key = $1 AND shop_id = $2`,
      [input.objectKey, shop.id],
    )) as DocumentRow[];
    if (!existing) throw new ConflictException('Hujjat allaqachon yozilgan');
    return documentRecord(existing);
  }

  async listDocuments(
    wholesalerId: string,
  ): Promise<WholesalerDocumentRecord[]> {
    const rows = (await this.dataSource.query(
      `SELECT ${DOCUMENT_COLUMNS} FROM catalog.wholesaler_document
        WHERE shop_id = $1 ORDER BY id DESC`,
      [String(wholesalerId)],
    )) as DocumentRow[];
    return rows.map(documentRecord);
  }

  async getDocument(id: string): Promise<WholesalerDocumentRecord> {
    const rows = /^\d+$/.test(String(id ?? ''))
      ? ((await this.dataSource.query(
          `SELECT ${DOCUMENT_COLUMNS} FROM catalog.wholesaler_document WHERE id = $1`,
          [String(id)],
        )) as DocumentRow[])
      : [];
    if (!rows.length) throw new NotFoundException('Hujjat topilmadi');
    return documentRecord(rows[0]);
  }

  // ------------------------------------------------------------------ yordamchilar

  /** Optovik yozuvi (rekvizit va shartnoma bilan) — admin uchun. */
  async byId(id: unknown): Promise<Shop> {
    const shop = /^\d+$/.test(String(id ?? ''))
      ? await this.withPrivate()
          .where('shop.id = :id AND shop.is_deleted = FALSE', {
            id: String(id),
          })
          .getOne()
      : null;
    if (!shop) throw new NotFoundException('Optovik topilmadi');
    return shop;
  }

  private async requireOwnShop(ownerUserId: string): Promise<Shop> {
    const shop = await this.ownShop(ownerUserId, true);
    if (!shop)
      throw new NotFoundException(
        'Optovik yozuvi yo‘q — ro‘yxatni yakunlang (rekvizitlar)',
      );
    return shop;
  }

  private async ownShop(ownerUserId: string, strict: boolean) {
    if (!/^\d+$/.test(String(ownerUserId ?? ''))) {
      if (strict) throw new ForbiddenException('Optovik aniqlanmadi');
      return null;
    }
    return this.withPrivate()
      .where('shop.owner_user_id = :owner AND shop.is_deleted = FALSE', {
        owner: String(ownerUserId),
      })
      .getOne();
  }

  private async ownProduct(shop: Shop, productId: string): Promise<Product> {
    const product = /^\d+$/.test(String(productId ?? ''))
      ? await this.products.findOne({
          where: { id: String(productId), isDeleted: false },
        })
      : null;
    if (!product) throw new NotFoundException('Mahsulot topilmadi');
    if (String(product.shopId) !== String(shop.id))
      throw new ForbiddenException('Boshqa optovikning mahsuloti');
    return product;
  }

  private withPrivate() {
    return this.shops
      .createQueryBuilder('shop')
      .addSelect(WHOLESALER_PRIVATE_COLUMNS.map((c) => `shop.${c}`));
  }

  private async save(shop: Shop, repo = this.shops): Promise<Shop> {
    try {
      return await repo.save(shop);
    } catch (error) {
      const driver = (error as QueryFailedError).driverError as
        { code?: string; constraint?: string } | undefined;
      if (error instanceof QueryFailedError && driver?.code === '23505')
        throw new ConflictException(
          driver.constraint === 'uq_catalog_shop_tin'
            ? 'Bu STIR bilan optovik allaqachon bor'
            : driver.constraint === 'uq_catalog_shop_owner_user_id'
              ? 'Bu foydalanuvchi boshqa optovikka bog‘langan'
              : 'Bunday optovik allaqachon bor',
        );
      throw error;
    }
  }

  /** Optovik profili (rekvizitlar va shartnoma bilan). */
  async profile(shop: Shop): Promise<WholesalerProfileDto> {
    return this.profileView(shop);
  }

  private profileView(shop: Shop): WholesalerProfileDto {
    return toWholesalerDto(shop);
  }
}

const DOCUMENT_COLUMNS = `id::text AS id, shop_id::text AS "wholesalerId", kind, product_id::text AS "productId",
  object_key AS "objectKey", file_name AS "fileName", content_type AS "contentType", size_bytes AS size,
  created_at AS "createdAt"`;

type DocumentRow = Omit<WholesalerDocumentRecord, 'createdAt'> & {
  createdAt: Date;
};

function documentRecord(row: DocumentRow): WholesalerDocumentRecord {
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}
