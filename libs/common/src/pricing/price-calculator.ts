/**
 * BE-09: narx kalkulyatori (TZ 2-bo‘lim, 6.13 NRX-1…NRX-13). Sof funksiyalar — catalog va keyingi kartalar
 * (BE-18 buyurtma nusxasi) bir xil hisobni ishlatadi. Hamma summa butun so‘m (TZ 2.5-7); oraliq qiymatlar aniq
 * hisoblanadi, holat aniq qiymat bilan aniqlanadi, ko‘rsatish uchun yaxlitlanadi.
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

export enum DeliveryKind {
  CENTER = 'CENTER',
  ADDRESS = 'ADDRESS',
}

/** Narx parametrlari (ADM-2; global → kategoriya → mahsulot). Qiymatlar manbasi — TZ 2.1, 2.2, 2.4, 2.5. */
export interface PricingParams {
  /** K — har sotuvdagi qat’iy xarajatlar, sotilish 70% da (TZ 2.1: 29 688). */
  kSale70: number;
  /** K — har bir tasdiqlangan buyurtma sotilganda (TZ 2.1: 15 232) — qat’iy pastki chegara. */
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
  /** Ko‘rinadigan yetkazish: markazgacha (sukut 30 000) va eshikkacha (sukut 50 000) (TZ 2.4, NRX-8). */
  visibleCenter: number;
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

export const ceilTo = (value: number, step: number) =>
  Math.ceil(value / step) * step;
export const floorTo = (value: number, step: number) =>
  Math.floor(value / step) * step;

/** Soliq va to‘lov xarajatidan keyin qoladigan qism: 1 − 0.04 − 0.0185 = 0.9415 (TZ 2.1). */
export const netFactor = (p: PricingParams) => 1 - p.taxRate - p.paymentRate;
/** Soliqdan keyin qoladigan qism: 0.96 (TZ 2.1). */
export const afterTax = (p: PricingParams) => 1 - p.taxRate;

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
  /** Tovar narxiga qo‘shiladigan yashirilgan qism (markazgacha asosida). */
  hidden: number;
  /** Yashirilgan qism ÷ 0.9415, 1 000 ga yuqoriga (TZ 2.4, NRX-9). */
  hiddenPriceAdd: number;
}

/**
 * Yetkazish ko‘rinishi bir dona uchun. Yashirilgan qism markazgacha tarif bo‘yicha [taklif]: eshikkacha ko‘rinadigan
 * summa — eshik tarifi minus shu yashirilgan qism, admin yozgan bo‘lsa — o‘sha (tarifdan oshmaydi).
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
  if (p.deliveryMode === DeliveryDisplayMode.SEPARATE)
    visibleCenter = tariffCenter;
  else if (p.deliveryMode === DeliveryDisplayMode.FREE) visibleCenter = 0;
  else visibleCenter = Math.min(p.visibleCenter, tariffCenter);
  const hidden = tariffCenter - visibleCenter;
  let visibleAddress: number;
  if (p.deliveryMode === DeliveryDisplayMode.SEPARATE)
    visibleAddress = tariffAddress;
  else if (p.deliveryMode === DeliveryDisplayMode.FREE) visibleAddress = 0;
  else visibleAddress = Math.min(p.visibleAddress, tariffAddress);
  return {
    tariffCenter,
    tariffAddress,
    visibleCenter,
    visibleAddress,
    hidden,
    hiddenPriceAdd: hidden > 0 ? ceilTo(hidden / netFactor(p), 1000) : 0,
  };
}

/** Narx `price` (mijoz ko‘radigan tovar narxi) uchun platforma natijasi (TZ 2.6), aniq qiymat. */
export function platformResultExact(
  p: PricingParams,
  input: {
    price: number;
    basePrice: number;
    affiliateFee: number;
    hidden: number;
  },
  k: number,
): number {
  return (
    afterTax(p) * (input.price - input.basePrice - input.affiliateFee) -
    p.paymentRate * input.price -
    k -
    input.hidden
  );
}

/** Platforma natijasi `k` da nolga teng bo‘ladigan narx (aniq). */
function breakevenExact(
  p: PricingParams,
  basePrice: number,
  affiliateFee: number,
  k: number,
  hidden: number,
  margin = 0,
): number {
  return (
    (afterTax(p) * (basePrice + affiliateFee) + k + margin + hidden) /
    netFactor(p)
  );
}

export interface PriceCalculation {
  basePrice: number;
  affiliateFee: number;
  /** Tavsiya narx alohida rejimda, 1 000 ga yuqoriga (TZ 2.1; 2.3 jadvali). */
  recommendedBase: number;
  /** Zararsizlik narxi alohida rejimda (M = 0), yuqoriga (TZ 2.3). */
  breakevenBase: number;
  /**
   * Qat’iy pastki chegara alohida rejimda (K = sotilish 100%). TZ 2.3 jadvalidagi qiymat butun so‘mga pastga
   * yaxlitlangan (225 206,59 → 225 206) — ko‘rsatish shunga mos; holat aniq qiymat bilan aniqlanadi.
   */
  hardFloorBase: number;
  delivery: DeliveryView;
  /** Mijoz ko‘radigan tavsiya tovar narxi: tavsiya + yashirilgan qism (TZ 2.4: qisman 262 000). */
  recommended: number;
  /** Rejimdagi chegaralar (holatlar oralig‘i, TZ 2.6): sariq va to‘q sariqning eng kichik narxi. */
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
  const delivery = deliveryView(p, tariff, input.weightGrams);
  const recommendedBase = ceilTo(
    breakevenExact(p, basePrice, affiliateFee, p.kSale70, 0, p.targetMargin),
    1000,
  );
  const recommended = recommendedBase + delivery.hiddenPriceAdd;
  return {
    basePrice,
    affiliateFee,
    recommendedBase,
    breakevenBase: Math.ceil(
      breakevenExact(p, basePrice, affiliateFee, p.kSale70, 0),
    ),
    hardFloorBase: Math.floor(
      breakevenExact(p, basePrice, affiliateFee, p.kSale100, 0),
    ),
    delivery,
    recommended,
    yellowFrom: Math.ceil(
      breakevenExact(p, basePrice, affiliateFee, p.kSale70, delivery.hidden),
    ),
    orangeFrom: Math.ceil(
      breakevenExact(p, basePrice, affiliateFee, p.kSale100, delivery.hidden),
    ),
    platformSharePercent:
      Math.round(
        ((recommendedBase - basePrice - affiliateFee) / recommendedBase) * 1000,
      ) / 10,
  };
}

export interface PriceEvaluation {
  status: PriceStatus;
  price: number;
  /** To‘rt qator taqsimoti (TZ 2.2): optovik, sotuvchi, qo‘ng‘iroq markazi, platforma xizmati (qoldiq). */
  split: {
    wholesaler: number;
    affiliate: number;
    callCenter: number;
    platformService: number;
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

/** Admin narxi: holat va har tomonning natijasi (TZ 2.6, NRX-6, NRX-13). */
export function evaluatePrice(
  p: PricingParams,
  calc: PriceCalculation,
  price: number,
): PriceEvaluation {
  const input = {
    price,
    basePrice: calc.basePrice,
    affiliateFee: calc.affiliateFee,
    hidden: calc.delivery.hidden,
  };
  const r70 = platformResultExact(p, input, p.kSale70);
  const r100 = platformResultExact(p, input, p.kSale100);
  const affiliateResult = calc.affiliateFee - p.adCost;
  let status: PriceStatus;
  if (r100 < 0) status = PriceStatus.RED;
  else if (price >= calc.recommended) status = PriceStatus.GREEN;
  else if (r70 >= 0 && affiliateResult >= 0) status = PriceStatus.YELLOW;
  else status = PriceStatus.ORANGE;

  // NRX-13: platforma natijasi (70%) ≥ 0 bo‘ladigan eng katta sotuvchi haqi; u reklama xarajatidan kam bo‘lsa — yo‘q
  let safeAffiliateFee: number | null = null;
  if (status === PriceStatus.ORANGE || status === PriceStatus.RED) {
    const max = Math.floor(
      price -
        calc.basePrice -
        (p.paymentRate * price + p.kSale70 + calc.delivery.hidden) /
          afterTax(p),
    );
    safeAffiliateFee = max >= p.adCost ? max : null;
  }
  return {
    status,
    price,
    split: {
      wholesaler: calc.basePrice,
      affiliate: calc.affiliateFee,
      callCenter: p.callCenterFee,
      platformService:
        price - calc.basePrice - calc.affiliateFee - p.callCenterFee,
    },
    platformResult70: Math.floor(r70),
    platformResult100: Math.floor(r100),
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
  const goods = approvedPrice - delivery.hiddenPriceAdd;
  let max = floorTo(approvedPrice + (goods * p.markupCapPercent) / 100, 1000);
  if (marketTotal != null)
    max = Math.min(max, marketTotal - delivery.visibleCenter);
  return Math.max(max, approvedPrice);
}

export interface MarketCheck {
  /** Bizda mijoz jami (tovar + ko‘rinadigan markazgacha yetkazish). */
  ourTotal: number;
  competitorTotal: number;
  verdict: 'MOS' | 'QIMMAT';
  /** Mijoz jami raqobatchidan oshmaydigan eng yuqori bazaviy narx (optovik uchun); yo‘q bo‘lsa — null. */
  maxBasePrice: number | null;
}

/**
 * NRX-5: raqobatchida mijoz jami to‘laydigan summa bilan solishtirish (tavsiya narx bo‘yicha) va optovik uchun eng
 * yuqori bazaviy narx: ceil1000(x(B)) + yashirilgan qism + ko‘rinadigan yetkazish ≤ raqobatchi summasi.
 */
export function marketCheck(
  p: PricingParams,
  calc: PriceCalculation,
  competitorTotal: number,
): MarketCheck {
  const ourTotal = calc.recommended + calc.delivery.visibleCenter;
  const limit = floorTo(
    competitorTotal -
      calc.delivery.visibleCenter -
      calc.delivery.hiddenPriceAdd,
    1000,
  );
  const maxBase = Math.floor(
    (netFactor(p) * limit - p.kSale70 - p.targetMargin) / afterTax(p) -
      calc.affiliateFee,
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
