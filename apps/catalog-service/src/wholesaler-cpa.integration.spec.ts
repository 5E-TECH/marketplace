import { BadRequestException, ConflictException } from '@nestjs/common';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  AdminProductAttention,
  AdminProductsQueryDto,
  ProductStatus,
} from '@app/common';
import { CATALOG_DB } from './database';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { Shop } from './entities/shop.entity';
import { CategoryService } from './category.service';
import { CatalogOfferService } from './catalog-offer.service';
import { CreativeService } from './creative.service';
import { Creative } from './entities/creative.entity';
import { ProductService } from './product.service';
import { ProductArchiveService } from './product-archive.service';
import { AdminProductListService } from './admin-product-list.service';
import { ProductVariantService } from './product-variant.service';
import { WholesalerService } from './wholesaler.service';
import { PricingService } from './pricing.service';
import {
  ElchiTariffEntity,
  PriceDecision,
  PricePolicy,
} from './entities/pricing.entity';
import { WholesalerCpaProduct1796083200000 } from './migrations/1796083200000-wholesaler-cpa-product';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** banner.integration.spec.ts dagi bilan bir xil: catalog sxemasiga tegadigan spec’lar ketma-ket. */
const CATALOG_SCHEMA_TEST_LOCK = 2_304_004;

const WHOLESALER = {
  name: 'Gadget Trade MChJ',
  legalType: 'LEGAL_ENTITY' as never,
  tin: '305123456',
  bankName: 'Kapitalbank',
  bankAccount: '20208000900123456001',
  bankMfo: '01158',
  contractNumber: 'K-2026/014',
  contractDate: '2026-11-20',
};
const PHYS = {
  basePrice: 140000,
  weightGrams: 450,
  lengthMm: 200,
  widthMm: 120,
  heightMm: 80,
  // BE-41: CPA mahsuloti tasdiqdan oldin fiskal chek kodlari bilan
  mxikCode: '08517001001000000',
  packageCode: '1500012',
};

/**
 * BE-07 haqiqiy PostgreSQL da, hamma catalog migratsiyasi bilan: optovikni admin kiritadi (TC5), yangi mahsulot
 * PENDING_REVIEW va offerlarda yo‘q (TC1), tasdiqdan keyin bor (TC2), og‘irliksiz — 400 (TC3), slug global (TC4),
 * CPA da ikkinchi variant — 400 (TC6), BAD belgisi saqlanadi va o‘qiladi (TC7), shartnomasiz — 409 (OPT-1).
 */
describeWithPostgres('BE-07 optovik va CPA mahsulot (PostgreSQL)', () => {
  let lock: Client | undefined;
  let ds: DataSource;
  let wholesalers: WholesalerService;
  let products: ProductService;
  let variants: ProductVariantService;
  let offers: CatalogOfferService;
  let wholesalerId: string;
  let productId: string;
  let oldSlugs: Record<string, string>;
  let oldCpa: boolean[];
  /** BE-27/BE-25: sotuvdan chiqqan partiyalar shu variantlarda (inventory stubi). */
  let blockedLotVariants: string[] = [];

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [CATALOG_SCHEMA_TEST_LOCK]);
    await lock.query('DROP SCHEMA IF EXISTS catalog CASCADE');
    await lock.query('CREATE SCHEMA catalog');

    // Eski bazaga o‘xshash: BE-07 dan oldingi migratsiyalar, slug takrorlari (shu jumladan `iphone-15` bilan
    // to‘qnashishi mumkin bo‘lgan) va faol eski mahsulot — keyin BE-07 migratsiyasi
    const old = await new DataSource({
      type: 'postgres',
      url,
      schema: 'catalog',
      // faqat BE-07 dan oldingilari (keyingi migratsiyalar BE-07 jadvallariga tayanadi — BE-30 STIR indeksi)
      migrations: CATALOG_DB.migrations.filter(
        (m) =>
          Number(/\d{13}$/.exec(m.name)?.[0]) <
          Number(/\d{13}$/.exec(WholesalerCpaProduct1796083200000.name)?.[0]),
      ),
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    await old.query(`INSERT INTO catalog.shop (id, owner_user_id, name, slug, status) VALUES
      (901, 42, 'Eski do‘kon A', 'eski-a', 'ACTIVE'), (902, 43, 'Eski do‘kon B', 'eski-b', 'ACTIVE')`);
    await old.query(`INSERT INTO catalog.product (id, shop_id, owner_user_id, name, slug, price, status) VALUES
      (9001, 901, 42, 'iPhone', 'iphone', 100, 'ACTIVE'),
      (9015, 902, 43, 'iPhone', 'iphone', 100, 'ACTIVE'),
      (9007, 902, 43, 'iPhone 15', 'iphone-9015', 100, 'ACTIVE')`);
    await old.destroy();
    ds = await new DataSource({
      type: 'postgres',
      url,
      schema: 'catalog',
      entities: CATALOG_DB.entities as never,
      migrations: CATALOG_DB.migrations,
      migrationsRun: true,
      synchronize: false,
      logging: false,
    }).initialize();
    const emitter = { emit: () => of(undefined) } as never;
    wholesalers = new WholesalerService(ds.getRepository(Shop));
    products = new ProductService(
      ds.getRepository(Product),
      ds.getRepository(Shop),
      ds.getRepository(Category),
      ds.getRepository(ProductVariant),
      emitter,
      emitter,
    );
    variants = new ProductVariantService(
      ds.getRepository(Product),
      ds.getRepository(ProductVariant),
    );
    offers = new CatalogOfferService(
      ds.getRepository(Product),
      new PricingService(
        ds.getRepository(Product),
        ds.getRepository(PricePolicy),
        ds.getRepository(ElchiTariffEntity),
        ds.getRepository(PriceDecision),
        emitter,
      ),
      ds.getRepository(ProductVariant),
      // BE-16: inventory — har bir faol variantda 5 dona bo‘sh qoldiq
      {
        send: (p: { cmd: string }, d: { variantIds: string[] }) =>
          // BE-27: sotuvdan chiqqan partiyalar (moderatsiya hisoblagichi)
          p.cmd === 'inventory.lots.list'
            ? of(
                blockedLotVariants.map((variantId, i) => ({
                  id: String(i + 1),
                  variantId,
                  blocked: true,
                })),
              )
            : // BE-25 (FE-12): ro‘yxat qatori — omborda 6, band 1, sotsa bo‘ladigan 5, yo‘lda 10
              p.cmd === 'inventory.stock.summary'
              ? of(
                  Object.fromEntries(
                    d.variantIds.map((id) => [
                      id,
                      { onHand: 6, reserved: 1, available: 5, incoming: 10 },
                    ]),
                  ),
                )
              : of(Object.fromEntries(d.variantIds.map((id) => [id, 5]))),
      } as never,
      new CreativeService(
        ds.getRepository(Creative),
        ds.getRepository(Product),
      ),
    );
    const rows = (await ds.query(
      `SELECT id::text, slug, cpa_enabled FROM catalog.product WHERE id >= 9000 ORDER BY id`,
    )) as Array<{ id: string; slug: string; cpa_enabled: boolean }>;
    oldSlugs = Object.fromEntries(rows.map((r) => [r.id, r.slug]));
    oldCpa = rows.map((r) => r.cpa_enabled);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS catalog CASCADE');
      await ds.destroy();
    }
    await lock?.end(); // sessiya yopilsa qulf bo‘shaydi
  });

  it('migratsiya: slug takrorlari `--<id>` bilan ajratildi (mavjud `iphone-9015` bilan to‘qnashmadi); eski mahsulotlar CPA ga ochilmadi', async () => {
    expect(oldSlugs).toEqual({
      '9001': 'iphone',
      '9007': 'iphone-9015',
      '9015': 'iphone--9015',
    });
    expect(oldCpa).toEqual([false, false, false]);
    const listed = (await offers.list()).map((o) => o.productId);
    expect(listed).not.toContain('9001');
  });

  it('TC5: admin optovikni foydalanuvchisiz, STIR, bank rekvizitlari va shartnoma bilan yaratadi; takror — 409', async () => {
    const created = await wholesalers.create(WHOLESALER);
    wholesalerId = created.id;
    expect(created).toMatchObject({
      ...WHOLESALER,
      ownerUserId: null,
      status: 'ACTIVE',
    });
    await expect(wholesalers.get(created.id)).resolves.toMatchObject({
      tin: '305123456',
      contractDate: '2026-11-20',
    });
    // slugda STIR yo‘q (ochiq manzil); bitta STIR — bitta optovik
    expect(created.slug).toBe(`gadget-trade-mchj-${created.id}`);
    await expect(
      wholesalers.create({ ...WHOLESALER, name: 'Boshqa nom' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // rekvizitlar oddiy o‘qishda (storefront, mahsulot join) chiqmaydi
    const plain = await ds
      .getRepository(Shop)
      .findOneByOrFail({ id: created.id });
    expect(plain).not.toHaveProperty('tin');
    expect(plain).not.toHaveProperty('bankAccount');
    // BE-33: bank fayli uchun ichki RPC — rekvizitlar bilan; noma’lum id — ro‘yxatda yo‘q
    await expect(
      wholesalers.paymentDetails([created.id, '999999', 'x']),
    ).resolves.toEqual([
      {
        id: created.id,
        name: WHOLESALER.name,
        tin: '305123456',
        bankName: WHOLESALER.bankName,
        bankAccount: '20208000900123456001',
        bankMfo: '01158',
        contractNumber: WHOLESALER.contractNumber,
        contractDate: WHOLESALER.contractDate,
      },
    ]);
    expect(plain).not.toHaveProperty('contractNumber');
    const withProduct = await ds
      .getRepository(Product)
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.shop', 'shop')
      .getOne();
    expect(withProduct?.shop).not.toHaveProperty('bankAccount');
    await expect(
      wholesalers.list({ search: '305123456' }),
    ).resolves.toMatchObject({ total: 1 });
  });

  it('TC1: optovik nomidan mahsulot — PENDING_REVIEW, offerlarda ko‘rinmaydi', async () => {
    const product = await products.adminCreate(wholesalerId, {
      wholesalerId,
      name: 'Simsiz quloqchin',
      imageUrl: 'https://cdn.example.com/q.jpg',
      affiliateFee: 65000,
      ...PHYS,
    });
    productId = String(product.id);
    expect(product).toMatchObject({
      status: ProductStatus.PENDING_REVIEW,
      shopId: wholesalerId,
      ownerUserId: null,
    });
    expect((await offers.list()).map((o) => o.productId)).not.toContain(
      productId,
    );
    await expect(offers.get(productId)).resolves.toMatchObject({
      cpaAvailable: false,
      withdrawn: false,
    });
  });

  it('TC2: admin tasdiqladi — ACTIVE, offerlar ro‘yxatida bor', async () => {
    await products.adminApprove(productId);
    const listed = (await offers.list()).find((o) => o.productId === productId);
    expect(listed).toMatchObject({
      name: 'Simsiz quloqchin',
      cpaAvailable: true,
      withdrawn: false,
      weightGrams: 450,
      affiliateFee: 65000,
      isBad: false,
      approvedPrice: null, // BE-09
      stock: 5, // BE-16: faol variant qoldig‘i inventory dan
    });
    expect(
      (await offers.list({ productIds: [productId, 'x'] })).map(
        (o) => o.productId,
      ),
    ).toEqual([productId]);
  });

  it('TC3: og‘irliksiz mahsulot — 400, saqlanmaydi', async () => {
    const before = await ds.getRepository(Product).count();
    const { weightGrams: _w, ...withoutWeight } = PHYS;
    await expect(
      products.adminCreate(wholesalerId, {
        wholesalerId,
        name: 'Og‘irliksiz',
        imageUrl: 'https://cdn.example.com/o.jpg',
        ...withoutWeight,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(ds.getRepository(Product).count()).resolves.toBe(before);
  });

  it('TC4: slug global unikal — bir xil nom yangi slug oladi, bazada takror slug rad etiladi', async () => {
    const other = await wholesalers.create({
      ...WHOLESALER,
      name: 'Boshqa optovik',
      tin: '305000001',
    });
    const twin = await products.adminCreate(other.id, {
      wholesalerId: other.id,
      name: 'Simsiz quloqchin',
      imageUrl: 'https://cdn.example.com/q2.jpg',
      ...PHYS,
    });
    expect(twin.slug).toBe('simsiz-quloqchin-2');
    await expect(
      ds.query(
        `UPDATE catalog.product SET slug = 'simsiz-quloqchin' WHERE id = $1`,
        [twin.id],
      ),
    ).rejects.toThrow(/uq_catalog_product_slug/);
  });

  it('TC6: CPA mahsulotiga ikkinchi faol variant — 400', async () => {
    // BE-30 dagi optovik foydalanuvchisi kabi: mahsulot va optovikka egasi biriktirilgan
    await ds.query(
      `UPDATE catalog.shop SET owner_user_id = 4242 WHERE id = $1`,
      [wholesalerId],
    );
    await ds.query(
      `UPDATE catalog.product SET owner_user_id = 4242 WHERE id = $1`,
      [productId],
    );
    await variants.createVariant('4242', productId, {
      sku: 'Q-BLACK',
    } as never);
    await expect(
      variants.createVariant('4242', productId, { sku: 'Q-WHITE' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ds.getRepository(ProductVariant).count({
        where: { productId, isActive: true },
      }),
    ).resolves.toBe(1);
  });

  it('TC7: BAD belgisi admin API da saqlanadi va o‘qiladi (offerda ham)', async () => {
    await products.adminUpdate(productId, { isBad: true });
    await expect(products.adminGet(productId)).resolves.toMatchObject({
      isBad: true,
    });
    await expect(offers.get(productId)).resolves.toMatchObject({
      isBad: true,
    });
  });

  it('BE-25 (OMB-3, TZ 8): toifa belgisi mahsulotga o‘tadi — «muddat kuzatiladi» ro‘yxat, karta va ko‘rinish javobida; BAD toifasi offerda', async () => {
    const categories = new CategoryService(ds.getRepository(Category));
    const parent = await categories.create({
      name: 'Parvarish BE25',
      expiryTracked: true,
    });
    const child = await categories.create({
      name: 'Kremlar BE25',
      slug: 'kremlar-be25',
      parentId: String(parent.id),
    });
    await products.adminUpdate(productId, {
      isBad: false,
      categoryId: String(child.id),
    });
    const badByCategory = async () =>
      (await products.adminGet(productId)).badByCategory;
    const tracked = async () => ({
      list: (
        await products.adminList({ shopId: wholesalerId, page: 1, limit: 100 })
      ).items.find((p) => String(p.id) === productId)?.expiryTracked,
      card: (await products.adminGet(productId)).expiryTracked,
      display: (await offers.displayLookup({ productIds: [productId] }))
        .products[0].expiryTracked,
      offerBad: (await offers.get(productId))?.isBad,
    });
    await expect(tracked()).resolves.toEqual({
      list: true,
      card: true,
      display: true,
      offerBad: false,
    });
    await categories.update(String(child.id), { expiryTracked: false });
    await expect(tracked()).resolves.toEqual({
      list: false,
      card: false,
      display: false,
      offerBad: false,
    });
    await expect(badByCategory()).resolves.toBe(false);
    await categories.update(String(parent.id), { isBad: true });
    await expect(badByCategory()).resolves.toBe(true);
    await expect(tracked()).resolves.toEqual({
      list: true,
      card: true,
      display: true,
      offerBad: true,
    });
    const listed = (await offers.list({ productIds: [productId] }))[0];
    expect(listed.isBad).toBe(true);
    // mahsuloti bor toifa o‘chmaydi
    await expect(categories.remove(String(child.id))).rejects.toMatchObject({
      status: 409,
    });
    // ombor qoldiq ro‘yxati: optovik nomi va shtrix-kod
    const [variant] = await ds
      .getRepository(ProductVariant)
      .find({ where: { productId } });
    await expect(
      variants.getInventoryDetails(null, [String(variant.id)]),
    ).resolves.toEqual([
      expect.objectContaining({
        wholesalerName: WHOLESALER.name,
        barcode: variant.barcode,
      }),
    ]);
    await products.adminUpdate(productId, { isBad: true });
    await categories.update(String(parent.id), {
      isBad: null,
      expiryTracked: null,
    });
  });

  it('BE-25: optovik qidiruvida `%` va `_` — oddiy belgi (hamma optovik chiqmaydi)', async () => {
    const total = async (search: string) =>
      (await wholesalers.list({ search, page: 1, limit: 100 })).total;
    await expect(total('%')).resolves.toBe(0);
    await expect(total('_')).resolves.toBe(0);
    await expect(total(WHOLESALER.name.slice(0, 5))).resolves.toBeGreaterThan(
      0,
    );
  });

  it('OPT-1: shartnomasiz optovikka mahsulot qo‘shib bo‘lmaydi — 409', async () => {
    const bare = await wholesalers.create({
      ...WHOLESALER,
      name: 'Shartnomasiz',
      tin: '305000002',
    });
    await ds.query(
      `UPDATE catalog.shop SET contract_number = NULL, contract_date = NULL WHERE id = $1`,
      [bare.id],
    );
    await expect(
      products.adminCreate(bare.id, {
        wholesalerId: bare.id,
        name: 'Telefon',
        imageUrl: 'https://cdn.example.com/t.jpg',
        ...PHYS,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('to‘xtatilgan optovik offeri sotuvdan olinadi; qayta faollashtirish — qaytadi', async () => {
    await wholesalers.update(wholesalerId, { status: 'SUSPENDED' as never });
    await expect(offers.get(productId)).resolves.toMatchObject({
      cpaAvailable: false,
      withdrawn: true,
    });
    await wholesalers.update(wholesalerId, { status: 'ACTIVE' as never });
    await expect(offers.get(productId)).resolves.toMatchObject({
      cpaAvailable: true,
    });
  });

  it('rad etilgan offer — sotuvdan olingan', async () => {
    const extra = await products.adminCreate(wholesalerId, {
      wholesalerId,
      name: 'Rad etiladigan',
      imageUrl: 'https://cdn.example.com/r.jpg',
      ...PHYS,
    });
    await products.adminApprove(String(extra.id));
    await products.adminReject(String(extra.id), 'Sertifikat yo‘q');
    await expect(offers.get(String(extra.id))).resolves.toMatchObject({
      cpaAvailable: false,
      withdrawn: true,
    });
  });

  it('CPA o‘chirilgan offer — sotuvdan olingan', async () => {
    await products.adminUpdate(productId, { cpaEnabled: false });
    await expect(offers.get(productId)).resolves.toMatchObject({
      cpaAvailable: false,
      withdrawn: true,
    });
    expect((await offers.list()).map((o) => o.productId)).not.toContain(
      productId,
    );
  });

  it('BE-27: moderatsiya hisoblagichlari bazadagi holat bilan bir xil; yashirish sababi saqlanadi', async () => {
    const counts = async () =>
      Object.fromEntries(
        (
          (await ds.query(
            `SELECT CASE WHEN p.is_blocked THEN 'BLOCKED' ELSE p.status END AS k, count(*)::int AS n
               FROM catalog.product p JOIN catalog.shop s ON s.id = p.shop_id
              WHERE p.is_deleted = FALSE GROUP BY 1`,
          )) as Array<{ k: string; n: number }>
        ).map((r) => [r.k, r.n]),
      );
    // bitta sotuvdan chiqqan partiya — ikki partiya bitta mahsulotda: hisoblagich mahsulotlar soni (BE-25)
    const [lotVariant] = (await ds.query(
      `SELECT v.id::text AS id FROM catalog.product_variant v JOIN catalog.product p ON p.id = v.product_id
        WHERE p.is_deleted = FALSE ORDER BY v.id LIMIT 1`,
    )) as Array<{ id: string }>;
    blockedLotVariants = [lotVariant.id, lotVariant.id];
    const before = await offers.moderationSummary();
    const db = await counts();
    const total = Object.values(db).reduce((a, b) => a + b, 0);
    expect(before.byStatus.ALL).toBe(total);
    expect(before.productsPending).toBe(db.PENDING_REVIEW ?? 0);
    expect(before.byStatus.ACTIVE).toBe(db.ACTIVE ?? 0);
    expect(before.byStatus.REJECTED).toBe(db.REJECTED ?? 0);
    expect(before.expirySoon).toBe(1);
    expect(before.outOfStock).toBe(0);

    // BE-25 (FE-12): «Diqqat» filtri qatorlari = hisoblagich; kanal va kategoriya filtrlari; qator qo‘shimchalari
    const lists = new AdminProductListService(products, offers);
    const q = (over: Record<string, unknown>) =>
      Object.assign(new AdminProductsQueryDto(), { limit: 100 }, over);
    const expiring = await lists.list(
      q({ attention: AdminProductAttention.EXPIRY_SOON }),
    );
    expect(expiring.total).toBe(before.expirySoon);
    await expect(
      lists.list(q({ attention: AdminProductAttention.OUT_OF_STOCK })),
    ).resolves.toMatchObject({ total: 0, items: [] });
    const all = await lists.list(q({}));
    const cpa = await lists.list(q({ cpaEnabled: true }));
    const site = await lists.list(q({ cpaEnabled: false }));
    expect(cpa.total + site.total).toBe(all.total);
    expect(cpa.items.every((p) => p.cpaEnabled)).toBe(true);
    const [withCategory] = (await ds.query(
      `SELECT category_id::text AS id FROM catalog.product WHERE is_deleted = FALSE AND category_id IS NOT NULL LIMIT 1`,
    )) as Array<{ id: string }>;
    if (withCategory) {
      const inCategory = await lists.list(q({ categoryId: withCategory.id }));
      expect(inCategory.total).toBeGreaterThan(0);
      expect(
        inCategory.items.every((p) => String(p.categoryId) === withCategory.id),
      ).toBe(true);
    }
    // slug bo‘yicha qidiruv
    const [bySlug] = (await ds.query(
      `SELECT id::text AS id, slug FROM catalog.product WHERE is_deleted = FALSE ORDER BY id LIMIT 1`,
    )) as Array<{ id: string; slug: string }>;
    expect(
      (await lists.list(q({ search: bySlug.slug }))).items.map((p) =>
        String(p.id),
      ),
    ).toContain(bySlug.id);
    // qo‘shimchalar: omborchiga yo‘q, adminga — ombor, narx, video
    expect(all).not.toHaveProperty('unavailable');
    const rich = (await lists.list(q({ cpaEnabled: true }), true)) as {
      items: Array<
        Record<string, unknown> & { id: string; approvedPrice: number | null }
      >;
      unavailable: string[];
    };
    expect(rich.unavailable).toEqual([]);
    expect(rich.items.length).toBeGreaterThan(0);
    for (const row of rich.items) {
      expect(row.stock).toEqual({
        onHand: 6,
        reserved: 1,
        available: 5,
        incoming: 10,
      });
      expect(row.hasVideo).toBe(false);
      const listPrice = row.listPrice as {
        customer: number;
        recommended: boolean;
        delivery: number;
      } | null;
      expect(listPrice).not.toBeNull();
      expect(listPrice!.recommended).toBe(row.approvedPrice == null);
      if (row.approvedPrice != null)
        expect(listPrice!.customer).toBe(row.approvedPrice);
      // ko‘rinadigan yetkazish — offer bilan bir xil (sukut: qisman, 30 000)
      expect(listPrice!.delivery).toBe(30_000);
    }

    const extra = await products.adminCreate(wholesalerId, {
      wholesalerId,
      name: 'Moderatsiya hisobi',
      imageUrl: 'https://cdn.example.com/m.jpg',
      ...PHYS,
    });
    let s = await offers.moderationSummary();
    expect(s.productsPending).toBe(before.productsPending + 1);
    // tasdiqlanmagan narx — narx qarori kutadi
    expect(s.pricesPending).toBeGreaterThanOrEqual(1);

    await products.adminApprove(String(extra.id));
    await products.adminHide(
      String(extra.id),
      '  Sertifikat muddati tugagan  ',
    );
    s = await offers.moderationSummary();
    expect(s.byStatus.BLOCKED).toBe((before.byStatus.BLOCKED ?? 0) + 1);
    await expect(products.adminGet(String(extra.id))).resolves.toMatchObject({
      isBlocked: true,
      blockReason: 'Sertifikat muddati tugagan',
    });
    await products.adminReactivate(String(extra.id));
    await expect(products.adminGet(String(extra.id))).resolves.toMatchObject({
      isBlocked: false,
      blockReason: null,
    });

    // BE-25 (FE-25): arxivlash — sotuvdagisi 409; to‘xtatilgach arxivga, «To‘xtatilgan» da emas, «Arxiv» da
    const none = {
      send: () => of({ items: [], totals: { onHand: 0, reserved: 0 } }),
    };
    const archives = new ProductArchiveService(
      ds.getRepository(Product),
      ds.getRepository(ProductVariant),
      products,
      none as never,
      { send: () => of({}) } as never,
    );
    await expect(archives.archive(String(extra.id))).rejects.toBeInstanceOf(
      ConflictException,
    );
    await products.adminSuspend(String(extra.id));
    const blockedBefore = (await offers.moderationSummary()).byStatus.BLOCKED;
    await expect(archives.archive(String(extra.id))).resolves.toMatchObject({
      status: ProductStatus.ARCHIVED,
      isBlocked: true,
    });
    s = await offers.moderationSummary();
    expect(s.byStatus.ARCHIVED).toBe(1);
    expect(s.byStatus.BLOCKED).toBe(blockedBefore - 1);
    const ids = async (query: Record<string, unknown>) =>
      (
        await products.adminList(
          Object.assign(new AdminProductsQueryDto(), query),
        )
      ).items.map((p) => String(p.id));
    expect(await ids({ blocked: true })).not.toContain(String(extra.id));
    expect(await ids({ status: ProductStatus.ARCHIVED })).toEqual([
      String(extra.id),
    ]);
    await expect(
      products.adminReactivate(String(extra.id)),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
