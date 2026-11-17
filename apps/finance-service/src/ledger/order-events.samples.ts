import {
  CheckoutDeliveryDestination,
  LeadOrderStatus,
  OrderStatusChangedEvent,
} from '@app/common';

/**
 * BE-22 test namunalari (BE-25 da `order.status.changed` namunasi yo'q).
 * Raqamlar TZ 01:63-71 (251 000 = 140 000 + 65 000 + 12 000 + 34 000) va
 * 2.5-1 (sotuv 276 000) dan.
 */
export function orderEvent(
  overrides: Partial<OrderStatusChangedEvent> = {},
  item: Partial<OrderStatusChangedEvent['items'][number]> = {},
): OrderStatusChangedEvent {
  return {
    eventId: 'evt-delivered-501',
    orderId: '501',
    orderNumber: 'L-1183',
    leadId: '9001',
    source: 'LANDING',
    streamId: '31',
    affiliateId: 'A',
    wholesalerId: 'W',
    status: LeadOrderStatus.DELIVERED,
    previousStatus: LeadOrderStatus.IN_TRANSIT,
    recipient: {
      name: 'Dilnoza Karimova',
      phone: '+998901234567',
      regionSoato: '1726',
      districtSoato: '1726264',
      addressLine: 'Navoiy ko‘chasi 12-uy',
      whereDeliver: CheckoutDeliveryDestination.ADDRESS,
    },
    items: [
      {
        productId: '88',
        sku: 'EAR-01',
        name: 'Simsiz quloqchin',
        quantity: 1,
        weightGrams: 350,
        approvedPrice: 251000,
        basePrice: 140000,
        salePrice: 251000,
        split: { affiliateFee: 65000, callCenterFee: 12000, hiddenDelivery: 0 },
        ...item,
      },
    ],
    delivery: { mode: 'SEPARATE', cost: 40000 },
    codAmount: 291000,
    parcel: { shipmentId: '1251131', trackingUrl: null },
    occurredAt: '2026-12-20T10:00:00.000Z',
    ...overrides,
  };
}
