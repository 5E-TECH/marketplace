import { BadRequestException } from '@nestjs/common';
import { Client } from 'pg';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import { CreativeType, PriceStatus } from '@app/common';
import { CATALOG_DB } from './database';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { Shop } from './entities/shop.entity';
import {
  ElchiTariffEntity,
  PriceDecision,
  PricePolicy,
  PricePolicyScope,
} from './entities/pricing.entity';
import { CatalogOfferService } from './catalog-offer.service';
import { CreativeService } from './creative.service';
import { Creative } from './entities/creative.entity';
import { PricingService } from './pricing.service';
import { ProductService } from './product.service';
import { WholesalerService } from './wholesaler.service';

const url = process.env.TEST_DATABASE_URL;
const describeWithPostgres = url ? describe : describe.skip;
/** banner va wholesaler-cpa spec’lari bilan bir xil: catalog sxemasiga tegadigan spec’lar ketma-ket. */
const CATALOG_SCHEMA_TEST_LOCK = 2_304_004;

/**
 * BE-09 haqiqiy PostgreSQL da, hamma catalog migratsiyasi bilan (global sukut va Elchi tarifi migratsiyadan):
 * hisob (TC1, TC2), narx qarori va holatlar (TC3), NRX-13 (TC4), ko‘rinadigan yetkazish tarifdan oshmaydi (TC5),
 * bozor narxi (TC6), offer maydonlari va yetkazish narxi.
 */
describeWithPostgres('BE-09 narx kalkulyatori (PostgreSQL)', () => {
  let lock: Client | undefined;
  let ds: DataSource;
  let pricing: PricingService;
  let offers: CatalogOfferService;
  let creatives: CreativeService;
  let productId: string;
  const emitted: Array<[string, unknown]> = [];

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
    const emitter = {
      emit: (pattern: string, data: unknown) => {
        emitted.push([pattern, data]);
        return { subscribe: (o: { complete?: () => void }) => o.complete?.() };
      },
    } as never;
    const quiet = {
      emit: () => ({
        subscribe: (o: { complete?: () => void }) => o.complete?.(),
      }),
    } as never;
    pricing = new PricingService(
      ds.getRepository(Product),
      ds.getRepository(PricePolicy),
      ds.getRepository(ElchiTariffEntity),
      ds.getRepository(PriceDecision),
      emitter,
    );
    offers = new CatalogOfferService(
      ds.getRepository(Product),
      pricing,
      ds.getRepository(ProductVariant),
      { send: () => of({}) } as never, // qoldiq — BE-16 testida
      (creatives = new CreativeService(
        ds.getRepository(Creative),
        ds.getRepository(Product),
      )),
    );
    const wholesalers = new WholesalerService(ds.getRepository(Shop));
    const products = new ProductService(
      ds.getRepository(Product),
      ds.getRepository(Shop),
      ds.getRepository(Category),
      ds.getRepository(ProductVariant),
      quiet,
      quiet,
    );
    const w = await wholesalers.create({
      name: 'Gadget Trade MChJ',
      legalType: 'LEGAL_ENTITY' as never,
      tin: '305123456',
      bankName: 'Kapitalbank',
      bankAccount: '20208000900123456001',
      bankMfo: '01158',
      contractNumber: 'K-2026/014',
      contractDate: '2026-11-20',
    });
    const p = await products.adminCreate(w.id, {
      wholesalerId: w.id,
      name: 'Simsiz quloqchin',
      imageUrl: 'https://cdn.example.com/q.jpg',
      basePrice: 140_000,
      affiliateFee: 65_000,
      weightGrams: 450,
      lengthMm: 200,
      widthMm: 120,
      heightMm: 80,
    });
    productId = String(p.id);
    await products.adminApprove(productId);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DROP SCHEMA IF EXISTS catalog CASCADE');
      await ds.destroy();
    }
    await lock?.end();
  });

  it('TC1/TC2: global sukut (qisman) — tavsiya 262 000 (251 000 + 11 000), zararsizlik 240 561, chegara 225 206; yetkazish 30 000, Elchi 40 000', async () => {
    const view = await pricing.calculate(productId);
    expect(view.calculation).toMatchObject({
      recommendedBase: 251_000,
      recommended: 262_000,
      breakevenBase: 240_561,
      hardFloorBase: 225_206,
      delivery: { tariffCenter: 40_000, visibleCenter: 30_000, hidden: 10_000 },
    });
    expect(view.evaluation.status).toBe(PriceStatus.GREEN);
    // narx tasdiqlanmaguncha offer sotuvchiga ochilmaydi
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: null,
      centerDeliveryFee: 30_000,
      addressDeliveryFee: 50_000,
    });
  });

  it('TC3: 230 000 — qizil, saqlanmaydi; 245 000 — sababsiz saqlanmaydi, sabab bilan saqlanadi va superadminga xabar', async () => {
    await expect(
      pricing.decide(productId, '7', { price: 230_000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pricing.decide(productId, '7', { price: 245_000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(pricing.history(productId)).resolves.toEqual([]);

    const orange = await pricing.decide(productId, '7', {
      price: 245_000,
      reason: 'Raqobatchi narxi past',
    });
    expect(orange.decision).toMatchObject({
      status: PriceStatus.ORANGE,
      price: 245_000,
      reason: 'Raqobatchi narxi past',
      decidedBy: '7',
    });
    // TC4 (NRX-13): zararsiz sotuvchi haqi
    expect(orange.evaluation.safeAffiliateFee).toBe(58_936);
    expect(emitted).toEqual([
      [
        'price.decision.orange',
        expect.objectContaining({ productId, price: 245_000 }),
      ],
    ]);
  });

  it('sariq va yashil saqlanadi; offerda tasdiqlangan narx va ustama chegarasi (NRX-4); tarix — kim, qachon, holat', async () => {
    const yellow = await pricing.decide(productId, '8', { price: 255_000 });
    expect(yellow.decision.status).toBe(PriceStatus.YELLOW);
    const green = await pricing.decide(productId, '8', { price: 262_000 });
    expect(green.decision.status).toBe(PriceStatus.GREEN);
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: 262_000,
      maxSalePrice: 287_000,
      cpaAvailable: true,
    });
    const history = await pricing.history(productId);
    expect(history.map((d) => [d.status, d.price, d.decidedBy])).toEqual([
      [PriceStatus.GREEN, 262_000, '8'],
      [PriceStatus.YELLOW, 255_000, '8'],
      [PriceStatus.ORANGE, 245_000, '7'],
    ]);
  });

  it('TC6 (NRX-5): bozor narxi — «mos»/«qimmat», eng yuqori bazaviy narx; summa saqlanadi va ustamani cheklaydi', async () => {
    // «Narx» varag‘i C62/C63 (docs/dizayn/manbalar/p-a1.md 2.2): 285 000 → qimmat, eng yuqori B 134 369
    const dear = await pricing.marketCheck(productId, 285_000);
    expect(dear).toEqual({
      ourTotal: 292_000,
      competitorTotal: 285_000,
      verdict: 'QIMMAT',
      maxBasePrice: 134_369,
    });
    const ok = await pricing.marketCheck(productId, 300_000);
    expect(ok.verdict).toBe('MOS');
    // ustama: jami 300 000 dan oshmaydi → 300 000 − 30 000 = 270 000
    await expect(offers.get(productId)).resolves.toMatchObject({
      maxSalePrice: 270_000,
    });
  });

  it('TC5: ko‘rinadigan yetkazishni 45 000 (tarif 40 000) qilish → rad; 35 000 — saqlanadi va offerga ta’sir qiladi', async () => {
    await expect(
      pricing.setPolicy(
        PricePolicyScope.PRODUCT,
        productId,
        { visibleCenter: 45_000 },
        '1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const set = await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { visibleCenter: 35_000 },
      '1',
    );
    expect(set.after).toMatchObject({ visibleCenter: 35_000, kSale70: null });
    await expect(offers.get(productId)).resolves.toMatchObject({
      centerDeliveryFee: 35_000,
    });
    // global darajada bo‘sh qiymat yo‘q
    await expect(
      pricing.setPolicy(PricePolicyScope.GLOBAL, null, { kSale70: null }, '1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('yetkazish narxi (FE-09): 1 dona — ko‘rinadigan; og‘irlik 3 kg dan oshsa tarif farqi qo‘shiladi; eshikkacha', async () => {
    await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { visibleCenter: null },
      '1',
    );
    await expect(pricing.quote(productId, 1, 'CENTER')).resolves.toEqual({
      deliveryFee: 30_000,
      elchiTariff: 40_000,
    });
    // 450 g × 8 = 3 600 g → +1 kg → tarif 44 000; ko‘rinadigan 30 000 + 4 000
    await expect(pricing.quote(productId, 8, 'CENTER')).resolves.toEqual({
      deliveryFee: 34_000,
      elchiTariff: 44_000,
    });
    await expect(pricing.quote(productId, 1, 'ADDRESS')).resolves.toEqual({
      deliveryFee: 50_000,
      elchiTariff: 60_000,
    });
  });

  it('BE-18: buyurtma narx nusxasi — tasdiqlangan narxdagi taqsimot, variant, optovik; TC5: 4,2 kg → Elchi 48 000', async () => {
    const snapshot = await offers.orderSnapshot(productId, 1, 'CENTER');
    expect(snapshot).toMatchObject({
      productId,
      productName: 'Simsiz quloqchin',
      variantId: expect.any(String),
      wholesalerId: expect.any(String),
      weightGrams: 450,
      cpaAvailable: true,
      withdrawn: false,
      basePrice: 140_000,
      approvedPrice: 262_000,
      affiliateFee: 65_000,
      hiddenDelivery: 11_000,
      delivery: { mode: 'PARTIAL', shown: 30_000, elchiTariff: 40_000 },
    });
    // to‘rt qator + yashirilgan yetkazish = tasdiqlangan narx (TZ 2.2; platforma xizmati — qoldiq)
    const s = snapshot!;
    expect(
      s.basePrice +
        s.affiliateFee +
        s.callCenterFee +
        s.hiddenDelivery +
        s.platformService,
    ).toBe(262_000);

    await ds
      .getRepository(Product)
      .update({ id: productId }, { weightGrams: 4_200 });
    try {
      await expect(
        offers.orderSnapshot(productId, 1, 'CENTER'),
      ).resolves.toMatchObject({
        weightGrams: 4_200,
        delivery: { elchiTariff: 48_000 },
      });
    } finally {
      await ds
        .getRepository(Product)
        .update({ id: productId }, { weightGrams: 450 });
    }
    await expect(offers.orderSnapshot('999999', 1, 'CENTER')).resolves.toBe(
      null,
    );
  });

  it('BE-34: ko‘p tovarli posilka — har tovar nusxasi, yetkazish jami og‘irlik bo‘yicha (bitta tovar qoidasi bilan bir xil)', async () => {
    // bitta qator — orderSnapshot bilan bir xil
    const one = await offers.orderSnapshotMany(
      [{ productId, quantity: 1 }],
      'CENTER',
    );
    expect(one.delivery).toEqual({
      mode: 'PARTIAL',
      shown: 30_000,
      elchiTariff: 40_000,
    });
    expect(one.items[0]).toMatchObject({ productId, approvedPrice: 262_000 });
    // 450 g × (1 + 7) = 3 600 g → +1 kg → tarif 44 000; ko‘rinadigan 30 000 + 4 000 (quote(8) bilan bir xil)
    const two = await offers.orderSnapshotMany(
      [
        { productId, quantity: 1 },
        { productId, quantity: 7 },
      ],
      'CENTER',
    );
    expect(two.delivery).toEqual({
      mode: 'PARTIAL',
      shown: 34_000,
      elchiTariff: 44_000,
    });
    expect(two.items).toHaveLength(2);
    // topilmagan mahsulot — null, posilka yetkazishi hisoblanmaydi
    await expect(
      offers.orderSnapshotMany(
        [
          { productId, quantity: 1 },
          { productId: '999999', quantity: 1 },
        ],
        'CENTER',
      ),
    ).resolves.toMatchObject({
      items: [expect.any(Object), null],
      delivery: null,
    });
  });

  it('yashil → sariq (M oshdi, hech kim zarar ko‘rmaydi) — tasdiq saqlanadi; soliq + to‘lov ≥ 50% — 400', async () => {
    await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { deliveryMode: null },
      '1',
    );
    await pricing.setPolicy(
      PricePolicyScope.GLOBAL,
      null,
      { targetMargin: 10_000 },
      '1',
    );
    await expect(pricing.calculate(productId)).resolves.toMatchObject({
      approvalCurrent: true,
      evaluation: { status: PriceStatus.YELLOW },
    });
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: 262_000,
    });
    await pricing.setPolicy(
      PricePolicyScope.GLOBAL,
      null,
      { targetMargin: 9_000 },
      '1',
    );
    await expect(
      pricing.setPolicy(
        PricePolicyScope.GLOBAL,
        null,
        { taxRate: 0.4, paymentRate: 0.2 },
        '1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asosi o‘zgargan tasdiq: rejim bepulga o‘tsa (262 000 qizil) yoki B oshsa — offer narxi bo‘sh, yangi qaror kerak; qaytsa — tiklanadi', async () => {
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: 262_000,
    });
    await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { deliveryMode: 'FREE' as never },
      '1',
    );
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: null,
      maxSalePrice: null,
    });
    await expect(pricing.calculate(productId)).resolves.toMatchObject({
      approvedPrice: 262_000,
      approvalCurrent: false,
    });
    await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { deliveryMode: null },
      '1',
    );
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: 262_000,
    });
    await ds.query(
      `UPDATE catalog.product SET base_price = 200000 WHERE id = $1`,
      [productId],
    );
    await expect(offers.get(productId)).resolves.toMatchObject({
      approvedPrice: null,
    });
    await ds.query(
      `UPDATE catalog.product SET base_price = 140000 WHERE id = $1`,
      [productId],
    );
  });

  it('eshikkacha summa: markazgacha + eshik qo‘shimchasidan farqli — 400', async () => {
    await expect(
      pricing.setPolicy(
        PricePolicyScope.PRODUCT,
        productId,
        { visibleCenter: 35_000, visibleAddress: 50_000 },
        '1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { visibleCenter: 35_000, visibleAddress: 55_000 },
      '1',
    );
    await expect(offers.get(productId)).resolves.toMatchObject({
      centerDeliveryFee: 35_000,
      addressDeliveryFee: 55_000,
    });
    await pricing.setPolicy(
      PricePolicyScope.PRODUCT,
      productId,
      { visibleCenter: null, visibleAddress: null },
      '1',
    );
  });

  it('NRX-7: yangi Elchi tarifi kuchga kirgach hisob o‘zgaradi, kelajakdagisi — hali yo‘q', async () => {
    await pricing.addTariff(
      {
        centerBase: 45_000,
        baseWeightGrams: 3_000,
        perExtraKg: 4_000,
        addressExtra: 20_000,
        effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
      },
      '1',
    );
    await expect(pricing.quote(productId, 1, 'CENTER')).resolves.toMatchObject({
      elchiTariff: 40_000,
    });
    await pricing.addTariff(
      {
        centerBase: 45_000,
        baseWeightGrams: 3_000,
        perExtraKg: 4_000,
        addressExtra: 20_000,
      },
      '1',
    );
    await expect(pricing.quote(productId, 1, 'CENTER')).resolves.toMatchObject({
      elchiTariff: 45_000,
    });
    expect((await pricing.listTariffs()).length).toBe(3);
  });

  it('BE-08: kreativlar — mahsulotga bog‘lanadi, offer ularni tartib bilan beradi; o‘chirilgani chiqadi; chegara 20', async () => {
    const file = (n: number, type: CreativeType) => ({
      objectKey: `creatives/${productId}/0000000${n}-1111-4222-8333-944455556666.${type === CreativeType.VIDEO ? 'mp4' : 'png'}`,
      url: `https://api.elchi.test/media/m/creatives/${productId}/${n}`,
      type,
      mimeType: type === CreativeType.VIDEO ? 'video/mp4' : 'image/png',
      size: type === CreativeType.VIDEO ? 80 * 1024 * 1024 : 2048,
    });
    const video = await creatives.create({
      productId,
      file: file(1, CreativeType.VIDEO),
      actorId: '7',
    });
    const image = await creatives.create({
      productId,
      file: file(2, CreativeType.IMAGE),
      actorId: '7',
    });
    expect(video).toMatchObject({
      type: 'VIDEO',
      size: 80 * 1024 * 1024,
      position: 0,
    });
    expect(image.position).toBe(1);
    // takroriy tasdiq — o‘sha kreativ
    await expect(
      creatives.create({
        productId,
        file: file(1, CreativeType.VIDEO),
        actorId: '7',
      }),
    ).resolves.toMatchObject({ id: video.id });
    // boshqa mahsulot kaliti — rad
    await expect(
      creatives.create({
        productId,
        file: {
          ...file(3, CreativeType.IMAGE),
          objectKey: 'creatives/999/x.png',
        },
        actorId: '7',
      }),
    ).rejects.toThrow('noto‘g‘ri');

    await expect(offers.get(productId)).resolves.toMatchObject({
      creatives: [
        {
          id: video.id,
          type: 'VIDEO',
          url: video.url,
          createdAt: expect.any(String),
        },
        {
          id: image.id,
          type: 'IMAGE',
          url: image.url,
          createdAt: expect.any(String),
        },
      ],
    });
    await expect(creatives.list(productId)).resolves.toHaveLength(2);
    // gateway tasdiqdan oldin so‘raydi: bor — o‘sha kreativ, yo‘q — null
    await expect(
      creatives.find({
        productId,
        objectKey: file(1, CreativeType.VIDEO).objectKey,
      }),
    ).resolves.toMatchObject({ creative: { id: video.id } });
    await expect(
      creatives.find({
        productId,
        objectKey: file(7, CreativeType.VIDEO).objectKey,
      }),
    ).resolves.toEqual({ creative: null });

    await expect(
      creatives.delete({ productId, creativeId: image.id }),
    ).resolves.toEqual({
      id: image.id,
      objectKey: file(2, CreativeType.IMAGE).objectKey,
    });
    // o‘chirilgan kreativ fayli qayta tasdiqlanmaydi
    await expect(
      creatives.find({
        productId,
        objectKey: file(2, CreativeType.IMAGE).objectKey,
      }),
    ).rejects.toThrow('o‘chirilgan');
    const after = await offers.list({ productIds: [productId] } as never);
    expect(after.find((o) => o.productId === productId)?.creatives).toEqual([
      {
        id: video.id,
        type: 'VIDEO',
        url: video.url,
        createdAt: expect.any(String),
      },
    ]);

    for (let n = 10; n < 29; n++)
      await creatives.create({
        productId,
        file: file(n, CreativeType.IMAGE),
        actorId: null,
      });
    await expect(
      creatives.create({
        productId,
        file: file(29, CreativeType.IMAGE),
        actorId: null,
      }),
    ).rejects.toThrow('20');
  });
});
