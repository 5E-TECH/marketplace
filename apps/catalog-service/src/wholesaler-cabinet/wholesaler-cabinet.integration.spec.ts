import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  ProductStatus,
  ShopStatus,
  WholesalerDocumentKind,
  WholesalerLegalType,
} from '@app/common';
import { CATALOG_DB } from '../database';
import { Category } from '../entities/category.entity';
import { Product } from '../entities/product.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import {
  ElchiTariffEntity,
  PriceDecision,
  PricePolicy,
} from '../entities/pricing.entity';
import { Shop } from '../entities/shop.entity';
import { PricingService } from '../pricing.service';
import { ProductService } from '../product.service';
import { WholesalerService } from '../wholesaler.service';
import { WholesalerCabinetService } from './wholesaler-cabinet.service';
import { wholesalerContractPdf } from './wholesaler-contract-pdf';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** catalog sxemasiga tegadigan spec’lar bilan bir xil qulf. */
const CATALOG_SCHEMA_TEST_LOCK = 2_304_004;

const PROFILE = {
  name: 'Termos Savdo MChJ',
  legalType: WholesalerLegalType.LEGAL_ENTITY,
  tin: '305999001',
  bankName: 'Ipotekabank',
  bankAccount: '20208000900999000001',
  bankMfo: '00873',
  address: 'Toshkent, Yunusobod 4',
};
const PRODUCT = {
  name: 'Termos 1 l',
  imageUrl: 'https://cdn.example.com/t.jpg',
  basePrice: 140_000,
  affiliateFee: 65_000,
  weightGrams: 450,
  lengthMm: 200,
  widthMm: 120,
  heightMm: 80,
};

/**
 * BE-30 haqiqiy PostgreSQL da: optovik o‘zi ro‘yxatdan o‘tadi (PENDING, elektron shartnoma), admin tasdiqlaydi,
 * admin kiritgan optovikka kabinet egasi bog‘lanadi; shartnomasiz mahsulot — 403 (TC1); narx hisobi o‘z mahsulotiga
 * 2.3 jadvali qiymatlari, boshqa optovikniki — 403 (TC6); hujjat yozuvi faqat o‘z yopiq papkasidan.
 */
describeWithPostgres('BE-30 optovik kabineti — catalog (PostgreSQL)', () => {
  let lock: Client | undefined;
  let ds: DataSource;
  let cabinet: WholesalerCabinetService;
  let wholesalers: WholesalerService;
  let products: ProductService;

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
    const pricing = new PricingService(
      ds.getRepository(Product),
      ds.getRepository(PricePolicy),
      ds.getRepository(ElchiTariffEntity),
      ds.getRepository(PriceDecision),
      emitter,
    );
    cabinet = new WholesalerCabinetService(
      ds.getRepository(Shop),
      ds.getRepository(Product),
      ds,
      products,
      pricing,
    );
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS catalog CASCADE');
      await ds.destroy();
    }
    await lock?.end();
  });

  it('o‘zi ro‘yxatdan o‘tish: PENDING, elektron shartnoma OPT-E-<id>, takror — o‘sha yozuv; STIR band — 409', async () => {
    await expect(cabinet.tinFree(PROFILE.tin)).resolves.toEqual({
      free: true,
    });
    const created = await cabinet.selfRegister({
      ...PROFILE,
      ownerUserId: '7001',
      phone: '+998901117001',
      contractVersion: '1.0',
    });
    expect(created).toMatchObject({
      status: ShopStatus.PENDING,
      ownerUserId: '7001',
      tin: PROFILE.tin,
      contractNumber: `OPT-E-${created.id}`,
      contractVersion: '1.0',
      phone: '+998901117001',
    });
    expect(created.contractDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(created.contractAcceptedAt).toBeTruthy();
    const again = await cabinet.selfRegister({
      ...PROFILE,
      ownerUserId: '7001',
      phone: '+998901117001',
      contractVersion: '1.0',
    });
    expect(again.id).toBe(created.id);
    await expect(cabinet.tinFree(PROFILE.tin)).resolves.toEqual({
      free: false,
    });
    await expect(
      cabinet.selfRegister({
        ...PROFILE,
        ownerUserId: '7002',
        phone: '+998901117002',
        contractVersion: '1.0',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('admin ko‘rib chiqadi: rad — sabab majburiy; tasdiq — ACTIVE; ikkinchi marta — 409', async () => {
    const own = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999002',
      ownerUserId: '7003',
      phone: '+998901117003',
      contractVersion: '1.0',
    });
    await expect(
      cabinet.review({ wholesalerId: own.id, decision: 'REJECT' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      cabinet.review({ wholesalerId: own.id, decision: 'APPROVE' }),
    ).resolves.toMatchObject({
      status: ShopStatus.ACTIVE,
      moderationNote: null,
    });
    await expect(
      cabinet.review({ wholesalerId: own.id, decision: 'REJECT', note: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
    // eski marketplace do‘koni (PENDING, elektron shartnomasiz) bu yo‘l bilan faollashmaydi
    const [legacy] = (await ds.query(
      `INSERT INTO catalog.shop (owner_user_id, name, slug, status) VALUES (8001, 'Eski', 'eski-8001', 'PENDING') RETURNING id::text`,
    )) as Array<{ id: string }>;
    await expect(
      cabinet.review({ wholesalerId: legacy.id, decision: 'APPROVE' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rad etilgan ariza STIR ni band qilmaydi: boshqa ariza va admin kiritishi o‘tadi; rad etilgan qayta yuboradi (yana PENDING)', async () => {
    const squatter = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999010',
      ownerUserId: '7060',
      phone: '+998901117060',
      contractVersion: '1.0',
    });
    await cabinet.review({
      wholesalerId: squatter.id,
      decision: 'REJECT',
      note: 'STIR boshqa kompaniyaniki',
    });
    await expect(cabinet.tinFree('305999010')).resolves.toEqual({ free: true });
    const real = await wholesalers.create({
      ...PROFILE,
      tin: '305999010',
      contractNumber: 'K-2026/040',
      contractDate: '2026-11-22',
    });
    expect(real.status).toBe(ShopStatus.ACTIVE);
    // rad etilgan foydalanuvchi o‘z STIR i bilan qayta yuboradi
    const again = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999011',
      ownerUserId: '7060',
      phone: '+998901117060',
      contractVersion: '1.1',
    });
    expect(again).toMatchObject({
      id: squatter.id,
      status: ShopStatus.PENDING,
      tin: '305999011',
      contractVersion: '1.1',
      moderationNote: null,
    });
    // band STIR bilan qayta yuborish — 409
    await cabinet.review({
      wholesalerId: again.id,
      decision: 'REJECT',
      note: 'x',
    });
    await expect(
      cabinet.selfRegister({
        ...PROFILE,
        tin: '305999010',
        ownerUserId: '7060',
        phone: '+998901117060',
        contractVersion: '1.1',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('admin kiritgan optovikka kabinet egasi: egasiz mahsulotlari ham bog‘lanadi; boshqa egaga — 409', async () => {
    const admin = await wholesalers.create({
      ...PROFILE,
      tin: '305999003',
      contractNumber: 'K-2026/030',
      contractDate: '2026-11-20',
    });
    const product = await products.adminCreate(admin.id, {
      ...PRODUCT,
      wholesalerId: admin.id,
    });
    expect(product.ownerUserId).toBeNull();
    const linked = await cabinet.linkOwner({
      wholesalerId: admin.id,
      ownerUserId: '7010',
    });
    expect(linked).toMatchObject({
      ownerUserId: '7010',
      contractVersion: null,
    });
    await expect(
      cabinet.linkOwner({ wholesalerId: admin.id, ownerUserId: '7010' }),
    ).resolves.toMatchObject({ ownerUserId: '7010' });
    await expect(
      cabinet.linkOwner({ wholesalerId: admin.id, ownerUserId: '7011' }),
    ).rejects.toMatchObject({ status: 409 });
    const [row] = (await ds.query(
      'SELECT owner_user_id::text AS owner FROM catalog.product WHERE id = $1',
      [product.id],
    )) as Array<{ owner: string }>;
    expect(row.owner).toBe('7010');
    expect((await cabinet.listProducts('7010')).total).toBe(1);
  });

  it('TC1: shartnomasiz optovik mahsulot taklif qila olmaydi — 403; shartnoma bilan — PENDING_REVIEW, CPA/BAD sukut', async () => {
    const noContract = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999004',
      ownerUserId: '7020',
      phone: '+998901117020',
      contractVersion: '1.0',
    });
    await ds.query(
      `UPDATE catalog.shop SET contract_number = NULL WHERE id = $1`,
      [noContract.id],
    );
    await expect(cabinet.createProduct('7020', PRODUCT)).rejects.toMatchObject({
      status: 403,
    });
    const own = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999005',
      ownerUserId: '7021',
      phone: '+998901117021',
      contractVersion: '1.0',
    });
    const created = await cabinet.createProduct('7021', {
      ...PRODUCT,
      isBad: true,
      cpaEnabled: false,
    } as never);
    expect(created).toMatchObject({
      status: ProductStatus.PENDING_REVIEW,
      shopId: own.id,
      ownerUserId: '7021',
      isBad: false,
      cpaEnabled: true,
      affiliateFee: null, // sotuvchi haqini platforma belgilaydi
    });
    await cabinet.review({
      wholesalerId: own.id,
      decision: 'REJECT',
      note: 'STIR mos emas',
    });
    await expect(cabinet.createProduct('7021', PRODUCT)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('TC6: o‘z mahsulotining narx hisobi — tavsiya 251 000, zararsizlik 240 561, chegara 225 206; boshqa optovikniki — 403', async () => {
    const own = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999006',
      ownerUserId: '7030',
      phone: '+998901117030',
      contractVersion: '1.0',
    });
    const product = await cabinet.createProduct('7030', PRODUCT);
    // sotuvchi haqini admin belgilaydi (BE-07 tahriri)
    await products.adminUpdate(String(product.id), { affiliateFee: 65_000 });
    const view = await cabinet.pricingView('7030', String(product.id));
    expect(view.calculation).toMatchObject({
      recommendedBase: 251_000,
      breakevenBase: 240_561,
      hardFloorBase: 225_206,
    });
    expect(view.evaluation.split).toEqual(
      expect.objectContaining({
        wholesaler: expect.any(Number),
        affiliate: expect.any(Number),
        callCenter: expect.any(Number),
        platformService: expect.any(Number),
      }),
    );
    expect(view).not.toHaveProperty('params');
    expect(view).not.toHaveProperty('tariff');
    await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999007',
      ownerUserId: '7031',
      phone: '+998901117031',
      contractVersion: '1.0',
    });
    await expect(
      cabinet.pricingView('7031', String(product.id)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      cabinet.getProduct('7031', String(product.id)),
    ).rejects.toMatchObject({ status: 403 });
    expect((await cabinet.variants(own.id)).map((v) => v.productId)).toEqual([
      String(product.id),
    ]);
  });

  it('hujjat: faqat o‘z yopiq papkasidan; sertifikat — o‘z mahsulotiga; ro‘yxat va kalit', async () => {
    const own = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999008',
      ownerUserId: '7040',
      phone: '+998901117040',
      contractVersion: '1.0',
    });
    const product = await cabinet.createProduct('7040', PRODUCT);
    const base = {
      ownerUserId: '7040',
      fileName: 'guvohnoma.pdf',
      contentType: 'application/pdf',
      size: 1024,
    };
    await expect(
      cabinet.addDocument({
        ...base,
        kind: WholesalerDocumentKind.KYC,
        objectKey: `private/wholesaler/999/00000000-0000-0000-0000-000000000000.pdf`,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      cabinet.addDocument({
        ...base,
        kind: WholesalerDocumentKind.CERTIFICATE,
        objectKey: `private/wholesaler/${own.id}/00000000-0000-0000-0000-000000000001.pdf`,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const kyc = await cabinet.addDocument({
      ...base,
      kind: WholesalerDocumentKind.KYC,
      objectKey: `private/wholesaler/${own.id}/00000000-0000-0000-0000-000000000002.pdf`,
    });
    const cert = await cabinet.addDocument({
      ...base,
      kind: WholesalerDocumentKind.CERTIFICATE,
      productId: String(product.id),
      objectKey: `private/wholesaler/${own.id}/00000000-0000-0000-0000-000000000003.pdf`,
    });
    expect(cert).toMatchObject({
      wholesalerId: own.id,
      productId: String(product.id),
    });
    // qayta tasdiq (javob yetib kelmagan) — o‘sha yozuv, 500 emas
    await expect(
      cabinet.addDocument({
        ...base,
        kind: WholesalerDocumentKind.KYC,
        objectKey: `private/wholesaler/${own.id}/00000000-0000-0000-0000-000000000002.pdf`,
      }),
    ).resolves.toMatchObject({ id: kyc.id });
    expect((await cabinet.listDocuments(own.id)).map((d) => d.id)).toEqual([
      cert.id,
      kyc.id,
    ]);
    await expect(cabinet.getDocument(kyc.id)).resolves.toMatchObject({
      objectKey: `private/wholesaler/${own.id}/00000000-0000-0000-0000-000000000002.pdf`,
    });
  });

  it('shartnoma PDF: rekvizitlar va qabul qilingan versiya matni (kirill ham)', async () => {
    const own = await cabinet.selfRegister({
      ...PROFILE,
      tin: '305999009',
      ownerUserId: '7050',
      phone: '+998901117050',
      contractVersion: '1.0',
    });
    const pdf = await wholesalerContractPdf(await cabinet.me('7050'), {
      type: 'wholesaler-contract' as never,
      version: '1.0',
      effectiveAt: null,
      summary: [],
      sections: [
        { id: '1', title: '1. Предмет', body: 'Komitent tovarni topshiradi.' },
      ],
    });
    expect(pdf.fileName).toBe(`shartnoma-OPT-E-${own.id}.pdf`);
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe(
      '%PDF-',
    );
  });
});
