import { LeadOrderStatus, OrderStatusChangedEvent } from '@app/common';

/** BE-24: SMS matnlari — dizayn taxtalaridan (xabar-mijoz-tasdiqlandi, xabar-mijoz-yolda, xabar-pul). */

const money = (n: number) =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** «Simsiz quloqchinlar» yoki «Simsiz quloqchinlar va Elektr choynak». */
function goodsName(event: OrderStatusChangedEvent): string {
  const names = event.items.map((i) => i.name.trim()).filter(Boolean);
  if (names.length <= 1) return names[0] ?? 'buyurtma';
  if (names.length === 2) return `${names[0]} va ${names[1]}`;
  // dizayn: «va yana N ta tovar»
  return `${names[0]} va yana ${names.length - 1} ta tovar`;
}

function goodsTotal(event: OrderStatusChangedEvent): number {
  return event.items.reduce((sum, i) => sum + i.salePrice * i.quantity, 0);
}

/** «Qo‘qon shahri markazigacha» / «Qarshi shahri bo‘yicha eshikkacha»; joy nomi bo‘lmasa — joysiz. */
function place(
  event: OrderStatusChangedEvent,
  district: string | null,
  midSentence = false,
): string {
  const toDoor =
    String(event.recipient?.whereDeliver ?? '').toUpperCase() === 'ADDRESS';
  if (!district) {
    const text = toDoor ? 'Eshikkacha' : 'Markazgacha';
    return midSentence ? text.toLowerCase() : text;
  }
  return toDoor
    ? `${district} bo‘yicha eshikkacha`
    : `${district} markazigacha`;
}

/** Mijozga SMS kerak bo‘lgan holatlar (BUY-6). */
export const CUSTOMER_SMS_STATUSES: ReadonlySet<LeadOrderStatus> = new Set([
  LeadOrderStatus.CONFIRMED,
  LeadOrderStatus.IN_TRANSIT,
  LeadOrderStatus.DELIVERED,
]);

export function customerSmsText(
  event: OrderStatusChangedEvent,
  district: string | null,
): { type: string; title: string; body: string } | null {
  const order = event.orderNumber;
  const goods = goodsName(event);
  const total = money(event.codAmount);
  switch (event.status) {
    case LeadOrderStatus.CONFIRMED: {
      const free = event.delivery?.mode === 'FREE' || !event.delivery?.cost;
      const sum = free
        ? `jami ${total} so‘m, yetkazish bepul`
        : `jami ${total} so‘m (tovar ${money(goodsTotal(event))} + yetkazish ${money(event.delivery.cost)})`;
      return {
        type: 'order_confirmed',
        title: 'Buyurtma tasdiqlandi',
        body: `Buyurtmangiz tasdiqlandi: ${goods}, ${sum}. ${place(event, district)} yetkaziladi. To‘lov tovarni olganingizda. Buyurtma ${order}.`,
      };
    }
    case LeadOrderStatus.IN_TRANSIT: {
      const track = event.parcel?.shipmentId;
      return {
        type: 'order_in_transit',
        title: 'Posilka yo‘lga chiqdi',
        body: `Posilka yo‘lga chiqdi.${track ? ` Trek raqami: ${track}.` : ''} Buyurtma ${order}, ${goods}. Elchi Pochta ${place(event, district, true)} yetkazadi. To‘lov olganingizda: ${total} so‘m.`,
      };
    }
    case LeadOrderStatus.DELIVERED:
      // dizaynda yo‘q (sf-3 11-savol) — [taklif]
      return {
        type: 'order_delivered',
        title: 'Buyurtma yetkazildi',
        body: `Buyurtma ${order} yetkazildi: ${goods}. Xaridingiz uchun rahmat!`,
      };
    default:
      return null;
  }
}

export interface WithdrawalPaidEvent {
  withdrawalId: string;
  affiliateId: string;
  /** So‘ralgan summa, so‘m. */
  amount: number;
  /** 1% soliq (BE-23), so‘m. */
  tax: number;
  /** Kartaga o‘tgan summa, so‘m. */
  net: number;
}

/** xabar-pul: «Pul kartangizga o‘tkazildi: …» — karta (Uzcard *2208) BE-32 dan keyin. */
export function withdrawalPaidText(e: WithdrawalPaidEvent): string {
  return `Pul kartangizga o‘tkazildi: ${money(e.net)} so‘m. So‘rov ${money(e.amount)} so‘m, 1% soliq ${money(e.tax)} so‘m.`;
}
