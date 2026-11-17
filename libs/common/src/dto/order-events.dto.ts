import { CheckoutDeliveryDestination } from './cart.dto';

/**
 * Buyurtma hodisalari (BE-20) [taklif]: `order.status.changed` ni checkout
 * yuboradi (BE-18, Dilshod), `elchi.parcel.created` ni elchi-integration
 * (BE-20) checkout ga qaytaradi (BE-19 yozadi). TZ T5 «Hodisalar» jadvali
 * (02-texnik-qism.md:112). Qoidalar: outbox orqali; qabul qiluvchi `eventId`
 * bo'yicha takrorni tashlab yuboradi (`processOnce`).
 *
 * BE-18 merge qilinguncha bu shakl — BE-20 dagi namuna. Maydon faqat
 * qo'shiladi (orqaga mos).
 */
export const ORDER_EVENTS = {
  /** checkout → lead, notification, elchi-integration. */
  STATUS_CHANGED: 'order.status.changed',
  /** elchi-integration → checkout: posilka yaratildi. */
  PARCEL_CREATED: 'elchi.parcel.created',
  /** elchi-integration → checkout: posilka yaratilmadi, qo'lda ko'rish kerak. */
  PARCEL_FAILED: 'elchi.parcel.failed',
} as const;

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
  orderId: string;
  /** Liddan yaratilgan buyurtmada; boshqa buyurtmada null. */
  leadId: string | null;
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
    name: string;
    quantity: number;
    /** Bir dona og'irligi, gramm; noma'lum bo'lsa null. */
    weightGrams: number | null;
  }>;
  /** Kuryer mijozdan oladigan summa, butun so'm (BE-01). */
  codAmount: number;
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
  reason: 'DISTRICT_NOT_FOUND' | 'ELCHI_REJECTED';
  message: string;
  /** ISO 8601 */
  at: string;
}
