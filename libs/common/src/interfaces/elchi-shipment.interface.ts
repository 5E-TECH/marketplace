/**
 * `integration.shipment.create` / `integration.shipment.get` RPC javobi (C1.45).
 *
 * NEGA UMUMIY TIP: avval har chaqiruvchi javob tipini o'zi inline yozardi va
 * `confirm-sales-order.service.ts` da `qr_code_token` tipga kirmay qolgan edi —
 * Elchi tokenni qaytarsa ham xaridor oqimi uni jimgina tashlab yuborardi va
 * prodda yorliqlar 409 berardi. Endi ikkala yo'l shu tipni ishlatadi.
 */
export interface ElchiShipmentResult {
  shipment_id: string;
  tracking_url?: string;
  /** Pochta skaneri posilkani shu token bo'yicha topadi; yorliq QR'i ichida. */
  qr_code_token?: string;
  /** Kuryer qabul qiluvchidan oladigan summa (Elchi `to_be_paid`). */
  to_be_paid?: number;
}
