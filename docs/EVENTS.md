# Lid-sotuv hodisalari (RabbitMQ)

BE-25, TC4. Lid-sotuv modelidagi RabbitMQ hodisalari: nomi, qachon yuboriladi, maydonlari, kim yuboradi va kim qabul
qiladi. Hamma ma’lumot `dev` dagi koddan olingan (2026-11-23, `211f6c4`; PR 127–149 `dev` da). Yo‘llar repo ildizidan.

Bu yerda faqat **hodisalar** bor: yuboruvchi `emit` qiladi, qabul qiluvchida `@EventPattern` turadi, javob kutilmaydi.
So‘rov-javob chaqiriqlari (`send` → `@MessagePattern`, masalan `catalog.pricing.*`, `checkout.warehouse.*`) hodisa
emas va bu ro‘yxatga kirmaydi. Outbox orqali ketadigan ombor buyruqlari ham so‘rov — ular alohida bo‘limda.

## Qisqa ro‘yxat

| Hodisa | Konstanta | Yuboruvchi | Qabul qiluvchi |
|---|---|---|---|
| `lead.confirmed` | `LEAD_EVENTS.CONFIRMED` | lead-service (outbox) | checkout-service |
| `order.create-failed` | `LEAD_EVENTS.ORDER_CREATE_FAILED` | checkout-service (outbox) | lead-service |
| `order.status.changed` | `ORDER_EVENTS.STATUS_CHANGED` | checkout-service (outbox) | finance-service, lead-service, elchi-integration, notification-service |
| `elchi.parcel.created` | `ORDER_EVENTS.PARCEL_CREATED` | elchi-integration (outbox) | checkout-service |
| `elchi.parcel.failed` | `ORDER_EVENTS.PARCEL_FAILED` | elchi-integration (outbox) | checkout-service |
| `elchi.parcel.cancelled` | `ORDER_EVENTS.PARCEL_CANCELLED` | elchi-integration (outbox) | checkout-service |
| `elchi.parcel.cancel-failed` | `ORDER_EVENTS.PARCEL_CANCEL_FAILED` | elchi-integration (outbox) | checkout-service |
| `fraud.fee.hold` | `LEAD_EVENTS.FRAUD_FEE_HOLD` | lead-service (outbox) | finance-service |
| `fraud.fee.release` | `LEAD_EVENTS.FRAUD_FEE_RELEASE` | lead-service (outbox) | finance-service |
| `fraud.fee.cancel` | `LEAD_EVENTS.FRAUD_FEE_CANCEL` | lead-service (outbox) | finance-service |
| `fraud.measure.applied` | `LEAD_EVENTS.FRAUD_MEASURE` | lead-service (outbox) | notification navbati — handler yo‘q |
| `lead.callback.reminder` | `LEAD_EVENTS.CALLBACK_REMINDER` | lead-service (outbox) | notification navbati — handler yo‘q |
| `order.returned` | `ORDER_EVENTS.RETURNED` | checkout-service (outbox, BE-44) | finance-service |
| `finance.cod.settled` | — (satr) | 1-versiya: checkout (eski marketplace); 2-versiya: checkout `ElchiLeadWebhookService` (outbox, BE-21) | finance-service |
| `inventory.lot.blocked` | `LOT_BLOCKED_EVENT` | inventory-service (to‘g‘ridan-to‘g‘ri) | notification-service |
| `price.decision.orange` | — (satr) | catalog-service (to‘g‘ridan-to‘g‘ri) | notification-service |
| `elchi.status.conflict` | `ELCHI_STATUS_CONFLICT_EVENT` | checkout-service (to‘g‘ridan-to‘g‘ri, BE-21) | notification-service |
| `finance.cod.reconciliation.mismatch` | `COD_RECONCILIATION_MISMATCH_EVENT` | finance-service (to‘g‘ridan-to‘g‘ri, BE-21) | notification-service |
| `inventory.inbound.received` | `INBOUND_RECEIVED_EVENT` | inventory-service (outbox, BE-47) | notification-service |
| `inventory.offer.out-of-stock` | `STOCK_DEPLETED_EVENT` | inventory-service (outbox, BE-47) | notification-service |
| `finance.withdrawal.paid` | `WITHDRAWAL_PAID_EVENT` | api-gateway (to‘g‘ridan-to‘g‘ri, BE-24) | notification-service |
| `finance.wholesaler.paid` | `SETTLEMENT_PAID_EVENT` | api-gateway (to‘g‘ridan-to‘g‘ri, BE-47) | notification-service |
| `lead.site.confirm-sms` | `LEAD_EVENTS.SITE_CONFIRM_SMS` | lead-service (outbox, BE-34) | notification-service |
| `auth.verification-code.requested` | — (satr) | identity-service (to‘g‘ridan-to‘g‘ri, BE-06) | notification-service |

Konstantalar: `LEAD_EVENTS` — `libs/common/src/dto/lead-events.dto.ts`, `ORDER_EVENTS` —
`libs/common/src/dto/order-events.dto.ts`, `LOT_BLOCKED_EVENT` — `libs/common/src/dto/warehouse-inbound.dto.ts`.

## Yetkazish qoidalari

### Navbatlar

Har servis o‘z navbatini tinglaydi (`RmqQueue`, `libs/common/src/messaging/rmq.util.ts`). Hodisa kerakli navbatga
alohida yuboriladi: bitta hodisa uch servisga kerak bo‘lsa, uch marta `emit` qilinadi.

| Servis | Navbat |
|---|---|
| checkout-service | `checkout_queue_v2` |
| lead-service | `lead_queue_v2` |
| finance-service | `finance_queue_v2` |
| elchi-integration | `integration_queue_v2` |
| notification-service | `notification_queue_v2` |
| inventory-service | `inventory_queue_v2` |
| catalog-service | `catalog_queue_v2` |

`_v2` qo‘shimchasi BE-02 da paydo bo‘lgan: mavjud navbatga dead-letter argumentini qo‘shib bo‘lmaydi, shuning uchun
navbatlar yangi nom bilan ochilgan. Eski navbatdagi xabarlar `npm run ops:rmq-migrate-v2` bilan ko‘chiriladi
(`scripts/rmq-migrate-v2.mjs`).

### Outbox

Hodisa biznes o‘zgarishi bilan bitta tranzaksiyada `outbox_event` jadvaliga yoziladi (`OutboxService.record`,
`libs/common/src/outbox/outbox.service.ts`). Relay uni commitdan keyin RabbitMQ ga yuboradi. Kafolat — kamida bir
marta: hodisa takror kelishi mumkin.

| Relay | Qachon ishlaydi | Qaysi hodisa → qaysi navbat |
|---|---|---|
| checkout `CheckoutOutboxRelayService` (`apps/checkout-service/src/checkout-outbox-relay.service.ts`) | har 10 s, doim | `finance.*` → finance; `order.status.changed` → finance, lead, integration (ketma-ket); `order.create-failed` → lead; boshqa nom — `FAILED` |
| lead `LeadOutboxRelayService` (`apps/lead-service/src/lead-outbox-relay.service.ts`) | har 10 s, faqat `LEAD_OUTBOX_RELAY=on` | `lead.confirmed` → checkout; `lead.callback.reminder`, `fraud.measure.applied`, `lead.site.confirm-sms` → notification; `fraud.fee.*` → finance |
| inventory `InventoryOutboxRelayService` (`apps/inventory-service/src/inventory-outbox-relay.service.ts`) | har 10 s, doim | `inventory.inbound.received`, `inventory.offer.out-of-stock` → notification; boshqalari → catalog |
| elchi `ElchiOutboxRelayService` (`apps/elchi-integration/src/elchi-outbox-relay.service.ts`) | har 10 s, faqat `ELCHI_OUTBOX_RELAY=on` | `elchi.parcel.*` → checkout; boshqa nom — `FAILED` |

- checkout va elchi relaylari `OutboxService.relayPending` dan foydalanadi: bitta agregat hodisalari tartib bilan
  ketadi (oldingisi `PENDING` bo‘lsa keyingisi kutadi), `emit` 5 s da tugamasa qayta urinish.
- lead relay o‘z so‘rovi bilan ishlaydi: `id` tartibida 20 tadan, agregat tartibisiz, `FAILED` holati yo‘q.
- `order.status.changed` qabul qiluvchilardan biriga yetmasa, hodisa keyingi safar hammasiga qayta yuboriladi.
- `LEAD_OUTBOX_RELAY` `.env.example` va `.env.production.example` da bo‘sh, `ELCHI_OUTBOX_RELAY` u yerda yo‘q. Ikkalasi
  ham sukutda o‘chiq: yoqilmaguncha lid va posilka hodisalari `PENDING` da qoladi.

Qabul qiluvchi takrorni `eventId` bo‘yicha tashlaydi. Ko‘p handler `processOnce` dan foydalanadi
(`libs/common/src/outbox/processed-event.ts`): `<sxema>.processed_event` jadvaliga `(consumer, event_id)` handler
bilan bitta tranzaksiyada yoziladi. Ba’zilari holat bo‘yicha takrorga chidamli — har hodisada yozilgan.

### Qabul qilish: `ReliableRmqServer`

Hamma servis `rmqServer(...)` orqali `ReliableRmqServer` ni ishga tushiradi
(`libs/common/src/messaging/reliable-rmq.server.ts`).

- **Tasdiq (ack) handler muvaffaqiyatli tugagandan keyin.** Server `noAck: false` bilan ishlaydi.
- **Xatoda qayta urinish.** Xabar nusxasi `<navbat>.retry` ga yoziladi va urinish soni `x-elchi-attempt` sarlavhasida
  oshadi. Retry navbatining TTL i 10 s (`RMQ_DEFAULT_RETRY_DELAY_MS`); TTL tugagach xabar asosiy navbatga qaytadi.
  Asl xabar broker nusxani tasdiqlagandan keyin ack qilinadi.
- **3 urinishdan keyin DLQ.** `RMQ_DEFAULT_MAX_ATTEMPTS = 3`, birinchi urinish ham hisobga kiradi. Keyin xabar
  `requeue: false` bilan rad etiladi va `<navbat>.dlq` ga tushadi. DLQ da xabar 14 kun turadi (`RMQ_DLQ_TTL_MS`).
  Qaytarish — `npm run ops:rmq-dlq-replay`.
- **notification-service — 1 urinish** (`apps/notification-service/src/main.ts`, `{ maxAttempts: 1 }`). Sababi: qayta
  urinishda SMS yoki email ikki marta ketishi mumkin. Birinchi xatoda xabar `notification_queue_v2.dlq` ga tushadi.
- **Handleri yo‘q hodisa** logga yoziladi va ack qilinadi — xabar tashlanadi, DLQ ga tushmaydi.
- **O‘qib bo‘lmaydigan xabar** to‘g‘ridan-to‘g‘ri DLQ ga tushadi.
- **Iste’molchi o‘lib, xabar qayta yetkazilsa**, bu urinish hisoblanmaydi: sanoq faqat sarlavhada.
- **Kanal yopiq bo‘lsa**, ack xatosi ushlanadi va logga yoziladi. Jarayon yiqilmaydi, broker xabarni qayta yetkazadi.
- **So‘rov (RPC)** javob yuborilgandan keyin ack qilinadi; xato javob ham javob hisoblanadi.
- Navbatlar `durable`, xabarlar `persistent`, prefetch 200 (`RMQ_PREFETCH_COUNT`).

## Hodisalar

### `lead.confirmed`

**Qachon:** operator lidga «Tasdiqlandi» natijasini yozdi. Checkout shu liddan buyurtma yaratadi.

**Yuboruvchi:** lead-service, `LeadQueueService.enqueueConfirmed` (`apps/lead-service/src/lead-queue.service.ts`).
Outbox, agregat `lead`; lead relay orqali `checkout_queue_v2` ga.

**Maydonlar** — `LeadConfirmedEvent` (`libs/common/src/dto/lead-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si (takrorni tashlash uchun) |
| `leadId` | string | Lid |
| `source` | `LeadSource` | Manba: `LANDING` (sotuvchi sahifasi), `SITE` (asosiy sayt), `API` (sotuvchi lid API si) |
| `streamId` | string \| null | Sotuvchi sahifasi |
| `affiliateId` | string \| null | Sotuvchi |
| `productId` | string | Mahsulot |
| `quantity` | number | Soni |
| `salePrice` | number | Mijozga aytilgan tovar narxi, butun so‘m (sahifadagi narx) |
| `customerName` | string | Mijoz ismi |
| `customerPhone` | string | Telefon, `+998XXXXXXXXX` |
| `regionSoato` | string | Viloyat SOATO kodi |
| `districtSoato` | string | Tuman SOATO kodi |
| `addressLine` | string | Ko‘cha va uy (telefonsiz) |
| `whereDeliver` | `ADDRESS` \| `CENTER` | Eshikkacha yoki markazgacha |
| `confirmedBy` | string | «Tasdiqlandi» ni yozgan operator |
| `addressConfirmedBy` | string \| null | Manzilni tasdiqlagan operator (BE-38) |
| `confirmedAt` | string | Tasdiq vaqti, ISO 8601 |

**Qabul qiluvchi:** checkout-service, `LeadOrderController.onLeadConfirmed`
(`apps/checkout-service/src/lead-order.controller.ts`) → `LeadOrderService.onLeadConfirmed`. So‘rov
`checkout.lead_order_request` ga takrorsiz yoziladi (`ON CONFLICT DO NOTHING`) va checkoutning o‘z cronida qayta
urinish bilan ishlanadi. Buyurtma yaratilmasa — `order.create-failed`.

### `order.create-failed`

**Qachon:** checkout `lead.confirmed` dan buyurtma yarata olmadi. Lid yo‘qolmaydi: operator navbatiga qaytadi.

**Yuboruvchi:** checkout-service, `LeadOrderService.recordCreateFailed`
(`apps/checkout-service/src/lead-order.service.ts`). Outbox, agregat `lead`; checkout relay orqali `lead_queue_v2` ga.

**Maydonlar** — `OrderCreateFailedEvent` (`libs/common/src/dto/lead-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si |
| `leadId` | string | Lid |
| `reason` | `OrderCreateFailedReason` | `OUT_OF_STOCK` (band qilinmadi), `OFFER_UNAVAILABLE`, `PRICE_CHANGED`, `INVALID_ORDER` |
| `at` | string | Vaqt, ISO 8601 |

**Qabul qiluvchi:** lead-service, `LeadQueueController.orderCreateFailed`
(`apps/lead-service/src/lead-queue.controller.ts`) → `LeadQueueService.onOrderCreateFailed`. Holat bo‘yicha takrorga
chidamli: lid «Tasdiqlandi» da va buyurtmasiz bo‘lsagina o‘zgaradi.

### `order.status.changed`

**Qachon:** lid buyurtmasi yaratildi (`CONFIRMED`) yoki holati T5 bo‘yicha o‘zgardi. Hodisada iste’molchiga kerakli
hamma ma’lumot bor — ular checkout bazasiga murojaat qilmaydi.

**Yuboruvchi:** checkout-service, `LeadOrderStatusService.emit`
(`apps/checkout-service/src/lead-order-status.service.ts`). Outbox, agregat `sales_order`; checkout relay orqali
`finance_queue_v2`, `lead_queue_v2`, `integration_queue_v2`, `notification_queue_v2` ga. `dev` dagi yuborish joylari:

- buyurtma yaratilganda — `CONFIRMED` (`LeadOrderService.create`);
- ombor: birinchi to‘g‘ri skaner — `PICKING`, qadoq — `PACKED`, topshirish akti — `HANDED_TO_ELCHI`
  (`apps/checkout-service/src/fulfillment.service.ts`);
- bekor qilish — `CANCELLED` (RPC `checkout.order.cancel`);
- qaytganni saralash — `RETURNED_GRADED` (RPC `checkout.order.transition`, gateway `warehouse/returns/:orderId/grade`).

Elchi holatlari (`IN_TRANSIT`, `DELIVERED`, `REMITTED`, `REFUSED`, `RETURNING`) — Elchi webhooki (BE-21), pastda.
Qaytarish so‘rovi (`RETURN_REQUESTED` → `RETURNING` yoki `DELIVERED`) — BE-44.

**Maydonlar** — `OrderStatusChangedEvent` (`libs/common/src/dto/order-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si |
| `orderId` | string | Lid buyurtmasi ID si |
| `orderNumber` | string | Odamga ko‘rinadigan raqam, masalan `L-1183` |
| `leadId` | string \| null | Lid; liddan bo‘lmagan buyurtmada `null` |
| `source` | `LANDING` \| `SITE` \| `API` | Manba |
| `streamId` | string \| null | Sotuvchi sahifasi |
| `affiliateId` | string \| null | Sotuvchi |
| `wholesalerId` | string \| null | Optovik |
| `status` | `LeadOrderStatus` | Yangi holat |
| `previousStatus` | `LeadOrderStatus` \| null | Oldingi holat; yaratilganda `null` |
| `recipient` | obyekt | Operator tasdiqlagan qabul qiluvchi: `name`, `phone` (`+998XXXXXXXXX`), `regionSoato`, `districtSoato`, `addressLine`, `whereDeliver` |
| `items[]` | massiv | Tovar qatorlari, pastda |
| `delivery.mode` | `SEPARATE` \| `PARTIAL` \| `FREE` | Yetkazishni ko‘rsatish rejimi |
| `delivery.cost` | number | Mijozga ko‘rsatilgan yetkazish, so‘m (to‘liq Elchi’ga ketadi) |
| `delivery.elchiTariff` | number, ixtiyoriy | Jami og‘irlik bo‘yicha Elchi tarifi — platforma Elchi’ga to‘laydi |
| `codAmount` | number | Kuryer mijozdan oladigan summa, butun so‘m |
| `parcel` | obyekt \| null | Elchi posilkasi: `shipmentId`, `trackingUrl`; yaratilguncha `null` |
| `occurredAt` | string | Vaqt, ISO 8601 |

`items[]` qatori:

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `productId` | string | Mahsulot |
| `wholesalerId` | string \| null, ixtiyoriy | Shu tovar optovigi; bo‘lmasa buyurtmadagi |
| `sku` | string \| null | SKU |
| `name` | string | Nomi |
| `quantity` | number | Soni |
| `weightGrams` | number \| null | Bir dona og‘irligi, gramm |
| `approvedPrice` | number | Tasdiqlangan narx, bir dona |
| `basePrice` | number | Optovik bazaviy narxi, bir dona |
| `salePrice` | number | Sotuv narxi, bir dona (ustama = sotuv − tasdiqlangan) |
| `split.affiliateFee` | number | Sotuvchi haqi, qator uchun jami |
| `split.callCenterFee` | number | Qo‘ng‘iroq markazi, qator uchun jami |
| `split.hiddenDelivery` | number | Narxga yashirilgan yetkazish, qator uchun jami |
| `split.platformService` | number, ixtiyoriy | Tekshiruv uchun; berilsa moliya hisoblagan qoldiqqa teng bo‘lishi kerak |

`LeadOrderStatus`: `CONFIRMED`, `PICKING`, `PACKED`, `HANDED_TO_ELCHI`, `IN_TRANSIT`, `DELIVERED`, `REMITTED`,
`RETURN_REQUESTED`, `SETTLED`, `REFUSED`, `RETURNING`, `RETURNED_GRADED`, `CANCELLED`.

**Qabul qiluvchilar:**

| Servis | Handler | Nima qiladi |
|---|---|---|
| finance-service | `LedgerController.orderStatusChanged` (`apps/finance-service/src/ledger/ledger.controller.ts`) → `LedgerService.onOrderStatusChanged` | Faqat `DELIVERED` va `REFUSED` da moliya jurnaliga yozadi; `processOnce`, consumer `finance.order-status` |
| lead-service | `LeadStatsController.orderStatusChanged` (`apps/lead-service/src/lead-stats.controller.ts`) → `LeadOrderService.onOrderStatusChanged` | Lidda buyurtma holatini yangilaydi (statistika, postback, Meta CAPI); `processOnce`, consumer `lead.order-status` |
| elchi-integration | `ElchiIntegrationController.onOrderStatusChanged` (`apps/elchi-integration/src/elchi-integration.controller.ts`) → `ParcelService.onOrderStatusChanged` | `CONFIRMED` — posilka so‘rovini navbatga qo‘yadi, `CANCELLED` — Elchi’da bekor qiladi; `processOnce`, consumer `elchi-parcel` |
| notification-service | `OrderSmsController.onOrderStatus` (`apps/notification-service/src/order-sms.controller.ts`) | Mijozga SMS (tasdiqlandi; yo‘lga chiqdi — trek bilan; yetkazildi) va sotuvchi kabinetiga xabar (BE-24, BE-47); bir hodisaga bitta xabar (`dedupeKey`) |

### `elchi.parcel.created`

**Qachon:** Elchi’da posilka yaratildi va QR token qaytdi.

**Yuboruvchi:** elchi-integration, `ParcelService.finishCreate` (`apps/elchi-integration/src/parcel.service.ts`).
Outbox, agregat `order`; `eventId` = `elchi.parcel.created:<orderId>` (bitta buyurtmaga bitta). Elchi relay orqali
`checkout_queue_v2` ga.

**Maydonlar** — `ElchiParcelCreatedEvent` (`libs/common/src/dto/order-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si |
| `orderId` | string | Lid buyurtmasi |
| `shipmentId` | string | Elchi posilka raqami |
| `qrCodeToken` | string \| null | Yorliqdagi QR |
| `trackingUrl` | string \| null | Kuzatish havolasi |
| `toBePaid` | number \| null | Elchi `to_be_paid`, butun so‘m |
| `createdAt` | string | Vaqt, ISO 8601 |

**Qabul qiluvchi:** checkout-service, `FulfillmentController.parcelCreated`
(`apps/checkout-service/src/fulfillment.controller.ts`) → `ElchiParcelEventsService.onCreated`: posilkaga Elchi
raqami, QR, kuzatish havolasi va `to_be_paid` yoziladi. `processOnce`, consumer `checkout.elchi-parcel`.

### `elchi.parcel.failed`

**Qachon:** posilka yaratilmadi — qo‘lda ko‘rish kerak.

**Yuboruvchi:** elchi-integration, `ParcelService.recordFailed` (`apps/elchi-integration/src/parcel.service.ts`).
Outbox, agregat `order`; Elchi relay orqali `checkout_queue_v2` ga.

**Maydonlar** — `ElchiParcelFailedEvent` (`libs/common/src/dto/order-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si |
| `orderId` | string | Lid buyurtmasi |
| `reason` | `DISTRICT_NOT_FOUND` \| `ELCHI_REJECTED` \| `INVALID_EVENT` | Sabab: tuman topilmadi, Elchi rad etdi, `order.status.changed` to‘liq emas |
| `message` | string | Tafsilot |
| `at` | string | Vaqt, ISO 8601 |

**Qabul qiluvchi:** checkout-service, `FulfillmentController.parcelFailed` → `ElchiParcelEventsService.onFailed`:
posilka holati `FAILED`, xato matni «sabab: xabar» ko‘rinishida (yig‘ish ro‘yxatida `parcel.error`). Bekor qilingan
posilkaga tegmaydi.

### `elchi.parcel.cancelled` va `elchi.parcel.cancel-failed`

**Qachon:** buyurtma bekor qilingandan keyin Elchi posilkani bekor qildi (`cancelled`) yoki bekor qilmadi, masalan
yetkazilgan (`cancel-failed`).

**Yuboruvchi:** elchi-integration, `ParcelService.recordCancelResult` (`apps/elchi-integration/src/parcel.service.ts`).
Outbox, agregat `order`; Elchi relay orqali `checkout_queue_v2` ga. Elchi’ga murojaatsiz bekor qilinganda hodisa
yo‘q.

**Maydonlar** — `ElchiParcelCancelResultEvent` (`libs/common/src/dto/order-events.dto.ts`), ikkalasida bir xil:

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si |
| `orderId` | string | Lid buyurtmasi |
| `shipmentId` | string \| null | Elchi posilka raqami |
| `message` | string \| null | `cancel-failed` da Elchi javobi |
| `at` | string | Vaqt, ISO 8601 |

**Qabul qiluvchi:** checkout-service, `FulfillmentController.parcelCancelled` / `parcelCancelFailed` →
`ElchiParcelEventsService.onCancelled` / `onCancelFailed`: posilka holati `CANCELLED` yoki `CANCEL_FAILED`.

### `fraud.fee.hold`, `fraud.fee.release`, `fraud.fee.cancel`

**Qachon** (BE-35):

- `hold` — admin «haqni ushlash» qarori yoki soatlik tekshiruv sotuvchining o‘z raqamidan buyurtmani topdi; sotuvchi
  haqi tekshiruvgacha ushlanadi;
- `release` — admin haqni qo‘yib yubordi yoki hodisani yopdi;
- `cancel` — sotuvchi bloklandi; ushlangan hamma haq bekor qilinadi.

**Yuboruvchi:** lead-service, `FraudService` (`holdFee`, `releaseFee`, `decide`; `apps/lead-service/src/fraud.service.ts`).
Outbox, agregat `fraud`; lead relay orqali `finance_queue_v2` ga.

**Maydonlar** — `FraudFeeEvent` (`libs/common/src/dto/lead-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `eventId` | string | Hodisa ID si |
| `incidentId` | string \| null | Firibgarlik hodisasi |
| `affiliateId` | string | Sotuvchi |
| `leadIds` | string[] | Lidlar; `cancel` da — sotuvchining ushlangan hamma lidi |
| `reason` | string | Sabab |
| `at` | string | Vaqt, ISO 8601 |

**Qabul qiluvchi:** finance-service, `LedgerController.feeHold` / `feeRelease` / `feeCancel`
(`apps/finance-service/src/ledger/ledger.controller.ts`) → `LedgerService.onFeeHold` (holat `HELD`, `RELEASED`,
`CANCELLED`; `CANCELLED` — yakuniy). `processOnce`, consumer `finance.fraud-fee-held|released|cancelled`.

### `fraud.measure.applied`

**Qachon:** admin sotuvchiga chora qo‘lladi: ogohlantirish, sahifani to‘xtatish yoki bloklash. Sotuvchiga xabar
borishi kerak.

**Yuboruvchi:** lead-service, `FraudService.measure` (`apps/lead-service/src/fraud.service.ts`). Outbox, agregat
`fraud`; lead relay orqali `notification_queue_v2` ga.

**Maydonlar** — `FraudMeasureEvent` (`libs/common/src/dto/lead-events.dto.ts`): `eventId`, `incidentId` (string \|
null), `affiliateId`, `streamId` (string \| null), `action` (chora), `reason`, `at` (ISO 8601).

**Qabul qiluvchi: yo‘q.** notification-service da bu hodisaga `@EventPattern` yo‘q — server uni logga yozib tashlaydi.

### `lead.callback.reminder`

**Qachon:** rejalashtirilgan qayta qo‘ng‘iroqqa 5 daqiqadan kam qoldi (8-qoida). Har daqiqadagi cron tekshiradi.

**Yuboruvchi:** lead-service, `LeadQueueService.sweep` (`apps/lead-service/src/lead-queue.service.ts`). Outbox, agregat
`lead`; lead relay orqali `notification_queue_v2` ga.

**Maydonlar** (umumiy interfeys yo‘q, obyekt shu faylda yoziladi): `eventId`, `leadId`, `operatorId`, `callbackAt`
(ISO 8601).

### `order.returned`

**Qachon:** yetkazilgandan keyin qaytarish tasdiqlandi — moliya yozuvlarini qaytaradi (BE-44 → BE-22). Bir qaytarish
so‘roviga bir marta.

**Yuboruvchi:** checkout-service, `LeadReturnService` (`apps/checkout-service/src/lead-return.service.ts`). Outbox,
holat bilan bitta tranzaksiyada; checkout relay `finance_queue_v2` ga yuboradi.

**Maydonlar** — `OrderReturnedEvent` (`libs/common/src/dto/order-events.dto.ts`): `eventId`, `orderId`,
`returnRequestId`, `items[]` (`productId`, `quantity` — to‘liq qaytgan qatorlar), `occurredAt` (ISO 8601).

**Qabul qiluvchi:** finance-service, `LedgerController.orderReturned` → `LedgerService.onOrderReturned`;
`processOnce`, consumer `finance.order-returned`.

### `finance.cod.settled`

**Qachon:** Elchi buyurtma pulini o‘tkazdi. Moliya yozuvlari `HOLD` dan `AVAILABLE` ga o‘tadi va sverka qilinadi.

Ikki versiya bor, qabul qiluvchi ularni `schemaVersion` bo‘yicha ajratadi:

- **1-versiya** — eski marketplace, lid-sotuvga tegishli emas. `FinanceCodSettledEvent`
  (`libs/common/src/dto/finance.dto.ts`). Yuboruvchi — checkout `ElchiWebhookService`
  (`apps/checkout-service/src/elchi-webhook.service.ts`), outbox, agregat `sales_order_seller`.
- **2-versiya** — lid-sotuv. `FinanceRemittanceEvent` (`libs/common/src/dto/order-events.dto.ts`):

| Maydon | Turi | Ma’nosi |
|---|---|---|
| `schemaVersion` | `2` | Versiya |
| `eventId` | string | Hodisa ID si |
| `orderId` | string | Lid buyurtmasi |
| `shipmentId` | string \| null | Elchi posilka raqami |
| `elchiStatus` | `paid` \| `partly_paid` \| `closed` | To‘liq, qisman o‘tkazildi yoki yopildi |
| `collectedFromCustomer` | number | Mijozdan yig‘ilgan summa |
| `elchiFee` | number | Elchi haqi |
| `marketPaidAmount` | number | Marketga to‘langan summa |
| `refusalFee` | number \| null, ixtiyoriy | Rad etilgan posilka uchun Elchi ushlagan summa |
| `occurredAt` | string | Vaqt, ISO 8601 |

2-versiyani yuboruvchi — checkout `ElchiLeadWebhookService` (BE-21, pastda).

**Qabul qiluvchi:** finance-service, `FinanceController.codSettled` (`apps/finance-service/src/finance.controller.ts`):
`schemaVersion === 2` — `LedgerService.onRemittance` (`processOnce`, consumer `finance.remittance`), aks holda eski
`FinanceService.processCodSettled`.

### `inventory.lot.blocked`

**Qachon:** partiya muddatiga 60 kundan kam qoldi va sotuvdan chiqdi. Qabulda va har kuni 08:00 da (Toshkent)
tekshiriladi.

**Yuboruvchi:** inventory-service, `InboundService.notifyBlocked` (`apps/inventory-service/src/inbound.service.ts`).
**Outboxsiz**, `notification_queue_v2` ga to‘g‘ridan-to‘g‘ri `emit` (5 s kutish). Avval partiyaga «xabar berildi»
belgisi qo‘yiladi; `emit` yiqilsa belgi olib tashlanadi va hodisa keyingi kunlik tekshiruvda qayta yuboriladi.

**Maydonlar** — `LotBlockedEvent` (`libs/common/src/dto/warehouse-inbound.dto.ts`), `eventId` yo‘q: `lots[]` —
`lotId`, `sku`, `productName`, `batch` (string \| null), `expiryDate`, `sellableUntil` (muddat − 60 kun), `quantity`.

**Qabul qiluvchi:** notification-service, `NotificationEventsController.lotBlocked`
(`apps/notification-service/src/notification-events.controller.ts`) — admin va superadminlarga xabar.

### `price.decision.orange`

**Qachon:** admin «to‘q sariq» narxni tasdiqladi (platforma yoki sotuvchi zarar ko‘radi, sabab majburiy).

**Yuboruvchi:** catalog-service, `PricingService.emitOrange` (`apps/catalog-service/src/pricing.service.ts`).
**Outboxsiz**, qaror saqlangandan keyin `notification_queue_v2` ga `emit`. Yuborish xatosi faqat logga yoziladi —
hodisa yo‘qolishi mumkin.

**Maydonlar** (umumiy interfeys yo‘q), `eventId` yo‘q: `productId`, `productName`, `price` (tasdiqlangan narx),
`recommended` (tavsiya narx), `reason` (string \| null), `decidedBy` (admin).

**Qabul qiluvchi:** notification-service, `NotificationEventsController.priceOrange`
(`apps/notification-service/src/notification-events.controller.ts`) — faol superadminlarga xabar.

### `inventory.inbound.received`

**Qachon:** omborchi postavkani qabul qildi (BE-17) — optovik kabinetiga xabar, brak bo‘lsa soni bilan (BE-47, TZ 6.12).

**Yuboruvchi:** inventory-service, `recordInboundReceived` (`apps/inventory-service/src/inventory.helpers.ts`). Outbox,
qabul bilan bitta tranzaksiyada, agregat `inbound_shipment`; `InventoryOutboxRelayService` `notification_queue_v2` ga.

**Maydonlar** — `InboundReceivedEvent` (`libs/common/src/dto/warehouse-inbound.dto.ts`): `shipmentId`, `number`
(postavka raqami), `wholesalerId`, `status` (`InboundShipmentStatus`), `declaredQty`, `receivedQty`, `defectiveQty`.
`eventId` yo‘q — takror xabarni `dedupeKey` ushlaydi.

**Qabul qiluvchi:** notification-service, `CabinetMessagesController.onInboundReceived`
(`apps/notification-service/src/cabinet-messages.controller.ts`) — optovik kabinetiga xabar; bir postavkaga bitta
(`dedupeKey` = `inbound:<shipmentId>:received`).

### `inventory.offer.out-of-stock`

**Qachon:** HQ dagi sotuvga yaroqli bo‘sh qoldiq 0 bo‘ldi — band qilish, tuzatish, hisobdan chiqarish yoki partiya
muddati bloki (BE-47, TZ 6.12). (`inventory.stock_depleted` — boshqa hodisa, katalogga.)

**Yuboruvchi:** inventory-service, `recordOfferOutOfStock` (`apps/inventory-service/src/inventory.helpers.ts`). Outbox,
qoldiqni kamaytirgan amal bilan bitta tranzaksiyada, agregat `offer_stock_notice`; relay `notification_queue_v2` ga.

**Maydonlar** — `StockDepletedEvent` (`libs/common/src/dto/warehouse-inbound.dto.ts`): `variantIds[]`, `at` (ISO 8601).

**Qabul qiluvchi:** notification-service, `CabinetMessagesController.onStockDepleted` — adminlarga va shu offerda
sahifasi bor sotuvchilarga (RPC `lead.offer.affiliates`); bir kunda bir variantga har qabul qiluvchiga bitta [taklif]
(`dedupeKey` = `stock:<variantId>:<kun>:user:<userId>`).

### `finance.withdrawal.paid`

**Qachon:** moliya sotuvchining pul yechish so‘rovini «To‘landi» qildi (BE-23) — sotuvchiga «Pul o‘tkazildi» SMS i
(BE-24, TC4).

**Yuboruvchi:** api-gateway, `AdminWithdrawalsController` (`apps/api-gateway/src/withdrawals/admin-withdrawals.controller.ts`)
— moliya RPC muvaffaqiyatli bo‘lgach `notification_queue_v2` ga to‘g‘ridan-to‘g‘ri `emit`. **Outboxsiz** [taklif]:
yuborilmasa faqat log; «To‘landi» ni qayta bosish xabarni qayta yuboradi (holat idempotent).

**Maydonlar** (`WithdrawalPaidEvent`, `apps/notification-service/src/order-sms.ts`): `withdrawalId`, `affiliateId`,
`amount`, `tax`, `net` (so‘m). `eventId` yo‘q.

**Qabul qiluvchi:** notification-service, `OrderSmsController.onWithdrawalPaid`
(`apps/notification-service/src/order-sms.controller.ts`) — telefon identity dan (RPC), SMS; bir so‘rovga bitta
(`dedupeKey`).

### `finance.wholesaler.paid`

**Qachon:** moliya optovik aktini «To‘landi» qildi (BE-33) — optovikka «Pul o‘tkazildi» (BE-47, TC3).

**Yuboruvchi:** api-gateway, `AdminSettlementsController` (`apps/api-gateway/src/withdrawals/admin-settlements.controller.ts`)
— `finance.withdrawal.paid` kabi, outboxsiz [taklif].

**Maydonlar** — `SettlementPaidEvent` (`libs/common/src/dto/wholesaler-settlement.dto.ts`): `settlementId`, `number`
(akt raqami), `wholesalerId`, `amount` (bankka o‘tkazilgan summa, so‘m), `periodStart`, `periodEnd`. `eventId` yo‘q.

**Qabul qiluvchi:** notification-service, `CabinetMessagesController.onSettlementPaid` — optovik kabineti va SMS; bir
aktga bitta (`dedupeKey` = `settlement:<settlementId>:PAID`).

### `lead.site.confirm-sms`

**Qachon:** saytdagi mehmon buyurtmasida mijoz «SMS bilan tasdiqlash» ni tanladi (BE-34) — tasdiq havolasi bilan SMS.

**Yuboruvchi:** lead-service, `SiteOrderService` (`apps/lead-service/src/site-order.service.ts`). Outbox, lid bilan
bitta tranzaksiyada, agregat `lead`; `LeadOutboxRelayService` (`LEAD_OUTBOX_RELAY=on`) `notification_queue_v2` ga.

**Maydonlar** — `SiteConfirmSmsEvent` (`libs/common/src/dto/lead-events.dto.ts`): `eventId`, `leadId`, `phone`
(`+998XXXXXXXXX`), `text` (tayyor matn: summa, tovarlar, tuman, havola — mijoz yozgan matnsiz), `expiresAt` (havola
muddati, ISO 8601).

**Qabul qiluvchi:** notification-service, `SiteOrderSmsController.send`
(`apps/notification-service/src/site-order-sms.controller.ts`) — SMS adapteri orqali; bir hodisaga bitta.

### `auth.verification-code.requested`

**Qachon:** SMS kod so‘raldi — sotuvchi va optovik ro‘yxati, kirish (BE-06), eski parolni tiklash va telefon kodi.

**Yuboruvchi:** identity-service, `AffiliateAuthService` (`apps/identity-service/src/affiliate-auth/affiliate-auth.service.ts`)
va `AuthService` (`apps/identity-service/src/auth/auth.service.ts`) — kod bazaga yozilgach `notification_queue_v2` ga
to‘g‘ridan-to‘g‘ri `emit`, outboxsiz. Blokdagi raqamga kod yuborilmaydi (javob baribir bir xil).

**Maydonlar** (`VerificationCodeRequestedEvent`, `apps/notification-service/src/otp-sms.controller.ts`): `phone`
(`+998XXXXXXXXX`), `code` (6 raqam), `purpose` (`REGISTER`, `LOGIN`, `PASSWORD_RESET`, `PHONE_VERIFY`).

**Qabul qiluvchi:** notification-service, `OtpSmsController.onCode` — noto‘g‘ri telefon yoki kod tashlanadi; SMS adapteri
orqali, provayder javob bermasa 15 s va 60 s dan keyin qayta urinadi (BE-24 TC5). Adapter sozlanmagan bo‘lsa:
production’da xato logi (kod yuborilmaydi), boshqa muhitda kod logga yoziladi (test stub).

### `finance.cod.reconciliation.mismatch`

**Qachon:** kunlik COD sverkasi (finance, 09:00 Toshkent [taklif], BE-21) Elchi o‘tkazgan pul bilan kutilgan summa
orasida farq topdi.

**Yuboruvchi:** finance-service, `CodDailyCheckService` (`apps/finance-service/src/ledger/cod-daily-check.service.ts`) —
`notification_queue_v2` ga to‘g‘ridan-to‘g‘ri `emit`, outboxsiz; yuborish xatosi logga.

**Maydonlar** — `CodReconciliationMismatchEvent` (`libs/common/src/dto/cod-daily-check.dto.ts`): `date`,
`mismatchCount`, `diffTotal` (kelgan − kutilgan, so‘m), `orders[]` (`orderId`, `expected`, `received`, `diff`; birinchi
bir nechtasi).

**Qabul qiluvchi:** notification-service, `NotificationEventsController.codMismatch`
(`apps/notification-service/src/notification-events.controller.ts`) — faol moliya xodimlari va nazoratchilarga.

## Elchi webhooki (BE-21, PR 128 — `dev` da)

PR 128 2026-11-22 da `dev` ga tushdi. Undagi hodisalar:

- **Elchi webhooki lid buyurtmasi holatini o‘zgartiradi.** `ElchiLeadWebhookService`
  (`apps/checkout-service/src/elchi-lead-webhook.service.ts`) `LeadOrderStatusService.applyTransition` orqali
  `IN_TRANSIT`, `DELIVERED`, `REMITTED`, `REFUSED`, `RETURNING` ga o‘tkazadi. Har o‘tishda `order.status.changed`
  ketadi; moliya `DELIVERED` va `REFUSED` ni shu yo‘l bilan oladi.
- **`finance.cod.settled` 2-versiya yuboruvchisi** — o‘sha servis. Outbox, agregat `sales_order`; checkout relay
  `finance.` qoidasi bilan `finance_queue_v2` ga yuboradi.
- **`elchi.status.conflict`** (`ELCHI_STATUS_CONFLICT_EVENT`, `libs/common/src/dto/elchi-webhook.dto.ts`) — Elchi
  xabari buyurtma holatiga zid. Masalan, yetkazilgan sotuvni bekor qildi yoki rad etilgan posilkani «sotildi» dedi.
  Buyurtma o‘zgarmaydi; moliya va nazoratchi qo‘lda hal qiladi. Bir buyurtma uchun bir marta.
  - Yuboruvchi: checkout `ElchiLeadWebhookService`, `notification_queue_v2` ga to‘g‘ridan-to‘g‘ri `emit`.
  - Maydonlar — `ElchiStatusConflictEvent`: `orderId`, `shipmentId`, `orderStatus` (bizdagi holat), `elchiStatus`
    (Elchi holati), `eventId`, `occurredAt`.
  - Qabul qiluvchi: notification-service, `NotificationEventsController.elchiStatusConflict` — moliya xodimlari va
    nazoratchilarga xabar (`elchi_status_conflict` shabloni).

## Outbox orqali yuboriladigan ombor buyruqlari (RPC)

Bular hodisa emas, lekin checkout outboxi orqali ketadi. Buyurtma holati bilan bitta tranzaksiyada agregat
`inventory_command` bilan yoziladi (`inventoryCommand`, `apps/checkout-service/src/lead-order-status.service.ts`):

| Buyruq | Qachon | Idempotent kalit |
|---|---|---|
| `inventory.release` | buyurtma `CANCELLED` — band bo‘shaydi | `lead-order-cancel:<orderId>` |
| `inventory.commit` | buyurtma `HANDED_TO_ELCHI` — band chiqimga aylanadi | `lead-order-handover:<orderId>` |

Commitdan keyin buyruq darhol yuboriladi (`sendInventoryNow`, xato e’tiborsiz). Checkout relay ham uni
`inventory.send({ cmd })` bilan 5 s kutish bilan qayta yuboradi. Ombor 4xx qaytarsa (408 va 429 dan tashqari),
qator `FAILED` bo‘ladi va qo‘lda ko‘riladi. Qabul qiluvchi — inventory-service `@MessagePattern`
(`apps/inventory-service/src/inventory-operations.controller.ts`).

## Kuzatilgan bo‘shliqlar (`dev`, 2026-11-23)

1. `LEAD_OUTBOX_RELAY` va `ELCHI_OUTBOX_RELAY` sukutda o‘chiq. Yoqilmasa `lead.confirmed`, `fraud.*`, `elchi.parcel.*`
   yuborilmaydi.
2. `fraud.measure.applied` va `lead.callback.reminder` notification navbatiga ketadi, lekin handler yo‘q — sotuvchi
   va operatorga xabar bormaydi.
3. Outboxsiz hodisalar yo‘qolishi mumkin (yuborish xatosi faqat logga): `price.decision.orange`,
   `finance.withdrawal.paid`, `finance.wholesaler.paid`, `auth.verification-code.requested`,
   `finance.cod.reconciliation.mismatch`, `elchi.status.conflict`. `inventory.lot.blocked` va `price.decision.orange`
   da `eventId` yo‘q.

Eski marketplace hodisalari (`payment.paid`, `shop.approved`, `order.created`, `return.status-changed` va boshqalar)
lid-sotuvga tegishli emas va bu ro‘yxatga kiritilmadi.
