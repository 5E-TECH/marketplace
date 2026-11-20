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
import { ProductService } from './product.service';
import { ProductVariantService } from './product-variant.service';
import { WholesalerService } from './wholesaler.service';

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

  beforeAll(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL nomida "test" bo‘lishi kerak');
    lock = new Client({ connectionString: url });
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [CATALOG_SCHEMA_TEST_LOCK]);
    await lock.query('DROP SCHEMA IF EXISTS catalog CASCADE');
    await lock.query('CREATE SCHEMA catalog');
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
    offers = new CatalogOfferService(ds.getRepository(Product));
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS catalog CASCADE');
      await ds.destroy();
    }
    await lock?.end(); // sessiya yopilsa qulf bo‘shaydi
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
    await expect(wholesalers.create(WHOLESALER)).rejects.toBeInstanceOf(
      ConflictException,
    );
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
    await ds.query(`UPDATE catalog.shop SET owner_user_id = 42 WHERE id = $1`, [
      wholesalerId,
    ]);
    await ds.query(
      `UPDATE catalog.product SET owner_user_id = 42 WHERE id = $1`,
      [productId],
    );
    await variants.createVariant('42', productId, { sku: 'Q-BLACK' } as never);
    await expect(
      variants.createVariant('42', productId, { sku: 'Q-WHITE' } as never),
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

  it('rad etilgan yoki CPA o‘chirilgan offer — sotuvdan olingan', async () => {
    await products.adminUpdate(productId, { cpaEnabled: false });
    await expect(offers.get(productId)).resolves.toMatchObject({
      cpaAvailable: false,
      withdrawn: true,
    });
    expect((await offers.list()).map((o) => o.productId)).not.toContain(
      productId,
    );
  });
});
