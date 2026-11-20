import {
  calculatePrice,
  DeliveryDisplayMode,
  DeliveryKind,
  elchiTariffFor,
  evaluatePrice,
  marketCheck,
  maxSalePriceFor,
  PriceStatus,
  recommendedAffiliateFee,
  TZ_DEFAULT_ELCHI_TARIFF as TARIFF,
  TZ_DEFAULT_PRICING,
} from './price-calculator';

const A = 65_000; // TZ 2.1
const WEIGHT = 1_000; // 3 kg gacha (TZ 2.3: «yetkazish markazgacha, 3 kg gacha»)
const separate = {
  ...TZ_DEFAULT_PRICING,
  deliveryMode: DeliveryDisplayMode.SEPARATE,
};
const partial = TZ_DEFAULT_PRICING; // sukut — qisman
const free = { ...TZ_DEFAULT_PRICING, deliveryMode: DeliveryDisplayMode.FREE };
const calc = (params = separate, basePrice = 140_000, affiliateFee = A) =>
  calculatePrice(params, TARIFF, {
    basePrice,
    affiliateFee,
    weightGrams: WEIGHT,
  });

describe('BE-09 narx kalkulyatori (TZ 2-bo‘lim)', () => {
  it.each([
    // [B, qat’iy pastki chegara, zararsizlik, tavsiya, platforma ulushi %] — TZ 2.3 nazorat jadvali
    [60_000, 143_634, 158_989, 169_000, 26.0],
    [100_000, 184_420, 199_775, 210_000, 21.4],
    [140_000, 225_206, 240_561, 251_000, 18.3],
    [200_000, 286_385, 301_740, 312_000, 15.1],
    [300_000, 388_350, 403_705, 414_000, 11.8],
  ])(
    'NRX-1: 2.3 jadvali — B = %d → chegara %d, zararsizlik %d, tavsiya %d, ulush %d%%',
    (b, hardFloor, breakeven, recommended, share) => {
      const result = calc(separate, b);
      expect(result.hardFloorBase).toBe(hardFloor);
      expect(result.breakevenBase).toBe(breakeven);
      expect(result.recommendedBase).toBe(recommended);
      expect(result.recommended).toBe(recommended); // alohida rejimda yashirilgan qism yo‘q
      expect(result.platformSharePercent).toBe(share);
    },
  );

  it('TC1: B = 140 000, haq 65 000 → tavsiya 251 000, zararsizlik 240 561, qat’iy chegara 225 206', () => {
    expect(calc()).toMatchObject({
      recommendedBase: 251_000,
      breakevenBase: 240_561,
      hardFloorBase: 225_206,
    });
  });

  it('2.2 taqsimot: optovik 140 000, sotuvchi 65 000, qo‘ng‘iroq markazi 12 000, platforma xizmati 34 000; platforma natijasi 9 828', () => {
    const c = calc();
    const e = evaluatePrice(separate, c, c.recommended);
    expect(e.split).toEqual({
      wholesaler: 140_000,
      affiliate: 65_000,
      callCenter: 12_000,
      platformService: 34_000,
    });
    expect(e.platformResult70).toBe(9_828);
    expect(e.status).toBe(PriceStatus.GREEN);
  });

  it('TC2 va 2.4: qisman — tovar 262 000 + yetkazish 30 000, Elchi 40 000 oladi; bepul — 294 000; platforma natijasi 10 185 / 10 313', () => {
    const p = calc(partial);
    expect(p.recommended).toBe(262_000);
    expect(p.delivery).toMatchObject({
      tariffCenter: 40_000,
      visibleCenter: 30_000,
      visibleAddress: 50_000,
      hidden: 10_000,
    });
    expect(evaluatePrice(partial, p, p.recommended).platformResult70).toBe(
      10_185,
    );
    const f = calc(free);
    expect(f.recommended).toBe(294_000);
    expect(f.delivery.visibleCenter).toBe(0);
    expect(evaluatePrice(free, f, f.recommended).platformResult70).toBe(10_313);
    // NRX-9: uch rejimda platforma natijasi alohidadagidan kam emas
    const s = calc(separate);
    expect(
      evaluatePrice(separate, s, s.recommended).platformResult70,
    ).toBeLessThanOrEqual(10_185);
  });

  it('2.6 holat chegaralari (qisman, 140 000): sariq 251 183 dan, to‘q sariq 235 828 dan, yashil 262 000 dan', () => {
    const p = calc(partial);
    expect(p.yellowFrom).toBe(251_183);
    expect(p.orangeFrom).toBe(235_828);
    const status = (price: number) => evaluatePrice(partial, p, price).status;
    expect(status(262_000)).toBe(PriceStatus.GREEN);
    expect(status(261_999)).toBe(PriceStatus.YELLOW);
    expect(status(251_183)).toBe(PriceStatus.YELLOW);
    expect(status(251_182)).toBe(PriceStatus.ORANGE);
    expect(status(235_828)).toBe(PriceStatus.ORANGE);
    expect(status(235_827)).toBe(PriceStatus.RED);
  });

  it('TC3: 255 000 → sariq; 245 000 → to‘q sariq; 230 000 → qizil', () => {
    const p = calc(partial);
    expect(evaluatePrice(partial, p, 255_000).status).toBe(PriceStatus.YELLOW);
    expect(evaluatePrice(partial, p, 245_000).status).toBe(PriceStatus.ORANGE);
    expect(evaluatePrice(partial, p, 230_000).status).toBe(PriceStatus.RED);
  });

  it('TC4 (NRX-13): 245 000 da zararsiz sotuvchi haqi 58 936; bunday haq bo‘lmasa — yo‘q', () => {
    const p = calc(partial);
    expect(evaluatePrice(partial, p, 245_000).safeAffiliateFee).toBe(58_936);
    // 230 000 da platforma zararsiz bo‘ladigan haq reklama xarajatidan (50 420) kam — taklif yo‘q
    expect(evaluatePrice(partial, p, 230_000).safeAffiliateFee).toBeNull();
  });

  it('sotuvchi haqi reklama xarajatidan kam bo‘lsa (sotuvchi zarari) — tavsiyadan past narx to‘q sariq', () => {
    const p = calc(partial, 140_000, 50_000);
    const price = p.recommended - 1_000;
    expect(evaluatePrice(partial, p, price).status).toBe(PriceStatus.ORANGE);
  });

  it('2.5-1 va NRX-4: ustama +10% faqat tovar qismiga, 1 000 ga pastga: 251 000 → 276 000; bozor narxidan oshmaydi', () => {
    const s = calc(separate);
    expect(maxSalePriceFor(separate, 251_000, s.delivery)).toBe(276_000);
    const p = calc(partial);
    // qisman: tovar qismi 251 000 (yashirilgan 11 000 siz) → 262 000 + 25 100 → 287 000
    expect(maxSalePriceFor(partial, 262_000, p.delivery)).toBe(287_000);
    expect(maxSalePriceFor(partial, 262_000, p.delivery, 300_000)).toBe(
      270_000,
    );
    expect(maxSalePriceFor(partial, 262_000, p.delivery, 280_000)).toBe(
      262_000,
    );
  });

  it('NRX-7: Elchi tarifi — 3 kg gacha 40 000, har ortiqcha kg +4 000, eshikkacha +20 000', () => {
    expect(elchiTariffFor(TARIFF, 3_000, DeliveryKind.CENTER)).toBe(40_000);
    expect(elchiTariffFor(TARIFF, 3_001, DeliveryKind.CENTER)).toBe(44_000);
    expect(elchiTariffFor(TARIFF, 5_000, DeliveryKind.ADDRESS)).toBe(68_000);
  });

  it('ko‘rinadigan yetkazish tarifdan oshmaydi (og‘ir tovarda ham); bepul rejimda doim 0', () => {
    const heavy = calculatePrice(partial, TARIFF, {
      basePrice: 140_000,
      affiliateFee: A,
      weightGrams: 6_000,
    });
    expect(heavy.delivery.tariffCenter).toBe(52_000);
    expect(heavy.delivery.visibleCenter).toBe(30_000);
    expect(heavy.delivery.hidden).toBe(22_000);
  });

  it('TC6 (NRX-5): raqobatchi summasi bilan «mos»/«qimmat» va eng yuqori bazaviy narx (u bilan jami raqobatchidan oshmaydi)', () => {
    const p = calc(partial);
    const ok = marketCheck(partial, p, 300_000);
    expect(ok).toMatchObject({ ourTotal: 292_000, verdict: 'MOS' });
    const dear = marketCheck(partial, p, 280_000);
    expect(dear.verdict).toBe('QIMMAT');
    // eng yuqori bazaviy narx bilan hisoblangan jami raqobatchidan oshmaydi, 1 so‘m ortig‘i bilan — oshadi
    const total = (b: number) => {
      const c = calc(partial, b);
      return c.recommended + c.delivery.visibleCenter;
    };
    expect(total(dear.maxBasePrice!)).toBeLessThanOrEqual(280_000);
    expect(total(dear.maxBasePrice! + 1)).toBeGreaterThan(280_000);
  });

  it('NRX-3: sotuvchi haqi tavsiyasi = 50 420 × 1.29 → 65 000', () => {
    expect(recommendedAffiliateFee(TZ_DEFAULT_PRICING)).toBe(65_000);
  });
});
