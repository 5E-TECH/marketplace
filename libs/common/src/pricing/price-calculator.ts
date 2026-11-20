/**
 * BE-09: narx kalkulyatori (TZ 2-bo‘lim, 6.13 NRX-1…NRX-13). Sof funksiyalar — catalog va keyingi kartalar
 * (BE-18 buyurtma nusxasi) bir xil hisobni ishlatadi.
 *
 * Hisob aniq butun arifmetikada (BigInt): pul — tiyin (×100, K kasrli bo‘lishi mumkin), foizlar — bazis punkt
 * (×10 000). Holat aniq qiymat bilan aniqlanadi (chegarada suzuvchi nuqta xatosi yo‘q); ko‘rsatish uchun yaxlitlanadi.
 */

/** Yetkazishni ko‘rsatish rejimi (TZ 2.4). */
export enum DeliveryDisplayMode {
  /** Alohida: mijoz tovar + to‘liq Elchi tarifini ko‘radi. */
  SEPARATE = 'SEPARATE',
  /** Qisman (sukut): yetkazish ko‘rinadigan summa (30 000), qolgani tovar narxida. */
  PARTIAL = 'PARTIAL',
  /** Bepul: butun tarif tovar narxida. */
  FREE = 'FREE',
}

/** Narx holati (TZ 2.6). */
export enum PriceStatus {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  ORANGE = 'ORANGE',
  RED = 'RED',
}

/** Holatning og‘irligi: yashil < sariq < to‘q sariq < qizil. */
export const PRICE_STATUS_SEVERITY: Record<PriceStatus, number> = {
  [PriceStatus.GREEN]: 0,
  [PriceStatus.YELLOW]: 1,
  [PriceStatus.ORANGE]: 2,
  [PriceStatus.RED]: 3,
};

export enum DeliveryKind {
  CENTER = 'CENTER',
  ADDRESS = 'ADDRESS',
}

/** Narx parametrlari (ADM-2; global → kategoriya → mahsulot). Qiymatlar manbasi — TZ 2.1, 2.2, 2.4, 2.5. */
export interface PricingParams {
  /** K — har sotuvdagi qat’iy xarajatlar, sotilish 70% da (TZ 2.1: 29 688). 2 xonagacha kasr. */
  kSale70: number;
  /** K — har bir tasdiqlangan buyurtma sotilganda (TZ 2.1: 15 232) — qat’iy pastki chegara. 2 xonagacha kasr. */
  kSale100: number;
  /** M — tavsiya narxdagi platformaning maqsadli minimal natijasi (TZ 2.1: 9 000). */
  targetMargin: number;
  /** Tushum solig‘i (TZ 2.1: 4%). */
  taxRate: number;
  /** To‘lov va firibgarlik xarajati (TZ 2.1: 1.85%). */
  paymentRate: number;
  /** Qo‘ng‘iroq markazi qatori, qat’iy (TZ 2.2: 12 000). */
  callCenterFee: number;
  /** Sotuvchi haqi koeffitsienti: reklama xarajati × 1.29 (TZ 2.1, NRX-3). */
  affiliateCoef: number;
  /** Sotuvchining reklama xarajati — undan kam haq sotuvchi zarari (TZ 2.6: 50 420). */
  adCost: number;
  /** Ustama chegarasi, % (TZ 2.5-1, NRX-4: 10). */
  markupCapPercent: number;
  /** Yetkazishni ko‘rsatish rejimi (TZ 2.4: sukut — qisman). */
  deliveryMode: DeliveryDisplayMode;
  /** Ko‘rinadigan yetkazish markazgacha (sukut 30 000) (TZ 2.4, NRX-8). */
  visibleCenter: number;
  /**
   * Ko‘rinadigan yetkazish eshikkacha (sukut 50 000 = 30 000 + eshik qo‘shimchasi 20 000). Qisman rejimda hisob uni
   * eshik tarifi minus tovar narxidagi yashirilgan qism sifatida chiqaradi — sozlama shunga teng bo‘lishi kerak.
   */
  visibleAddress: number;
}

/** Elchi tarifi (TZ 2.4, NRX-7; Elchi tariflari 14.08.2026). */
export interface ElchiTariff {
  /** Markazgacha, `baseWeightGrams` gacha: 40 000. */
  centerBase: number;
  /** Bazaviy og‘irlik: 3 kg. */
  baseWeightGrams: number;
  /** Har ortiqcha kg: +4 000. */
  perExtraKg: number;
  /** Eshikkacha qo‘shimcha: +20 000. */
  addressExtra: number;
}

// ---- aniq butun arifmetika ----
const BP = 10_000n; // foiz shkalasi
const T = 100n; // tiyin
const bp = (rate: number) => BigInt(Math.round(rate * 10_000));
const tiyin = (value: number) => BigInt(Math.round(value * 100));
const big = (value: number) => BigInt(Math.round(value));
const ceilDiv = (a: bigint, b: bigint) =>
  a >= 0n ? (a + b - 1n) / b : -(-a / b);
const floorDiv = (a: bigint, b: bigint) =>
  a >= 0n ? a / b : -((-a + b - 1n) / b);
const num = (value: bigint) => Number(value);

interface Exact {
  net: bigint; // 1 − soliq − to‘lov, bp (9 415)
  at: bigint; // 1 − soliq, bp (9 600)
  pay: bigint; // to‘lov, bp (185)
  k70: bigint; // tiyin
  k100: bigint;
  m: bigint;
}
const exact = (p: PricingParams): Exact => ({
  net: BP - bp(p.taxRate) - bp(p.paymentRate),
  at: BP - bp(p.taxRate),
  pay: bp(p.paymentRate),
  k70: tiyin(p.kSale70),
  k100: tiyin(p.kSale100),
  m: tiyin(p.targetMargin),
});

export const ceilTo = (value: number, step: number) =>
  Math.ceil(value / step) * step;
export const floorTo = (value: number, step: number) =>
  Math.floor(value / step) * step;

/** Elchi tarifi: og‘irlik va yetkazish turi bo‘yicha (NRX-7). Ortiqcha og‘irlik har boshlangan kg uchun. */
export function elchiTariffFor(
  tariff: ElchiTariff,
  weightGrams: number,
  kind: DeliveryKind,
): number {
  const extraKg = Math.max(
    0,
    Math.ceil((weightGrams - tariff.baseWeightGrams) / 1000),
  );
  return (
    tariff.centerBase +
    extraKg * tariff.perExtraKg +
    (kind === DeliveryKind.ADDRESS ? tariff.addressExtra : 0)
  );
}

/** Mijozga ko‘rinadigan yetkazish summasi va yashirilgan qism (TZ 2.4). */
export interface DeliveryView {
  tariffCenter: number;
  tariffAddress: number;
  visibleCenter: number;
  visibleAddress: number;
  /** Tovar narxiga qo‘shiladigan yashirilgan qism (markazgacha tarif minus ko‘rinadigan). */
  hidden: number;
  /** Yashirilgan qism ÷ 0.9415, 1 000 ga yuqoriga (TZ 2.4, NRX-9). */
  hiddenPriceAdd: number;
}

/**
 * Yetkazish ko‘rinishi bir dona uchun. Yashirilgan qism markazgacha tarif bo‘yicha; qisman rejimda eshikkacha
 * ko‘rinadigan = eshik tarifi − shu yashirilgan qism (sukutda 60 000 − 10 000 = 50 000): Elchi har ikki turda to‘liq
 * tarif oladi, mijoz ortiqcha to‘lamaydi. Bepul rejimda ikkalasi 0 (TZ 2.4: «yetkazish bepul»).
 */
export function deliveryView(
  p: PricingParams,
  tariff: ElchiTariff,
  weightGrams: number,
): DeliveryView {
  const tariffCenter = elchiTariffFor(tariff, weightGrams, DeliveryKind.CENTER);
  const tariffAddress = elchiTariffFor(
    tariff,
    weightGrams,
    DeliveryKind.ADDRESS,
  );
  let visibleCenter: number;
  let visibleAddress: number;
  if (p.deliveryMode === DeliveryDisplayMode.SEPARATE) {
    visibleCenter = tariffCenter;
    visibleAddress = tariffAddress;
  } else if (p.deliveryMode === DeliveryDisplayMode.FREE) {
    visibleCenter = 0;
    visibleAddress = 0;
  } else {
    visibleCenter = Math.min(p.visibleCenter, tariffCenter);
    visibleAddress = tariffAddress - (tariffCenter - visibleCenter);
  }
  const hidden = tariffCenter - visibleCenter;
  const e = exact(p);
  return {
    tariffCenter,
    tariffAddress,
    visibleCenter,
    visibleAddress,
    hidden,
    hiddenPriceAdd:
      hidden > 0 ? num(ceilDiv(big(hidden) * BP, e.net * 1000n)) * 1000 : 0,
  };
}

/** Platforma natijasining aniq surati (tiyin × bp): 0.96(narx − B − A) − 0.0185·narx − K − yashirilgan (TZ 2.6). */
function resultNumerator(
  e: Exact,
  price: number,
  basePrice: number,
  affiliateFee: number,
  hidden: number,
  k: bigint,
): bigint {
  return (
    e.at * (big(price) - big(basePrice) - big(affiliateFee)) * T -
    e.pay * big(price) * T -
    BP * (k + big(hidden) * T)
  );
}

/** Natija nol bo‘ladigan narx: surat / maxraj (aniq). */
function thresholdFraction(
  e: Exact,
  basePrice: number,
  affiliateFee: number,
  k: bigint,
  hidden: number,
  margin = 0n,
): [bigint, bigint] {
  return [
    e.at * (big(basePrice) + big(affiliateFee)) * T +
      BP * (k + margin + big(hidden) * T),
    e.net * T,
  ];
}

export interface PriceCalculation {
  basePrice: number;
  affiliateFee: number;
  /** Tavsiya narx alohida rejimda, 1 000 ga yuqoriga (TZ 2.1; 2.3 jadvali). */
  recommendedBase: number;
  /** Zararsizlik narxi alohida rejimda (M = 0), butun so‘mga yuqoriga (TZ 2.3). */
  breakevenBase: number;
  /**
   * Qat’iy pastki chegara alohida rejimda (K₁₀₀) — TZ 2.3 jadvalidagi kabi butun so‘mga pastga (225 206,59 → 225 206).
   * Saqlab bo‘ladigan eng kichik narx — `orangeFrom`.
   */
  hardFloorBase: number;
  delivery: DeliveryView;
  /** Mijoz ko‘radigan tavsiya tovar narxi: tavsiya + yashirilgan qism (TZ 2.4: qisman 262 000). */
  recommended: number;
  /** Rejimdagi holat chegaralari (TZ 2.6): sariq va to‘q sariqning eng kichik narxi. */
  yellowFrom: number;
  orangeFrom: number;
  /** Platforma ulushi tavsiya narxda, % (TZ 2.3 oxirgi ustun). */
  platformSharePercent: number;
}

/** Tavsiya, zararsizlik va qat’iy chegara (NRX-1, NRX-2). */
export function calculatePrice(
  p: PricingParams,
  tariff: ElchiTariff,
  input: { basePrice: number; affiliateFee: number; weightGrams: number },
): PriceCalculation {
  const { basePrice, affiliateFee } = input;
  const e = exact(p);
  const delivery = deliveryView(p, tariff, input.weightGrams);
  const [rn, rd] = thresholdFraction(e, basePrice, affiliateFee, e.k70, 0, e.m);
  const recommendedBase = num(ceilDiv(rn, rd * 1000n)) * 1000;
  const [bn, bd] = thresholdFraction(e, basePrice, affiliateFee, e.k70, 0);
  const [fn, fd] = thresholdFraction(e, basePrice, affiliateFee, e.k100, 0);
  const [yn, yd] = thresholdFraction(
    e,
    basePrice,
    affiliateFee,
    e.k70,
    delivery.hidden,
  );
  const [on, od] = thresholdFraction(
    e,
    basePrice,
    affiliateFee,
    e.k100,
    delivery.hidden,
  );
  return {
    basePrice,
    affiliateFee,
    recommendedBase,
    breakevenBase: num(ceilDiv(bn, bd)),
    hardFloorBase: num(floorDiv(fn, fd)),
    delivery,
    recommended: recommendedBase + delivery.hiddenPriceAdd,
    yellowFrom: num(ceilDiv(yn, yd)),
    orangeFrom: num(ceilDiv(on, od)),
    platformSharePercent:
      Math.round(
        ((recommendedBase - basePrice - affiliateFee) / recommendedBase) * 1000,
      ) / 10,
  };
}

export interface PriceEvaluation {
  status: PriceStatus;
  price: number;
  /**
   * To‘rt qator taqsimoti (TZ 2.2) va yashirilgan yetkazish (TZ 2.4: alohida hisobda, Elchi’ga o‘tadi):
   * platforma xizmati — qoldiq.
   */
  split: {
    wholesaler: number;
    affiliate: number;
    callCenter: number;
    platformService: number;
    hiddenDelivery: number;
  };
  /** Platforma natijasi sotilish 70% va 100% da, butun so‘mga pastga (TZ 2.2: 9 828). */
  platformResult70: number;
  platformResult100: number;
  /** Sotuvchi natijasi: haq − reklama xarajati. */
  affiliateResult: number;
  /** Tavsiyadan qancha kam (sariq holatda kim qancha kam oladi — TZ 2.6). */
  belowRecommended: number;
  /** NRX-13: zarar bo‘lsa hech kim zarar ko‘rmaydigan sotuvchi haqining eng yuqori qiymati; yo‘q bo‘lsa — null. */
  safeAffiliateFee: number | null;
}

/**
 * Admin narxi: holat va har tomonning natijasi (TZ 2.6, NRX-6, NRX-13). Qizil — hamma sotilsa ham platforma zarari;
 * to‘q sariq — sotilish 70% da platforma yoki sotuvchi zarari (sotuvchi zarari tavsiya narxda ham to‘q sariq).
 */
export function evaluatePrice(
  p: PricingParams,
  calc: PriceCalculation,
  price: number,
): PriceEvaluation {
  const e = exact(p);
  const { basePrice, affiliateFee } = calc;
  const hidden = calc.delivery.hidden;
  const r70 = resultNumerator(e, price, basePrice, affiliateFee, hidden, e.k70);
  const r100 = resultNumerator(
    e,
    price,
    basePrice,
    affiliateFee,
    hidden,
    e.k100,
  );
  const affiliateResult = affiliateFee - p.adCost;
  let status: PriceStatus;
  if (r100 < 0n) status = PriceStatus.RED;
  else if (affiliateResult < 0) status = PriceStatus.ORANGE;
  else if (price >= calc.recommended) status = PriceStatus.GREEN;
  else if (r70 >= 0n) status = PriceStatus.YELLOW;
  else status = PriceStatus.ORANGE;

  // NRX-13: platforma natijasi (70%) ≥ 0 bo‘ladigan eng katta sotuvchi haqi; reklama xarajatidan kam bo‘lsa — yo‘q
  let safeAffiliateFee: number | null = null;
  if (status === PriceStatus.ORANGE || status === PriceStatus.RED) {
    const max = num(
      floorDiv(
        e.at * (big(price) - big(basePrice)) * T -
          e.pay * big(price) * T -
          BP * (e.k70 + big(hidden) * T),
        e.at * T,
      ),
    );
    safeAffiliateFee = max >= p.adCost ? max : null;
  }
  const hiddenDelivery = calc.delivery.hiddenPriceAdd;
  return {
    status,
    price,
    split: {
      wholesaler: basePrice,
      affiliate: affiliateFee,
      callCenter: p.callCenterFee,
      platformService:
        price - basePrice - affiliateFee - p.callCenterFee - hiddenDelivery,
      hiddenDelivery,
    },
    platformResult70: num(floorDiv(r70, BP * T)),
    platformResult100: num(floorDiv(r100, BP * T)),
    affiliateResult,
    belowRecommended: Math.max(0, calc.recommended - price),
    safeAffiliateFee,
  };
}

/**
 * Sahifadagi eng katta narx (NRX-4, TZ 2.5-1): ustama faqat tovar qismiga (yashirilgan yetkazishsiz), 1 000 ga
 * pastga; bozor narxi berilsa (raqobatchida mijoz jami) — jami undan oshmaydi. Tasdiqlangan narxdan past emas.
 */
export function maxSalePriceFor(
  p: PricingParams,
  approvedPrice: number,
  delivery: DeliveryView,
  marketTotal?: number | null,
): number {
  const goods = big(approvedPrice - delivery.hiddenPriceAdd);
  const capBp = bp(p.markupCapPercent / 100);
  let max = num(
    floorDiv(big(approvedPrice) * BP + goods * capBp, BP * 1000n) * 1000n,
  );
  if (marketTotal != null)
    max = Math.min(max, marketTotal - delivery.visibleCenter);
  return Math.max(max, approvedPrice);
}

export interface MarketCheck {
  /** Bizda mijoz jami (tavsiya tovar narxi + ko‘rinadigan markazgacha yetkazish). */
  ourTotal: number;
  competitorTotal: number;
  verdict: 'MOS' | 'QIMMAT';
  /** Optovik uchun eng yuqori bazaviy narx («Narx» varag‘i C63); manfiy bo‘lsa — null. */
  maxBasePrice: number | null;
}

/**
 * NRX-5: raqobatchida mijoz jami to‘laydigan summa (T) bilan solishtirish. Eng yuqori bazaviy narx — «Narx» varag‘i
 * C63 formulasi: ⌊(0.9415·(T − ko‘rinadigan yetkazish) − K − M − yashirilgan)/0.96 − A⌋ (299 000 → 148 099,
 * 285 000 → 134 369; manba: docs/dizayn/manbalar/p-a1.md 2.1–2.2 kadrlar).
 */
export function marketCheck(
  p: PricingParams,
  calc: PriceCalculation,
  competitorTotal: number,
): MarketCheck {
  const e = exact(p);
  const ourTotal = calc.recommended + calc.delivery.visibleCenter;
  const maxBase = num(
    floorDiv(
      e.net * big(competitorTotal - calc.delivery.visibleCenter) * T -
        BP * (e.k70 + e.m + big(calc.delivery.hidden) * T) -
        e.at * big(calc.affiliateFee) * T,
      e.at * T,
    ),
  );
  return {
    ourTotal,
    competitorTotal,
    verdict: ourTotal <= competitorTotal ? 'MOS' : 'QIMMAT',
    maxBasePrice: maxBase >= 0 ? maxBase : null,
  };
}

/** Sotuvchi haqi tavsiyasi: reklama xarajati × koeffitsient, 1 000 gacha (TZ 2.1: 50 420 × 1.29 → 65 000). */
export const recommendedAffiliateFee = (p: PricingParams) =>
  Math.round((p.adCost * p.affiliateCoef) / 1000) * 1000;

/**
 * TZ dagi sukut parametrlar (ega 2026-10-23 da tasdiqlagan «Moliyaviy model v1.1», «Narx» varag‘i; TZ 2.1–2.5).
 * Bazaga migratsiya bilan global sozlama sifatida yoziladi; keyin admin (ADM-2) o‘zgartiradi.
 */
export const TZ_DEFAULT_PRICING: PricingParams = {
  kSale70: 29_688, // TZ 2.1
  kSale100: 15_232, // TZ 2.1 «qat’iy pastki chegara … K = 15 232»
  targetMargin: 9_000, // TZ 2.1
  taxRate: 0.04, // TZ 2.1
  paymentRate: 0.0185, // TZ 2.1
  callCenterFee: 12_000, // TZ 2.2
  affiliateCoef: 1.29, // TZ 2.1, NRX-3
  adCost: 50_420, // TZ 2.1, 2.6
  markupCapPercent: 10, // TZ 2.5-1, NRX-4
  deliveryMode: DeliveryDisplayMode.PARTIAL, // TZ 2.4 «Qisman (sukut)»
  visibleCenter: 30_000, // TZ 2.4, NRX-8
  visibleAddress: 50_000, // TZ 2.4, NRX-8
};

/** Elchi tariflari, 14.08.2026 (TZ 2.4, NRX-7, ELC-6). */
export const TZ_DEFAULT_ELCHI_TARIFF: ElchiTariff = {
  centerBase: 40_000,
  baseWeightGrams: 3_000,
  perExtraKg: 4_000,
  addressExtra: 20_000,
};
