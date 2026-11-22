import { BadRequestException, ConflictException } from '@nestjs/common';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { ProductStatus } from '@app/common';
import { CATALOG_DB } from './database';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { Shop } from './entities/shop.entity';
import { CatalogOfferService } from './catalog-offer.service';
import { CreativeService } from './creative.service';
import { Creative } from './entities/creative.entity';
import { ProductService } from './product.service';
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
          // BE-27: sotuvdan chiqqan partiyalar (moderatsiya hisoblagichi) — bitta
          p.cmd === 'inventory.lots.list'
            ? of([{ id: '1', blocked: true }])
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
    const before = await offers.moderationSummary();
    const db = await counts();
    const total = Object.values(db).reduce((a, b) => a + b, 0);
    expect(before.byStatus.ALL).toBe(total);
    expect(before.productsPending).toBe(db.PENDING_REVIEW ?? 0);
    expect(before.byStatus.ACTIVE).toBe(db.ACTIVE ?? 0);
    expect(before.byStatus.REJECTED).toBe(db.REJECTED ?? 0);
    expect(before.expirySoon).toBe(1);
    expect(before.outOfStock).toBe(0);

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
  });
});
