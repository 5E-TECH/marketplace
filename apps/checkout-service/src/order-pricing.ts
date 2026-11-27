/**
 * FE-26 (BE-25): buyurtma kartasidagi «Narx nusxasi» — faqat buyurtmaga muhrlangan qiymatlardan (NRX-10; buyurtma
 * yaratilganda `catalog.order.snapshot` bitta hisob bilan yozadi — `lead-order.service.ts`). Katalog va joriy tarif
 * qayta hisoblanmaydi.
 *
 * Bir xil nomli, ammo boshqa ma’noli maydonlar (adashmang):
 * - `priceSnapshot.recommendedPrice` — shu rejimdagi tavsiya (262 000), `pricing.recommendedPrice` — alohida rejim
 *   tavsiyasi, formula P (251 000; price-calculator.ts `recommended = recommendedBase + hiddenPriceAdd`);
 * - `priceSnapshot.hiddenDelivery` va `lead.deliveryEmbedded` — narxga qo‘shimcha (11 000), `pricing.hiddenDelivery`
 *   — Elchi tarifining mijozga ko‘rinmagan qismi (10 000), `pricing.priceAdd` — o‘sha 11 000.
 */
export interface OrderPricingSplit {
  wholesaler: number;
  affiliate: number;
  callCenter: number;
  platformService: number;
}

export interface OrderPricing {
  /** Bir dona, sahifa narxi (ustama bilan). */
  salePrice: number;
  /** Bir dona, tasdiqlangan narx. */
  approvedPrice: number;
  /** Bir dona, sotuvchi ustamasi (sale − approved). */
  markup: number;
  /** Tavsiya, alohida rejim (formula P) = shu rejim tavsiyasi − narxga qo‘shimcha. */
  recommendedPrice: number;
  /** Tavsiya shu rejimda (= `priceSnapshot.recommendedPrice`). */
  recommendedModePrice: number;
  /** Narx tasdiqlangan vaqt — gateway katalogdagi narx qaroridan to‘ldiradi. */
  approvedAt: string | null;
  deliveryMode: string;
  /** Elchi tarifining mijozga ko‘rinmagan qismi = tarif − ko‘rinadigan yetkazish (FREE da — butun tarif). */
  hiddenDelivery: number;
  /** Narxga qo‘shimcha, bir dona (= `priceSnapshot.hiddenDelivery`). */
  priceAdd: number;
  /** Ko‘rinadigan yetkazish: markazgacha va eshikkacha (tanlanmagani — buyurtma paytidagi nusxa; eski buyurtmada null). */
  visibleCenter: number | null;
  visibleAddress: number | null;
  /** Elchi tarifi (jami og‘irlik, tanlangan tur). */
  elchiTariff: number;
  /** To‘rt qator taqsimoti — buyurtma jami (dona soni bilan); moliya ledgeridagi qatorlar bilan bir xil. */
  split: OrderPricingSplit;
}

interface Snapshot {
  basePrice: number;
  recommendedPrice: number;
  approvedPrice: number;
  markup: number;
  affiliateFee: number;
  callCenterFee: number;
  hiddenDelivery: number;
  platformService: number;
}

export interface OrderPricingSource {
  sellerOrders: Array<{
    items: Array<{
      unitPrice: number;
      quantity: number;
      priceSnapshot: Snapshot | null;
    }>;
  }>;
  lead: {
    deliveryMode: string | null;
    whereDeliver: string | null;
    deliveryShown: number | null;
    deliveryShownOther?: number | null;
    deliveryCost: number | null;
  } | null;
}

/** Lid buyurtmasi emas yoki biror qatorda narx nusxasi yo‘q — null. Bir dona maydonlari birinchi qatordan (CSV kabi). */
export function orderPricing(order: OrderPricingSource): OrderPricing | null {
  const lead = order?.lead;
  const items = (order?.sellerOrders ?? []).flatMap((s) => s.items ?? []);
  if (
    !lead ||
    !lead.deliveryMode ||
    lead.deliveryCost == null ||
    lead.deliveryShown == null ||
    !items.length ||
    items.some((i) => !i.priceSnapshot)
  )
    return null;
  const first = items[0];
  const s = first.priceSnapshot!;
  const split: OrderPricingSplit = {
    wholesaler: 0,
    affiliate: 0,
    callCenter: 0,
    platformService: 0,
  };
  for (const item of items) {
    const q = Number(item.quantity);
    const p = item.priceSnapshot!;
    split.wholesaler += p.basePrice * q;
    split.affiliate += p.affiliateFee * q;
    split.callCenter += p.callCenterFee * q;
    split.platformService += p.platformService * q;
  }
  const shown = Number(lead.deliveryShown);
  const cost = Number(lead.deliveryCost);
  const toAddress = lead.whereDeliver === 'ADDRESS';
  const other =
    lead.deliveryShownOther == null ? null : Number(lead.deliveryShownOther);
  return {
    salePrice: Number(first.unitPrice),
    approvedPrice: s.approvedPrice,
    markup: s.markup,
    recommendedPrice: s.recommendedPrice - s.hiddenDelivery,
    recommendedModePrice: s.recommendedPrice,
    approvedAt: null,
    deliveryMode: lead.deliveryMode,
    hiddenDelivery: Math.max(0, cost - shown),
    priceAdd: s.hiddenDelivery,
    visibleCenter: toAddress ? other : shown,
    visibleAddress: toAddress ? shown : other,
    elchiTariff: cost,
    split,
  };
}
