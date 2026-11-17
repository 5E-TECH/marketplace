import { CheckoutDeliveryDestination } from './cart.dto';

/**
 * Buyurtma hodisalari (BE-20) [taklif]. `order.status.changed` ni checkout
 * yuboradi (BE-18, Dilshod); `elchi.parcel.*` ni elchi-integration (BE-20)
 * checkout ga qaytaradi (BE-19 yozadi). TZ T5 «Hodisalar» jadvali
 * (02-texnik-qism.md:112); maydonlar ro'yxati — BE-25 kartasi
 * («order.status.changed ning to‘liq maydonlari — iste’molchilar checkout
 * bazasiga murojaat qilmaydi»; iste'molchilar BE-20, BE-22, BE-24).
 *
 * Qoidalar: outbox orqali; qabul qiluvchi `eventId` bo'yicha takrorni tashlab
 * yuboradi (`processOnce`). BE-18 merge qilinguncha bu shakl — namuna; maydon
 * faqat qo'shiladi (orqaga mos).
 */
export const ORDER_EVENTS = {
  /** checkout → lead, notification, elchi-integration. */
  STATUS_CHANGED: 'order.status.changed',
  /** elchi-integration → checkout: posilka yaratildi. */
  PARCEL_CREATED: 'elchi.parcel.created',
  /** elchi-integration → checkout: posilka yaratilmadi, qo'lda ko'rish kerak. */
  PARCEL_FAILED: 'elchi.parcel.failed',
  /** elchi-integration → checkout: Elchi posilkani bekor qildi. */
  PARCEL_CANCELLED: 'elchi.parcel.cancelled',
  /** elchi-integration → checkout: Elchi bekor qilmadi (masalan, yetkazilgan). */
  PARCEL_CANCEL_FAILED: 'elchi.parcel.cancel-failed',
} as const;

/**
 * Elchi `external_order_id` prefiksi [taklif]. Eski yo'l (har do'kon marketi)
 * `sales_order_seller.id` ni raqam ko'rinishida yuboradi; Elchi takrorni
 * hamkor + `external_order_id` bo'yicha tekshiradi (market bo'yicha emas),
 * shuning uchun yangi buyurtma raqami eski id bilan to'qnashmasligi kerak.
 */
export const ELCHI_ORDER_REF_PREFIX = 'mp-order:';

export function elchiOrderRef(orderId: string): string {
  return `${ELCHI_ORDER_REF_PREFIX}${orderId}`;
}

/** Buyurtma holatlari — TZ T5 holatlar mashinasi (02-texnik-qism.md:92-103). */
export enum LeadOrderStatus {
  CONFIRMED = 'CONFIRMED',
  PICKING = 'PICKING',
  PACKED = 'PACKED',
  HANDED_TO_ELCHI = 'HANDED_TO_ELCHI',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  REMITTED = 'REMITTED',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
  SETTLED = 'SETTLED',
  REFUSED = 'REFUSED',
  RETURNING = 'RETURNING',
  RETURNED_GRADED = 'RETURNED_GRADED',
  CANCELLED = 'CANCELLED',
}

/** order.status.changed — buyurtma holati o'zgardi (TZ T5). */
export interface OrderStatusChangedEvent {
  eventId: string;
  /** checkout dagi lid buyurtmasi ID si (BE-18). */
  orderId: string;
  /** Odamga ko'rinadigan buyurtma raqami (masalan, L-1183). */
  orderNumber: string;
  /** Liddan yaratilgan buyurtmada; boshqa buyurtmada null. */
  leadId: string | null;
  /**
   * Manba — BE-25 `LeadSource` qiymatlari (`lead.dto.ts`): LANDING (sotuvchi
   * sahifasi), SITE (asosiy sayt), API (sotuvchi lid API si). BE-25 merge
   * qilingach `LeadSource` turiga o'tadi.
   */
  source: 'LANDING' | 'SITE' | 'API';
  streamId: string | null;
  affiliateId: string | null;
  wholesalerId: string | null;
  status: LeadOrderStatus;
  previousStatus: LeadOrderStatus | null;
  /** Qabul qiluvchi — operator tasdiqlagan ma'lumot (BE-38). */
  recipient: {
    name: string;
    /** +998XXXXXXXXX */
    phone: string;
    /** SOATO (EQ-06, 2026-11-16) */
    regionSoato: string;
    districtSoato: string;
    /** ko'cha/uy */
    addressLine: string;
    whereDeliver: CheckoutDeliveryDestination;
  };
  items: Array<{
    productId: string;
    sku: string | null;
    name: string;
    quantity: number;
    /** Bir dona og'irligi, gramm (butun); noma'lum bo'lsa null. */
    weightGrams: number | null;
    /** Narxlar nusxasi, bir dona, butun so'm (BE-01): ustama = sotuv − tasdiqlangan. */
    approvedPrice: number;
    basePrice: number;
    salePrice: number;
  }>;
  /** Yetkazish rejimi va summasi (TZ T3 sales_order: delivery_mode, delivery_cost). */
  delivery: { mode: string; cost: number };
  /** Kuryer mijozdan oladigan summa, butun so'm (BE-01). */
  codAmount: number;
  /**
   * Elchi posilkasi (BE-19 `elchi.parcel.created` dan yozadi); posilka
   * yaratilguncha null. BE-24 kuzatuv SMS i uchun.
   */
  parcel: { shipmentId: string; trackingUrl: string | null } | null;
  /** ISO 8601 */
  occurredAt: string;
}

/** elchi.parcel.created — posilka yaratildi (BE-20 → BE-19). */
export interface ElchiParcelCreatedEvent {
  eventId: string;
  orderId: string;
  shipmentId: string;
  qrCodeToken: string | null;
  trackingUrl: string | null;
  /** Elchi `to_be_paid`, butun so'm. */
  toBePaid: number | null;
  /** ISO 8601 */
  createdAt: string;
}

/** elchi.parcel.failed — posilka yaratilmadi, qo'lda ko'rish kerak. */
export interface ElchiParcelFailedEvent {
  eventId: string;
  orderId: string;
  reason: 'DISTRICT_NOT_FOUND' | 'ELCHI_REJECTED' | 'INVALID_EVENT';
  message: string;
  /** ISO 8601 */
  at: string;
}

/** elchi.parcel.cancelled / elchi.parcel.cancel-failed — bekor qilish natijasi. */
export interface ElchiParcelCancelResultEvent {
  eventId: string;
  orderId: string;
  shipmentId: string | null;
  /** cancel-failed da Elchi javobi. */
  message: string | null;
  /** ISO 8601 */
  at: string;
}
