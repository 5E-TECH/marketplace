// Barcha domen enum'lari — MARKETPLACE_PLAN.md §6 bilan mos.

/**
 * TZ 3-bo‘lim: sakkizta rol (BE-05). Sotuvchi va optovik — tashqi foydalanuvchilar, qolganlari — platforma xodimlari.
 * Mijoz tizim foydalanuvchisi emas: uning ma’lumoti lid va buyurtmada (T01:140).
 */
export enum Role {
  /** Sotuvchi: oqim yaratadi, reklama qiladi, sotuvdan haq oladi. Ochiq ro‘yxat faqat shu rol uchun. */
  AFFILIATE = 'AFFILIATE',
  /** Optovik: tovar topshiradi; ro‘yxatini admin kiritadi (BE-07). */
  WHOLESALER = 'WHOLESALER',
  /** Operator: lidga qo‘ng‘iroq qiladi, buyurtmani rasmiylashtiradi. */
  OPERATOR_LEAD = 'OPERATOR_LEAD',
  /** Nazoratchi (katta operator): navbat, o‘tkazish, qizil ro‘yxat. */
  SUPERVISOR = 'SUPERVISOR',
  /** Omborchi: qabul, yig‘ish, qadoq, qaytganni saralash. */
  WAREHOUSE = 'WAREHOUSE',
  /** Moliya: sverka, to‘lovlarni tasdiqlash. */
  FINANCE = 'FINANCE',
  ADMIN = 'ADMIN',
  SUPERADMIN = 'SUPERADMIN',
}

/** Platforma xodimlari: ularni SUPERADMIN jamoa bo‘limida yaratadi (BE-05). */
export const STAFF_ROLES: readonly Role[] = [
  Role.OPERATOR_LEAD,
  Role.SUPERVISOR,
  Role.WAREHOUSE,
  Role.FINANCE,
  Role.ADMIN,
  Role.SUPERADMIN,
];

/**
 * Eski do‘kon rollari (BE-05 da bekor qilindi). Faqat BE-29 da o‘chiriladigan eski yo‘llarning `@Roles` ida qoldi:
 * bazadagi `chk_identity_users_role` ularni qabul qilmaydi, shuning uchun bu yo‘llar hech kimga ochilmaydi
 * (tokensiz 401, har qanday yangi rol bilan 403).
 */
export enum LegacyRole {
  SELLER = 'SELLER',
  OPERATOR = 'OPERATOR',
  BUYER = 'BUYER',
}

export enum ShopStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export enum ProductStatus {
  DRAFT = 'DRAFT',
  /** BE-07 (OPT-2, ADM-1): yangi mahsulot admin tasdig‘igacha sotuvga chiqmaydi. */
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  /** BE-07: admin rad etdi (sababi `moderationNote` da). */
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

/** BE-07 (OPT-1): optovik — yuridik shaxs yoki yakka tartibdagi tadbirkor (YaTT). */
export enum WholesalerLegalType {
  LEGAL_ENTITY = 'LEGAL_ENTITY',
  SOLE_PROPRIETOR = 'SOLE_PROPRIETOR',
}

export enum WarehouseOwnerType {
  SHOP = 'SHOP',
  HQ = 'HQ',
}

export enum StockMovementType {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  RESERVE = 'RESERVE',
  RELEASE = 'RELEASE',
  COMMIT = 'COMMIT',
  ADJUST = 'ADJUST',
  TRANSFER = 'TRANSFER',
  /** BE-16: mijoz qaytargan / yetkazilmay qaytgan tovar omborga. */
  RETURN = 'RETURN',
  /** BE-16: brak (qabulda yoki qaytganni saralashda). */
  DEFECT = 'DEFECT',
  /** BE-16: hisobdan chiqarish. */
  WRITE_OFF = 'WRITE_OFF',
  /** BE-16: optovikka qaytarish. */
  RETURN_TO_SUPPLIER = 'RETURN_TO_SUPPLIER',
}

export enum ReservationStatus {
  HELD = 'HELD',
  COMMITTED = 'COMMITTED',
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
}

export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  CONFIRMED = 'CONFIRMED',
  PARTIALLY_FULFILLED = 'PARTIALLY_FULFILLED',
  FULFILLED = 'FULFILLED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum SalesOrderSellerStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  SHIPMENT_CREATED = 'SHIPMENT_CREATED',
  RECEIVED = 'RECEIVED',
  ON_THE_ROAD = 'ON_THE_ROAD',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
}

export enum PaymentMethod {
  COD = 'COD',
  PAYME = 'PAYME',
  CLICK = 'CLICK',
}

export enum PaymentProvider {
  PAYME = 'PAYME',
  CLICK = 'CLICK',
}

export enum PaymentStatus {
  /** @deprecated Faqat eski qatorlarda; tashqi javobda PENDING bo'lib chiqadi. */
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/** Tashqi kontraktda ko'rinadigan to'lov holatlari (CREATED chiqarilmaydi). */
export const PUBLIC_PAYMENT_STATUSES = [
  PaymentStatus.PENDING,
  PaymentStatus.PAID,
  PaymentStatus.CANCELLED,
  PaymentStatus.FAILED,
  PaymentStatus.REFUNDED,
] as const;

/**
 * Yangi to'lov darhol PENDING bo'ladi, lekin bazada avvalgi kod yozgan
 * CREATED qatorlar qolgan. Mijoz ikkala holatni ham farqlay olmasligi uchun
 * tashqariga chiqishda bittaga keltiriladi.
 */
export function publicPaymentStatus(status: PaymentStatus): PaymentStatus {
  return status === PaymentStatus.CREATED ? PaymentStatus.PENDING : status;
}

export enum CommissionType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

export enum FinanceLedgerEntryType {
  SALE = 'SALE',
  COD_SALE = 'COD_SALE',
  COD_SETTLEMENT = 'COD_SETTLEMENT',
  COMMISSION = 'COMMISSION',
  PAYOUT = 'PAYOUT',
  REFUND = 'REFUND',
  ADJUST = 'ADJUST',
}

export enum FinancePayoutStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  HELD = 'HELD',
  PAID = 'PAID',
}

/** Sotuvchiga pul o'tkazish chastotasi — do'kon o'zi tanlaydi. */
export enum PayoutScheduleFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

/** C4.2 — xaridorning qaytarish so'rovi holatlari (har o'tish tarixga yoziladi). */
export enum ReturnRequestStatus {
  SUBMITTED = 'SUBMITTED',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  REFUNDED = 'REFUNDED',
}

/** C4.2 — qaytarish sababi (Uzum uslubida: sifat muammosi yoki xaridor qarori). */
export enum ReturnReason {
  DEFECTIVE = 'DEFECTIVE',
  DAMAGED = 'DAMAGED',
  INCOMPLETE = 'INCOMPLETE',
  WRONG_ITEM = 'WRONG_ITEM',
  NOT_AS_DESCRIBED = 'NOT_AS_DESCRIBED',
  CHANGED_MIND = 'CHANGED_MIND',
  OTHER = 'OTHER',
}

/**
 * Sotuvchi aybi bilan qaytgan tovar (brak, shikast, to'liq emas, boshqa tovar)
 * qayta sotuvga chiqmaydi — sotuvchiga qaytariladi. Qolgan sabablarda tovar
 * refund paytida omborga qayta qo'shiladi (admin buni o'zgartira oladi).
 */
export const QUALITY_RETURN_REASONS: readonly ReturnReason[] = [
  ReturnReason.DEFECTIVE,
  ReturnReason.DAMAGED,
  ReturnReason.INCOMPLETE,
  ReturnReason.WRONG_ITEM,
];
