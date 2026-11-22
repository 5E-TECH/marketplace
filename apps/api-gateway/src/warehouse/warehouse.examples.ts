import {
  FulfillmentTaskStatus,
  HandoverActView,
  LeadOrderStatus,
  ParcelElchiState,
  PickListPage,
  WarehouseReturnView,
} from '@app/common';

/**
 * BE-25 (TC3): `warehouse/*` javob misollari (OpenAPI, faqat `data` qismi — gateway `{statusCode, message, data}`
 * qobig‘iga o‘raydi). Shakl checkout `FulfillmentService` va `WarehouseReturnsService` javobi bilan bir xil — turi
 * `@app/common` interfeysidan tekshiriladi. Buyurtma raqami — `L-<id>`.
 */

/** `checkout.warehouse.pick-list`: bugungi vazifa va kechagi kundan qolgan (kechikkan) qadoqlangan posilka. */
export const PICK_LIST_EXAMPLE: PickListPage = {
  date: '2026-12-08',
  items: [
    {
      taskId: '305',
      orderId: '1281',
      orderNumber: 'L-1281',
      status: FulfillmentTaskStatus.PACKED,
      pickDate: '2026-12-07',
      overdue: true,
      productName: 'Kollagen kukuni, 300 g',
      sku: 'KOL-300',
      barcode: null,
      quantity: 1,
      pickedQty: 1,
      parcel: {
        elchiState: ParcelElchiState.FAILED,
        shipmentId: null,
        labelReady: false,
        // checkout `ElchiParcelEventsService.onFailed`: «sabab: xabar»
        error:
          'DISTRICT_NOT_FOUND: Tuman topilmadi: SOATO 1726266 (viloyat 1726)',
      },
    },
    {
      taskId: '311',
      orderId: '1290',
      orderNumber: 'L-1290',
      status: FulfillmentTaskStatus.TO_PICK,
      pickDate: '2026-12-08',
      overdue: false,
      productName: 'Vitamin D3 2000 IU, 60 kapsula',
      sku: 'VIT-D3-60',
      barcode: '4780012345678',
      quantity: 2,
      pickedQty: 0,
      parcel: {
        elchiState: ParcelElchiState.CREATED,
        shipmentId: '987',
        labelReady: true,
        error: null,
      },
    },
  ],
  counts: { toPick: 1, picked: 0, packed: 1, overdue: 1 },
  truncated: false,
};

/** `checkout.warehouse.scan`: 2 donadan birinchisi skanerlandi (hamma dona bo‘lsa — `PICKED`). */
export const SCAN_EXAMPLE = {
  taskId: '311',
  orderId: '1290',
  status: FulfillmentTaskStatus.TO_PICK,
  pickedQty: 1,
  quantity: 2,
};

/** `checkout.warehouse.pack`. */
export const PACK_EXAMPLE = {
  taskId: '311',
  orderId: '1290',
  status: FulfillmentTaskStatus.PACKED,
};

/** `checkout.warehouse.handover` / `act-get`: `createdAt` — Toshkent vaqti, «YYYY-MM-DD HH:MI». */
export const HANDOVER_ACT_EXAMPLE: HandoverActView = {
  id: '27',
  parcelCount: 1,
  createdBy: '5',
  createdAt: '2026-12-08 16:20',
  items: [
    {
      parcelId: '1196',
      orderId: '1290',
      shipmentId: '987',
      qrCodeToken: '3e3a70f78d54064348bde43a',
      orderNumber: 'L-1290',
    },
  ],
};

/** `checkout.warehouse.returns`: «Qaytmoqda» holatidagi lid posilkalari (eng eskisi birinchi, 200 tagacha). */
export const RETURNS_EXAMPLE: WarehouseReturnView[] = [
  {
    orderId: '1284',
    status: LeadOrderStatus.RETURNING,
    parcelId: '1190',
    shipmentId: '975',
    trackingUrl: 'https://elchi.uz/track/975',
    updatedAt: new Date('2026-12-07T13:05:00.000Z'),
    items: [
      {
        variantId: '901',
        productName: 'Vitamin D3 2000 IU, 60 kapsula',
        sku: 'VIT-D3-60',
        barcode: '4780012345678',
        quantity: 2,
      },
    ],
  },
];
