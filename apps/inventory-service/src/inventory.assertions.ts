import { BusinessException } from '@app/common';
import { ReserveItem, StockTarget } from './inventory.types';

/**
 * Sof (holatsiz) validatsiya yordamchilari — DB'ga tegmaydi. InventoryService
 * shu funksiyalarni chaqiradi (kirish tekshiruvi bir joyda, qayta ishlatiladi).
 */

export function assertId(value: string, field: string): void {
  if (!/^[1-9]\d*$/.test(value)) {
    throw BusinessException.invalidState(`${field} noto‘g‘ri`);
  }
}

export function assertIdempotencyKey(key: string): void {
  if (!key?.trim() || key.length > 230) {
    throw BusinessException.invalidState('Idempotency key noto‘g‘ri');
  }
}

export function assertPositive(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw BusinessException.invalidState(
      'Miqdor musbat butun son bo‘lishi kerak',
    );
  }
}

export function assertReason(reason: string): void {
  if (!reason?.trim()) {
    throw BusinessException.invalidState('Sabab majburiy');
  }
}

export function assertStockTarget(target: StockTarget): void {
  assertId(target.variantId, 'variantId');
  assertId(target.warehouseId, 'warehouseId');
}

export function assertUniqueItems(items: ReserveItem[]): void {
  const keys = new Set<string>();
  for (const item of items) {
    assertStockTarget(item);
    const key = `${item.variantId}:${item.warehouseId}`;
    if (keys.has(key)) {
      throw BusinessException.conflict(
        'Bir variant va ombor rezervatsiyada takrorlangan',
      );
    }
    keys.add(key);
  }
}

export function sortedItems<T extends StockTarget>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    `${a.warehouseId}:${a.variantId}`.localeCompare(
      `${b.warehouseId}:${b.variantId}`,
      'en',
      { numeric: true },
    ),
  );
}
