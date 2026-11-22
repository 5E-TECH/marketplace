import { LeadOrderStatus } from './order-events.dto';

/**
 * Lid buyurtmasi (BE-18): holatlar mashinasi, narx nusxasi va ichki RPC lar.
 * TZ 6.5 BUY-1–4, T5 (02-texnik-qism.md:92-103), NRX-10, T9-5.
 */

/**
 * Ruxsat etilgan o‘tishlar (TZ T5 «Buyurtma» jadvali). Boshqa har qanday o‘tish rad etiladi va jurnalga yoziladi
 * (BUY-2). RETURN_REQUESTED dan keyingi holatlar T5 da yo‘q — BE-44 [taklif]: `LEAD_RETURN_TRANSITIONS`.
 */
export const LEAD_ORDER_TRANSITIONS: Readonly<
  Record<LeadOrderStatus, readonly LeadOrderStatus[]>
> = {
  [LeadOrderStatus.CONFIRMED]: [
    LeadOrderStatus.PICKING,
    LeadOrderStatus.CANCELLED,
  ],
  [LeadOrderStatus.PICKING]: [
    LeadOrderStatus.PACKED,
    LeadOrderStatus.CANCELLED,
  ],
  [LeadOrderStatus.PACKED]: [
    LeadOrderStatus.HANDED_TO_ELCHI,
    LeadOrderStatus.CANCELLED,
  ],
  [LeadOrderStatus.HANDED_TO_ELCHI]: [LeadOrderStatus.IN_TRANSIT],
  [LeadOrderStatus.IN_TRANSIT]: [
    LeadOrderStatus.DELIVERED,
    LeadOrderStatus.REFUSED,
  ],
  [LeadOrderStatus.DELIVERED]: [
    LeadOrderStatus.REMITTED,
    LeadOrderStatus.RETURN_REQUESTED,
  ],
  [LeadOrderStatus.REMITTED]: [LeadOrderStatus.SETTLED],
  [LeadOrderStatus.REFUSED]: [LeadOrderStatus.RETURNING],
  [LeadOrderStatus.RETURNING]: [LeadOrderStatus.RETURNED_GRADED],
  // BE-44: qaror o‘tishlari umumiy jadvalda emas (Elchi xabari yo‘l qidirib kutilayotgan qaytarishni chetlab o‘tmasin) —
  // faqat qaytarish oqimi: `LEAD_RETURN_TRANSITIONS`
  [LeadOrderStatus.RETURN_REQUESTED]: [],
  [LeadOrderStatus.SETTLED]: [],
  [LeadOrderStatus.RETURNED_GRADED]: [],
  [LeadOrderStatus.CANCELLED]: [],
};

/**
 * BE-44 [taklif, T5 ga yoziladi]: qaytarish so‘rovi qarori — tasdiq: tovar qaytmoqda (BE-17 saralashi), rad: yetkazilgan.
 * Faqat xodim qarori bilan (`LeadReturnService`); Elchi, ombor va boshqa o‘tishlar bu yo‘lni ishlata olmaydi.
 */
export const LEAD_RETURN_TRANSITIONS: Readonly<
  Partial<Record<LeadOrderStatus, readonly LeadOrderStatus[]>>
> = {
  [LeadOrderStatus.RETURN_REQUESTED]: [
    LeadOrderStatus.RETURNING,
    LeadOrderStatus.DELIVERED,
  ],
};

export function isLeadOrderTransitionAllowed(
  from: LeadOrderStatus,
  to: LeadOrderStatus,
): boolean {
  return LEAD_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** BUY-3: Elchi’ga topshirilgunga qadar bekor qilish mumkin bo‘lgan holatlar. */
export const LEAD_ORDER_CANCELLABLE: readonly LeadOrderStatus[] = [
  LeadOrderStatus.CONFIRMED,
  LeadOrderStatus.PICKING,
  LeadOrderStatus.PACKED,
];

/**
 * Kuryer mijozdan oladigan summa (COD) — yagona hisob (TZ T9-5): tovarlar (sotuv narxi × soni) + mijozga
 * ko‘rinadigan yetkazish. Oldindan to‘langan buyurtmada 0. Butun so‘m (BE-01).
 */
export function orderCodAmount(input: {
  items: ReadonlyArray<{ unitPrice: number; quantity: number }>;
  deliveryFee: number;
  prepaid?: boolean;
}): number {
  if (input.prepaid) return 0;
  const goods = input.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const total = goods + input.deliveryFee;
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error(`COD summasi noto‘g‘ri: ${total}`);
  return total;
}

/** Ichki RPC nomlari (BE-18). */
export const LEAD_ORDER_RPC = {
  /** checkout → catalog: buyurtma uchun narx nusxasi (tasdiqlangan narx, taqsimot, yetkazish). */
  CATALOG_SNAPSHOT: 'catalog.order.snapshot',
  /** BE-19 (ombor), BE-21 (Elchi webhook), moliya → checkout: holatni o‘zgartirish. */
  TRANSITION: 'checkout.order.transition',
  /** gateway → checkout: operator, nazoratchi yoki admin bekor qiladi (BUY-3). */
  CANCEL: 'checkout.order.cancel',
} as const;

/**
 * `catalog.order.snapshot` javobi: buyurtma yaratilgan paytdagi narx nusxasi (NRX-10). Narxlar bir dona uchun,
 * butun so‘m. `approvedPrice` null — offer sotuvga ochiq emas yoki narxi tasdiqlanmagan (buyurtma yaratilmaydi).
 */
export interface CatalogOrderSnapshot {
  productId: string;
  productName: string;
  /** CPA mahsulotida bitta faol variant (BE-07). */
  variantId: string | null;
  sku: string | null;
  /** Variant shtrix-kodi (BE-19 skaneri; OMB-2); yo‘q bo‘lsa — SKU skanerlanadi. */
  barcode: string | null;
  /** Mahsulot optovigi (`catalog.shop`, BE-07). */
  wholesalerId: string;
  weightGrams: number;
  cpaAvailable: boolean;
  withdrawn: boolean;
  basePrice: number;
  recommendedPrice: number;
  approvedPrice: number | null;
  affiliateFee: number;
  callCenterFee: number;
  /** Tovar narxiga qo‘shilgan yashirilgan yetkazish (TZ 2.4, bir dona). */
  hiddenDelivery: number;
  /** Platforma xizmati tasdiqlangan narxda (qoldiq, TZ 2.2). */
  platformService: number;
  delivery: {
    mode: 'SEPARATE' | 'PARTIAL' | 'FREE';
    /** Mijozga ko‘rinadigan yetkazish, jami (BE-09 `quote`). */
    shown: number;
    /** Elchi tarifi jami og‘irlik bo‘yicha (BUY-4, NRX-7). */
    elchiTariff: number;
  };
}

export enum LeadOrderActorType {
  SYSTEM = 'SYSTEM',
  USER = 'USER',
  ELCHI = 'ELCHI',
}

export interface LeadOrderActor {
  type: LeadOrderActorType;
  /** Foydalanuvchi ID si (USER); tizim va Elchi uchun null. */
  id: string | null;
  /** Foydalanuvchi roli (jurnal uchun). */
  role?: string | null;
}

/** `checkout.order.transition` / `checkout.order.cancel` kirishi. */
export interface LeadOrderTransitionInput {
  orderId: string;
  to: LeadOrderStatus;
  actor: LeadOrderActor;
  reason?: string | null;
}
