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
} as const;

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
  confirmedBy: string;
  /** ISO 8601 */
  confirmedAt: string;
}

export enum OrderCreateFailedReason {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

/** order.create-failed — lid «qoldiq yo‘q» belgisi bilan navbatga qaytadi (BE-13 TC8). */
export interface OrderCreateFailedEvent {
  eventId: string;
  leadId: string;
  reason: OrderCreateFailedReason;
  /** ISO 8601 */
  at: string;
}
