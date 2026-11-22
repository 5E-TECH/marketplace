import { CheckoutDeliveryDestination } from './cart.dto';
import { LeadSource } from './lead.dto';

// Lid-sotuv RabbitMQ hodisalari (BE-25 TC4: maydonlar, yuboruvchi va qabul qiluvchi).
// Qoidalar (T02:122): hodisa o‘z tranzaksiyasidagi outbox orqali yuboriladi; qabul qiluvchi
// `eventId` bo‘yicha takrorni tashlab yuboradi. RMQ nuqtadan-nuqtaga: har qabul qiluvchiga alohida emit.
// Buyurtma tomonidagi hodisalar (order.status.changed) — checkout shartnomasi, Dilshod (BE-18).

export const LEAD_EVENTS = {
  /** lead-service → checkout-service. Buyurtma liddan yaratiladi (BE-13 → BE-18). */
  CONFIRMED: 'lead.confirmed',
  /** checkout-service → lead-service. Tovar band qilinmadi; lid yo‘qolmaydi (BE-18 → BE-13). */
  ORDER_CREATE_FAILED: 'order.create-failed',
  /** lead-service ichida: rejalashtirilgan qo‘ng‘iroqqa 5 daqiqa qoldi (8-qoida) [taklif]. */
  CALLBACK_REMINDER: 'lead.callback.reminder',
  /** lead-service → finance-service: sotuvchi haqi tekshiruvgacha ushlab turiladi (BE-35, TZ 7). */
  FRAUD_FEE_HOLD: 'fraud.fee.hold',
  /** lead-service → finance-service: ushlab turilgan haq qo‘yib yuboriladi (BE-35). */
  FRAUD_FEE_RELEASE: 'fraud.fee.release',
  /** lead-service → finance-service: sotuvchi bloklandi — ushlab turilgan haq bekor qilinadi (TZ 7, 3-qadam). */
  FRAUD_FEE_CANCEL: 'fraud.fee.cancel',
  /** lead-service → notification-service: sotuvchiga chora (ogohlantirish, sahifa to‘xtatildi) [taklif]. */
  FRAUD_MEASURE: 'fraud.measure.applied',
  /** lead-service → notification-service: saytdan buyurtmani SMS havola bilan tasdiqlash (BE-34). */
  SITE_CONFIRM_SMS: 'lead.site.confirm-sms',
} as const;

/** BE-34: lidni kim tasdiqladi — operator qo‘ng‘iroqda yoki mijoz SMS havola orqali (faqat asosiy sayt lidi). */
export enum LeadConfirmedVia {
  OPERATOR = 'OPERATOR',
  SMS = 'SMS',
}

/** BE-34: saytdan ko‘p tovarli lidning bitta qatori; narx — saytdagi (tasdiqlangan) narx, bir dona, so‘m. */
export interface LeadOrderItemEvent {
  productId: string;
  quantity: number;
  salePrice: number;
}

/** lead.site.confirm-sms — mijozga SMS: summa, tovarlar, manzil va bir martalik tasdiq havolasi (BE-34). */
export interface SiteConfirmSmsEvent {
  eventId: string;
  leadId: string;
  /** +998XXXXXXXXX */
  phone: string;
  /** Tayyor matn (lead-service yozadi: summa, tovarlar, manzil, havola). */
  text: string;
  /** ISO 8601 — havola shu vaqtgacha amal qiladi. */
  expiresAt: string;
}

/** fraud.fee.* — lid bo‘yicha (moliya jurnalida `lead_id` bor). CANCEL da `leadIds` — sotuvchining ushlangan hamma lidi. */
export interface FraudFeeEvent {
  eventId: string;
  incidentId: string | null;
  affiliateId: string;
  leadIds: string[];
  reason: string;
  at: string;
}

/** fraud.measure.applied — sotuvchiga xabar uchun (6.12; matn notification-service da). */
export interface FraudMeasureEvent {
  eventId: string;
  incidentId: string | null;
  affiliateId: string;
  streamId: string | null;
  action: string;
  reason: string;
  at: string;
}

/** lead.confirmed — operator manzil tasdiqlagan liddan buyurtma yaratish uchun hamma ma’lumot. */
export interface LeadConfirmedEvent {
  eventId: string;
  leadId: string;
  source: LeadSource;
  streamId: string | null;
  affiliateId: string | null;
  productId: string;
  quantity: number;
  /** Mijozga aytilgan tovar narxi, so‘m (sahifadagi narx). */
  salePrice: number;
  customerName: string;
  /** +998XXXXXXXXX */
  customerPhone: string;
  /** SOATO (EQ-06). Elchi ID ga moslash — BE-20. */
  regionSoato: string;
  districtSoato: string;
  /** Buyurtmada `delivery_address` bo‘ladi (faqat ko‘cha/uy, telefonsiz). */
  addressLine: string;
  whereDeliver: CheckoutDeliveryDestination;
  /** «Tasdiqlandi» ni yozgan operator; mijoz SMS havola bilan tasdiqlasa — null (BE-34). */
  confirmedBy: string | null;
  /** BE-34: yo‘q bo‘lsa — OPERATOR. */
  confirmedVia?: LeadConfirmedVia;
  /**
   * BE-34: saytdan ko‘p tovarli lid — hamma qatorlar; birinchisi `productId`/`quantity`/`salePrice` bilan bir xil.
   * Yo‘q bo‘lsa — bitta tovar (eski shakl).
   */
  items?: LeadOrderItemEvent[];
  /** Manzilni tasdiqlagan operator (BE-38); odatda shu operator. */
  addressConfirmedBy: string | null;
  /** ISO 8601 */
  confirmedAt: string;
}

export enum OrderCreateFailedReason {
  /** Tovar band qilinmadi: qoldiq yo‘q yoki oxirgi dona boshqa buyurtmaga ketdi (TC9). */
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  /** Offer sotuvdan olingan yoki narxi tasdiqlanmagan (BE-18) [taklif]. */
  OFFER_UNAVAILABLE = 'OFFER_UNAVAILABLE',
  /** Sahifa narxi tasdiqlangan narxdan past — lid kelgandan keyin narx oshgan (BE-18) [taklif]. */
  PRICE_CHANGED = 'PRICE_CHANGED',
  /** Hodisa ma’lumoti to‘liq emas yoki noto‘g‘ri (BE-18) [taklif]. */
  INVALID_ORDER = 'INVALID_ORDER',
}

/** order.create-failed — lid «qoldiq yo‘q» belgisi bilan navbatga qaytadi (BE-13 TC8). */
export interface OrderCreateFailedEvent {
  eventId: string;
  leadId: string;
  reason: OrderCreateFailedReason;
  /** ISO 8601 */
  at: string;
}
