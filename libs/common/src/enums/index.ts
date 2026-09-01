// Barcha domen enum'lari — MARKETPLACE_PLAN.md §6 bilan mos.

export enum Role {
  SELLER = 'SELLER',
  OPERATOR = 'OPERATOR',
  BUYER = 'BUYER',
  ADMIN = 'ADMIN',
  SUPERADMIN = 'SUPERADMIN',
}

export enum ShopStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

export enum ProductStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
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
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
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
