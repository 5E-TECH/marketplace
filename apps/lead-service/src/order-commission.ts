import { OrderStatusChangedEvent } from '@app/common';

/**
 * Ustamaning sotuvchi ulushi: 85% (11-qaror, TZ 01:23; 2.5-1, 01:111), pastga yaxlitlab — qoldiq platformaga.
 * finance-service `split.ts` (MARKUP_AFFILIATE_PERCENT) bilan bir xil bo‘lishi shart: `order-commission.spec.ts`
 * ikkalasini solishtiradi.
 */
const MARKUP_AFFILIATE_PERCENT = 85;

/**
 * «Kutilmoqda» haqi (hujjat-statistika-csv H ustuni: L-1197 86 250 = 65 000 + 21 250 ustama):
 * buyurtma narx nusxasidan sotuvchi haqi + ustamaning sotuvchi ulushi. Yetkazilgandan keyin haq
 * ledgerdan olinadi (BE-22), bu qiymat faqat yetkazilguncha ko‘rsatiladi. Ma’lumot noto‘g‘ri bo‘lsa — null.
 */
export function expectedAffiliateCommission(
  items: OrderStatusChangedEvent['items'] | undefined,
): number | null {
  if (!Array.isArray(items) || !items.length) return null;
  let total = 0;
  for (const item of items) {
    const q = item?.quantity;
    const fee = item?.split?.affiliateFee;
    const sale = item?.salePrice;
    const approved = item?.approvedPrice;
    if (
      ![q, fee, sale, approved].every(
        (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
      ) ||
      q < 1 ||
      sale < approved
    )
      return null;
    const markup = (sale - approved) * q;
    total += fee + Math.floor((markup * MARKUP_AFFILIATE_PERCENT) / 100);
  }
  return Number.isSafeInteger(total) ? total : null;
}
