import { StockMovementType } from '@app/common';

export interface StockTarget {
  variantId: string;
  warehouseId: string;
}

export interface ReserveItem extends StockTarget {
  quantity: number;
}

export interface ReserveInput {
  orderRef: string;
  items: ReserveItem[];
  ttlMs?: number;
  idempotencyKey: string;
}

export interface ReservationActionInput {
  orderRef: string;
  idempotencyKey: string;
  reason?: string;
  actorId?: string;
}

export interface StockIncreaseInput extends StockTarget {
  quantity: number;
  idempotencyKey: string;
  reason: string;
  actorId?: string;
}

export interface StockAdjustInput extends StockTarget {
  quantityDelta: number;
  /** BE-17: hisobdan chiqariladigan partiya (muddati o‘tgan tovar). */
  lotId?: string;
  /** BE-17: yaxshi tovar hisobdan chiqariladi (sotuvdan chiqqan partiyaga tegilmaydi). */
  goodStock?: boolean;
  idempotencyKey: string;
  reason: string;
  actorId: string;
}

export interface ReturnOrderItemsInput {
  orderRef: string;
  items: Array<{ variantId: string; quantity: number }>;
  idempotencyKey: string;
  reason: string;
}

export interface InventoryResult {
  operation: StockMovementType;
  orderRef?: string;
  reservationId?: string;
  stockId?: string;
  onHand?: number;
  reserved?: number;
}
