import {
  calculatePrice,
  DeliveryDisplayMode,
  evaluatePrice,
  marketCheck,
  maxSalePriceFor,
  PriceStatus,
  pricingModes,
  recommendedAffiliateFee,
  TZ_DEFAULT_ELCHI_TARIFF,
  TZ_DEFAULT_PRICING,
} from '@app/common';

/**
 * BE-25 (TC3): `admin/pricing` va `admin/products/:id/pricing` javob misollari (OpenAPI, faqat `data` qismi —
 * gateway uni `{statusCode, message, data}` qobig‘iga o‘raydi). Raqamlar haqiqiy kalkulyatordan: TZ sukut sozlamasi
 * va Elchi tarifi, B = 140 000, A = 65 000, 1 kg, qisman rejim — TZ 2.3/2.4 dagi 262 000 (catalog `PricingService`).
 */
const PRODUCT = {
  basePrice: 140_000,
  affiliateFee: 65_000,
  weightGrams: 1_000,
};
const calculation = calculatePrice(
  TZ_DEFAULT_PRICING,
  TZ_DEFAULT_ELCHI_TARIFF,
  PRODUCT,
);
const approvedPrice = calculation.recommended;
/** Raqobatchida mijoz jami («Narx» varag‘i C63 misoli). */
const competitorTotal = 299_000;

/** `catalog.pricing.calculate` (`PricingService.view`): tasdiqlangan mahsulot, bozor narxi kiritilgan. */
export const PRICING_VIEW_EXAMPLE = {
  productId: '42',
  approvalCurrent: true,
  params: { ...TZ_DEFAULT_PRICING, deliveryModeSource: 'GLOBAL' },
  tariff: TZ_DEFAULT_ELCHI_TARIFF,
  recommendedAffiliateFee: recommendedAffiliateFee(TZ_DEFAULT_PRICING),
  calculation,
  evaluation: evaluatePrice(TZ_DEFAULT_PRICING, calculation, approvedPrice),
  modes: pricingModes(TZ_DEFAULT_PRICING, TZ_DEFAULT_ELCHI_TARIFF, PRODUCT),
  approvedPrice,
  priceStatus: PriceStatus.GREEN,
  marketTotal: competitorTotal,
  market: {
    ...marketCheck(TZ_DEFAULT_PRICING, calculation, competitorTotal),
    source: 'Uzum Market, 2026-11-19',
    checkedAt: '2026-11-19T09:10:00.000Z',
  },
  maxSalePrice: maxSalePriceFor(
    TZ_DEFAULT_PRICING,
    approvedPrice,
    calculation.delivery,
    competitorTotal,
  ),
};

/**
 * BE-25 (QA 2026-11-23, 2-tur): optovik narx hisobi — catalog `wholesaler-cabinet.service.ts` `pricingView`. Ichki
 * siyosat (`params`), Elchi tarifi va bozor narxi berilmaydi; hisob — admin ko‘radigan bilan bir xil kalkulyator.
 */
export const WHOLESALER_PRICING_EXAMPLE = {
  productId: PRICING_VIEW_EXAMPLE.productId,
  basePrice: PRODUCT.basePrice,
  affiliateFee: PRODUCT.affiliateFee,
  calculation,
  evaluation: PRICING_VIEW_EXAMPLE.evaluation,
  approvedPrice,
  priceStatus: PriceStatus.GREEN,
};

/**
 * `catalog.pricing.decide`: birinchi qaror. `decision` dan tashqari maydonlar qarordan OLDINGI mahsulot holatidan
 * hisoblanadi (`approvedPrice`, `priceStatus`, `maxSalePrice`, `approvalCurrent`); `evaluation` — yuborilgan narx.
 */
export const PRICE_DECISION_EXAMPLE = {
  decision: {
    id: '57',
    productId: '42',
    price: approvedPrice,
    basePrice: PRODUCT.basePrice,
    affiliateFee: PRODUCT.affiliateFee,
    recommended: calculation.recommended,
    status: PriceStatus.GREEN,
    reason: null,
    decidedBy: '3',
    createdAt: '2026-11-20T09:15:00.000Z',
  },
  ...PRICING_VIEW_EXAMPLE,
  approvalCurrent: false,
  approvedPrice: null,
  priceStatus: null,
  marketTotal: null,
  market: null,
  maxSalePrice: null,
};

/** `catalog.pricing.market-check` (NRX-5): 299 000 → eng yuqori bazaviy narx 148 099. */
export const MARKET_CHECK_EXAMPLE = {
  ...marketCheck(TZ_DEFAULT_PRICING, calculation, competitorTotal),
  source: 'Uzum Market, 2026-11-19',
  checkedAt: '2026-11-19T09:10:00.000Z',
};

/** `catalog.pricing.policy-get` / `policy-set` (`PricingService.policyView`): global daraja. */
export const GLOBAL_POLICY_EXAMPLE = {
  scope: 'GLOBAL',
  scopeId: null,
  ...TZ_DEFAULT_PRICING,
  updatedBy: '1',
  updatedAt: '2026-11-20T08:30:00.000Z',
};

const EMPTY_POLICY = Object.fromEntries(
  Object.keys(TZ_DEFAULT_PRICING).map((key) => [key, null]),
);

/** Kategoriya darajasi: faqat berilgan maydon, qolgani `null` — globaldan. */
export const CATEGORY_POLICY_EXAMPLE = {
  scope: 'CATEGORY',
  scopeId: '5',
  ...EMPTY_POLICY,
  markupCapPercent: 15,
  updatedBy: '1',
  updatedAt: '2026-11-21T07:10:00.000Z',
};

/** Mahsulot darajasi (admin): faqat yetkazish ko‘rinishi; bepul rejimda ko‘rinadigan summalar `null`. */
export const PRODUCT_POLICY_EXAMPLE = {
  scope: 'PRODUCT',
  scopeId: '42',
  ...EMPTY_POLICY,
  deliveryMode: DeliveryDisplayMode.FREE,
  updatedBy: '3',
  updatedAt: '2026-11-21T11:45:00.000Z',
};

/** `catalog.pricing.tariff-list` / `tariff-add`: `elchi_tariff` qatori (entity butunligicha). */
export const ELCHI_TARIFF_EXAMPLE = {
  id: '2',
  ...TZ_DEFAULT_ELCHI_TARIFF,
  // `ElchiTariffDto` misoli «2026-12-01T00:00:00+05:00» — UTC da qaytadi
  effectiveFrom: '2026-11-30T19:00:00.000Z',
  createdBy: '1',
  createdAt: '2026-11-21T12:00:00.000Z',
  updatedAt: '2026-11-21T12:00:00.000Z',
  isDeleted: false,
};
