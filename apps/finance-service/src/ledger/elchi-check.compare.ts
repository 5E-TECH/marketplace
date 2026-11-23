import {
  ElchiCheckParcel,
  ElchiCheckReason,
  ElchiShipmentStatus,
  LeadOrderStatus,
  leadOrderIdFromElchiRef,
} from '@app/common';

/** Moliyada yozilgan Elchi o‘tkazmasi (BE-22 `remittance_item`, buyurtmaning oxirgi qatori). */
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
}

const S = LeadOrderStatus;
/** Elchi’da harakatda (sotilmagan) — bizda topshirilgan yoki yo‘lda. */
const MOVING = [S.HANDED_TO_ELCHI, S.IN_TRANSIT];
/** Sotildi, pul hali o‘tkazilmagan yoki qisman — bizda yetkazildi (BE-21: `sold`, `partly_paid` → DELIVERED). */
const SOLD = [S.DELIVERED, S.RETURN_REQUESTED];
/**
 * To‘landi (BE-21: `paid` → REMITTED). Qaytarish so‘rovi ochiq buyurtmada «to‘landi» holatni o‘zgartirmaydi (BE-44),
 * keyin qaytarish tasdiqlansa — qaytmoqda/saralandi.
 */
const PAID = [
  S.REMITTED,
  S.SETTLED,
  S.RETURN_REQUESTED,
  S.RETURNING,
  S.RETURNED_GRADED,
];
/** Sotuvsiz yopildi (rad, qaytdi, bekor). */
const CLOSED_WITHOUT_SALE = [
  S.REFUSED,
  S.RETURNING,
  S.RETURNED_GRADED,
  S.CANCELLED,
];

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
  cancelled: CLOSED_WITHOUT_SALE,
  'cancelled (sent)': CLOSED_WITHOUT_SALE,
  returned_to_market: CLOSED_WITHOUT_SALE,
  closed: [...new Set([...CLOSED_WITHOUT_SALE, S.REMITTED, S.SETTLED])],
};

/** Elchi pulni bizga o‘tkazgan (to‘liq yoki qisman) holatlar — moliyada o‘tkazma yozuvi bo‘lishi kerak. */
const ELCHI_REMITTED = new Set(['paid', 'partly_paid']);
/** Mijozdan pul yig‘ilgan holatlar — yig‘ilgan summa buyurtma COD si bilan solishtiriladi. */
const ELCHI_SOLD = new Set(['sold', 'partly_paid', 'paid']);

/**
 * Bitta posilka: bizdagi holat va pul ↔ Elchi’dagi. Sabablar bo‘sh — mos.
 * - holat: `ELCHI_STATUS_MATCH` bo‘yicha (noma’lum Elchi holati — alohida sabab);
 * - Elchi posilkasi boshqa buyurtmaga bog‘langan bo‘lsa (`external_order_id`) — ORDER_REF;
 * - Elchi sotgan bo‘lsa: mijozdan yig‘ilgani buyurtma COD si bilan (onlayn to‘lov yo‘q — lid buyurtmasi faqat COD);
 * - Elchi o‘tkazgan bo‘lsa: moliyada o‘tkazma yozuvi bo‘lishi va undagi yig‘ilgan, Elchi haqi, o‘tkazilgan summa
 *   Elchi’dagi bilan bir xil bo‘lishi (Elchi webhooki va partner API bir manbadan — `resolvePartnerMoneyFields`).
 */
export function compareElchiShipment(
  parcel: ElchiCheckParcel,
  elchi: ElchiShipmentStatus,
  recorded: RecordedRemittance | null,
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
  if (
    ELCHI_SOLD.has(status) &&
    collected !== null &&
    collected !== parcel.codAmount
  )
    reasons.add(ElchiCheckReason.COLLECTED);

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

  return {
    reasons: [...reasons].sort(),
    elchiCollected: collected,
    elchiFee: elchi.elchiFee,
    elchiMarketPaid: elchi.marketPaidAmount,
  };
}
