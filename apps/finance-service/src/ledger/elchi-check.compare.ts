import {
  ElchiCheckParcel,
  ElchiCheckReason,
  ElchiShipmentStatus,
  LeadOrderStatus,
  leadOrderIdFromElchiRef,
} from '@app/common';

/**
 * Moliyada yozilgan Elchi o‘tkazmasi (BE-22 `remittance_item`): to‘langan jami eng katta bo‘lgan o‘tkazma qatori —
 * ledger ham shunday hisoblaydi (kech kelgan eskirgan snapshot takror sanaladi, `applyRemittance`).
 */
export interface RecordedRemittance {
  collectedFromCustomer: number | null;
  elchiFee: number | null;
  marketPaidAmount: number | null;
}

export interface ElchiCheckComparison {
  reasons: ElchiCheckReason[];
  elchiCollected: number | null;
  elchiFee: number | null;
  elchiMarketPaid: number | null;
  elchiExtraCost: number;
}

const S = LeadOrderStatus;
/** Elchi’da harakatda (sotilmagan) — bizda topshirilgan yoki yo‘lda. */
const MOVING = [S.HANDED_TO_ELCHI, S.IN_TRANSIT];
/**
 * Sotilgan (bozorga to‘lov hali yo‘q yoki qisman; BE-21: `sold`, `partly_paid` → DELIVERED). Qaytarish (BE-44) —
 * bizning ichki qarorimiz, Elchi’ga bormaydi: Elchi «sotildi» da qoladi, bizda qaytarish so‘rovi, qaytmoqda yoki
 * saralandi bo‘lishi mumkin.
 */
const SOLD = [S.DELIVERED, S.RETURN_REQUESTED, S.RETURNING, S.RETURNED_GRADED];
/** To‘landi (BE-21: `paid` → REMITTED); qaytarish holatlari SOLD dagi sabab bilan. */
const PAID = [
  S.REMITTED,
  S.SETTLED,
  S.RETURN_REQUESTED,
  S.RETURNING,
  S.RETURNED_GRADED,
];
/** Elchi bekor qildi (mijoz olmadi) — bizda rad etildi, keyin qaytmoqda/saralandi; topshirishgacha bekor — CANCELLED. */
const CANCELLED_BY_ELCHI = [
  S.REFUSED,
  S.RETURNING,
  S.RETURNED_GRADED,
  S.CANCELLED,
];
/**
 * Bozorga qaytarildi: BE-21 `returned` xabari rad etilganni RETURNING ga o‘tkazadi — bizda hali REFUSED bo‘lsa, xabar
 * yo‘qolgan (ombor qaytgan posilkani ko‘rmaydi). Topshirishgacha bekor qilingani (CANCELLED) o‘zgarmaydi.
 */
const RETURNED = [S.RETURNING, S.RETURNED_GRADED, S.CANCELLED];

/**
 * Elchi buyurtma holati (Elchi-Backend `Order_status`) → bizdagi mos holatlar. Elchi holati bizdagi har qanday
 * oraliq holat bilan mos kelishi mumkin (xabarlar kechikadi) — faqat zid bo‘lsa farq.
 * `closed` — Elchi’ning yakuniy holati (asosan bekor qilingan tovar, BE-21 izohi) — sotuvli yoki sotuvsiz yakun.
 */
export const ELCHI_STATUS_MATCH: Readonly<Record<string, LeadOrderStatus[]>> = {
  created: MOVING,
  new: MOVING,
  received: MOVING,
  'on the road': MOVING,
  waiting: MOVING,
  waiting_customer: MOVING,
  sold: SOLD,
  partly_paid: SOLD,
  paid: PAID,
  cancelled: CANCELLED_BY_ELCHI,
  'cancelled (sent)': CANCELLED_BY_ELCHI,
  returned_to_market: RETURNED,
  closed: [...new Set([...CANCELLED_BY_ELCHI, S.REMITTED, S.SETTLED])],
};

/** Elchi pulni bizga o‘tkazgan (to‘liq yoki qisman) holatlar — moliyada o‘tkazma yozuvi bo‘lishi kerak. */
const ELCHI_REMITTED = new Set(['paid', 'partly_paid']);
/** Mijozdan pul yig‘ilgan holatlar — yig‘ilgan summa buyurtma COD si bilan solishtiriladi. */
const ELCHI_SOLD = new Set(['sold', 'partly_paid', 'paid']);
/** Sotuvsiz qaytgan holatlar — Elchi xarajati (`extra_cost`) bizdagi rad to‘lovi bilan (BE-21 `recordMoney`). */
const ELCHI_REFUSED = new Set([
  'cancelled',
  'cancelled (sent)',
  'returned_to_market',
]);

/**
 * Bitta posilka: bizdagi holat va pul ↔ Elchi’dagi. Sabablar bo‘sh — mos.
 * - holat: `ELCHI_STATUS_MATCH` bo‘yicha (noma’lum Elchi holati — alohida sabab);
 * - Elchi posilkasi boshqa buyurtmaga bog‘langan bo‘lsa (`external_order_id`) — ORDER_REF;
 * - Elchi sotgan bo‘lsa: mijozdan yig‘ilgani buyurtma COD si bilan (onlayn to‘lov yo‘q — lid buyurtmasi faqat COD);
 *   kuryer qo‘shimcha xarajat yozgan bo‘lsa — EXTRA_COST (Elchi uni o‘tkazmadan ushlaydi, moliya buni yozmaydi);
 * - Elchi o‘tkazgan bo‘lsa: moliyada o‘tkazma yozuvi bo‘lishi va undagi yig‘ilgan, Elchi haqi, o‘tkazilgan summa
 *   Elchi’dagi bilan bir xil bo‘lishi (Elchi webhooki va partner API bir manbadan — `resolvePartnerMoneyFields`);
 * - Elchi sotmay qaytargan bo‘lsa: Elchi xarajati = moliyadagi rad to‘lovi (ikkalasi yo‘q — mos).
 */
export function compareElchiShipment(
  parcel: ElchiCheckParcel,
  elchi: ElchiShipmentStatus,
  recorded: RecordedRemittance | null,
  recordedRefusalFee: number | null = null,
): ElchiCheckComparison {
  const reasons = new Set<ElchiCheckReason>();
  const status = String(elchi.status ?? '').trim();
  const allowed = ELCHI_STATUS_MATCH[status];
  if (!allowed) reasons.add(ElchiCheckReason.UNKNOWN_STATUS);
  else if (!allowed.includes(parcel.status))
    reasons.add(ElchiCheckReason.STATUS);

  if (
    elchi.externalOrderId !== null &&
    leadOrderIdFromElchiRef(elchi.externalOrderId) !== parcel.orderId
  )
    reasons.add(ElchiCheckReason.ORDER_REF);

  const collected = elchi.collectedFromCustomer;
  const extraCost = elchi.extraCost ?? 0;
  if (ELCHI_SOLD.has(status)) {
    if (collected !== null && collected !== parcel.codAmount)
      reasons.add(ElchiCheckReason.COLLECTED);
    if (extraCost > 0) reasons.add(ElchiCheckReason.EXTRA_COST);
  }

  if (ELCHI_REMITTED.has(status)) {
    if (!recorded) reasons.add(ElchiCheckReason.NO_REMITTANCE);
    else {
      if (collected !== null && recorded.collectedFromCustomer !== collected)
        reasons.add(ElchiCheckReason.COLLECTED);
      if (elchi.elchiFee !== null && recorded.elchiFee !== elchi.elchiFee)
        reasons.add(ElchiCheckReason.FEE);
      if (recorded.marketPaidAmount !== elchi.marketPaidAmount)
        reasons.add(ElchiCheckReason.MARKET_PAID);
    }
  }

  if (ELCHI_REFUSED.has(status) && (recordedRefusalFee ?? 0) !== extraCost)
    reasons.add(ElchiCheckReason.REFUSAL_FEE);

  return {
    reasons: [...reasons].sort(),
    elchiCollected: collected,
    elchiFee: elchi.elchiFee,
    elchiMarketPaid: elchi.marketPaidAmount,
    elchiExtraCost: extraCost,
  };
}
