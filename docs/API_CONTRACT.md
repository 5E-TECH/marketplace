# Elchi Marketplace — API kontrakt (MVP / Faza 1: sotuvchi kabineti)

> **Maqsad.** FE (seller-cabinet) va BE bir xil interfeysga qarab ishlashi uchun har
> endpoint'ning **request/response shakli, validatsiya, rol, xato** aniq belgilangan.
> Bu `MARKETPLACE_PLAN.md` (§5 model, §6 enum, §13 route) ni **to'ldiradi** — ular bilan
> ziddiyat bo'lsa, model/enum manba, bu fayl esa "sim shakli" (wire format).
>
> **Maintenance rule.** Route/DTO/xato o'zgarsa — shu faylni ham yangilang. Swagger shu
> kontraktdan generatsiya qilinadi (C0.3).

Holat: **DRAFT** · 2026-07 · Qamrov: **Faza 1 MVP**. Faza 2/3 (storefront/cart/checkout/
payment) — §12 placeholder.

---

## 1. Konvensiyalar

### 1.1 Base URL & versiyalash
```
Prod:  https://api.<domen>/api/v1
Dev:   http://localhost:3000/api/v1
```
- Barcha route `/api/v1` prefiksi bilan. Breaking o'zgarish → `/api/v2`.
- Format: **JSON** (`Content-Type: application/json`). Fayl yuklash — `multipart/form-data` (§6.6).

### 1.2 Autentifikatsiya
```
Authorization: Bearer <access_jwt>
```
- Public route'lardan tashqari hammasi shu header'ni talab qiladi. Yo'q/muddati o'tgan → `401`.
- Rol yetmasa → `403`. O'zganing resursi → `403` (SelfGuard).

### 1.3 Muvaffaqiyatli javob (envelope)
Barcha 2xx javob **bir xil qobiqda**:
```jsonc
{
  "statusCode": 200,
  "message": "OK",
  "data": { /* resurs yoki pagination */ }
}
```
- `data` — obyekt, massiv yoki `null` (masalan 204-ma'noli amallar).
- Yaratish → `201` + `data` = yaratilgan resurs.

### 1.4 Pagination
List endpoint'lar query oladi: `?page=1&limit=20&sort=createdAt:desc&search=...`
- `page` ≥ 1 (default 1), `limit` 1..100 (default 20).
- `sort` = `maydon:asc|desc`. Ruxsat etilgan maydonlar har endpoint'da.
- Javob `data` shakli:
```jsonc
{
  "items": [ /* ... */ ],
  "total": 137,
  "page": 1,
  "limit": 20,
  "totalPages": 7
}
```

### 1.5 Xato formati (barcha 4xx/5xx bir xil)
```jsonc
{
  "statusCode": 400,
  "message": "Validation failed",        // yoki string[] (validatsiya ro'yxati)
  "errorCode": "VALIDATION_ERROR",        // barqaror mashina-o'qiydigan kod
  "details": [                            // ixtiyoriy: maydon bo'yicha
    { "field": "phone", "error": "phone noto'g'ri formatda" }
  ]
}
```

**Barqaror `errorCode` lug'ati:**

| HTTP | errorCode | Qachon |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query validatsiyadan o'tmadi |
| 400 | `BUSINESS_RULE_VIOLATION` | Biznes qoida (masalan manfiy qoldiq) |
| 401 | `UNAUTHENTICATED` | Token yo'q/yaroqsiz/muddati o'tgan |
| 403 | `FORBIDDEN` | Rol yetmaydi yoki o'zganing resursi |
| 404 | `NOT_FOUND` | Resurs topilmadi |
| 409 | `CONFLICT` | Dublikat (unique buzilishi: phone/slug/sku) |
| 409 | `INVALID_STATE` | State machine ruxsat bermaydi (masalan approved shopni qayta approve) |
| 422 | `INSUFFICIENT_STOCK` | Qoldiq yetarli emas (reserve/checkout) |
| 429 | `RATE_LIMITED` | Limit oshdi |
| 500 | `INTERNAL_ERROR` | Kutilmagan xato (batafsil log'da, javobda emas) |

### 1.6 Umumiy maydon qoidalari

| Tur | Qoida |
|---|---|
| `id` | `string` (bigint → JSON'da string, aniqlik yo'qolmasin). Masalan `"1024"`. |
| Pul | `number`, 2 kasr (masalan `149900.00` → `149900`). Valyuta **UZS** (implicit, MVP). Manfiy emas. |
| `phone` | `string`, format **`+998XXXXXXXXX`** (12 belgi, +998 + 9 raqam). |
| `slug` | `string`, `^[a-z0-9]+(-[a-z0-9]+)*$`, avtomat generatsiya (nomdan), tahrir mumkin. |
| Sana | **ISO-8601 UTC**, masalan `"2026-07-21T18:30:00.000Z"`. |
| `enum` | PRD §6 dagi qiymatlar (masalan `ProductStatus`), **UPPERCASE**. |
| Matn | `name` 1..255, `description` ≤ 5000, `sku` 1..100. |

---

## 2. Auth & Identity

### 2.1 JWT struktura
**Access token** (qisqa umr), claim'lar:
```jsonc
{
  "sub": "1024",            // user id
  "role": "SELLER",         // Roles enum
  "shopId": "55",           // faqat SELLER uchun (aks holda yo'q)
  "iat": 1721580000,
  "exp": 1721583600
}
```
- **Access muddati:** 1 soat. **Refresh muddati:** 7 kun.
- Imzo: `HS256`, `JWT_SECRET` (env). Refresh alohida `JWT_REFRESH_SECRET`.

### 2.2 Refresh oqimi (rotation)
- `login`/`register` → `{ accessToken, refreshToken }` qaytaradi.
- Access muddati o'tsa → `POST /auth/refresh {refreshToken}` → **yangi juftlik**; eski refresh **bekor** qilinadi (rotation).
- `POST /auth/logout` → refresh bekor qilinadi.
- FE: access'ni memory/localStorage, refresh'ni saqlaydi; 401 da bir marta refresh, keyin login'ga.

### 2.3 OTP qarori (MVP)
- **MVP'da telefon OTP YO'Q.** Sabab: sotuvchi baribir **admin approve**'dan o'tadi (soxta ro'yxat bloklanadi), SMS xarajati/murakkabligi keyinga. `phone` **unique** bilan himoyalanadi.
- Buyer OTP (Faza 2) — keyin qo'shiladi. *(Bu qarorni o'zgartirmoqchi bo'lsangiz — ayting.)*

### 2.4 Endpoints

**`POST /auth/register` · public** — sotuvchi ro'yxati (§12).
```jsonc
// Request
{
  "name": "Akmal Karimov",
  "phone": "+998901234567",
  "password": "Secret123",        // min 8, kamida 1 harf + 1 raqam
  "shopName": "Akmal Store",
  "regionId": "12"                // Elchi region (geo)
}
// 201 data
{
  "user": { "id": "1024", "name": "Akmal Karimov", "phone": "+998901234567", "role": "SELLER", "isActive": false },
  "shop": { "id": "55", "name": "Akmal Store", "slug": "akmal-store", "status": "PENDING" },
  "accessToken": "eyJ...", "refreshToken": "eyJ..."
}
```
- Atomik: `user(SELLER,inactive)` + `shop(PENDING)`; biri xato → ikkalasi rollback.
- Xato: `409 CONFLICT` (phone band), `400 VALIDATION_ERROR`.
- **Eslatma:** `isActive=false` — approve'gacha faqat kabinetga kiradi, storefront'da ko'rinmaydi.

**`POST /auth/login` · public**
```jsonc
// Request
{ "phone": "+998901234567", "password": "Secret123" }
// 200 data
{ "user": { "id":"1024","name":"...","role":"SELLER","shopId":"55" }, "accessToken":"...", "refreshToken":"..." }
```
- Xato: `401 UNAUTHENTICATED` (phone/parol noto'g'ri — **bir xil xabar**, foydalanuvchi mavjudligini oshkor qilmaslik uchun).

**`POST /auth/refresh` · public** — `{refreshToken}` → `{accessToken, refreshToken}`. Yaroqsiz → `401`.
**`POST /auth/logout` · auth** — `{refreshToken}` → `204`-ma'noli (`data:null`).
**`GET /auth/me` · auth** — joriy user + (seller bo'lsa) shop qisqa profili.

---

## 3. Sellers — shop profil

**`GET /sellers/me` · SELLER** — o'z do'koni to'liq profili (`shop` §5.1).
**`PATCH /sellers/me` · SELLER**
```jsonc
// Request (barcha maydon ixtiyoriy)
{ "name":"...", "description":"...", "phone":"+998...", "logoUrl":"...", "bannerUrl":"...",
  "regionId":"12", "districtId":"140", "address":"..." }
// 200 data: yangilangan shop
```
- `slug`, `status`, `elchiMarketId`, `rating` — **tahrir qilib bo'lmaydi** (server boshqaradi). Yuborilsa — e'tiborsiz yoki `400`.
- Boshqa do'kon → `403 FORBIDDEN` (SelfGuard).

---

## 4. Categories

**`GET /categories` · public** — daraxt (ierarxik).
```jsonc
// 200 data
[ { "id":"1","name":"Elektronika","slug":"elektronika","iconUrl":"...","children":[
      { "id":"7","name":"Telefonlar","slug":"telefonlar","children":[] } ] } ]
```
- Query: `?flat=true` → tekis ro'yxat (`parentId` bilan). `?activeOnly=true` (default true).

**Admin CRUD** (C1.10): `POST/PATCH/DELETE /admin/categories` — `{name, parentId?, iconUrl?, sortOrder?}`. Dublikat slug → `409`.

---

## 5. Products + variants

### 5.1 Ro'yxat
**`GET /products/my` · SELLER** — o'z mahsulotlari, pagination.
- Query: `page, limit, search, status(ProductStatus), categoryId, sort(createdAt|price|name:asc|desc)`.
- `data` = pagination envelope; `items[]` = product qisqa (`id,name,slug,price,status,imageUrl,hasVariants,createdAt`).

**`GET /products/:id` · SELLER** — to'liq product + variants[]. O'zganiki → `403`.

**`GET /storefront/shops/:shopId/products` · PUBLIC** — faol do'konning faol
mahsulotlari. `page, limit, search, categoryId, minPrice, maxPrice, sort`
filtrlari qo'llanadi. Do'kon topilmasa yoki faol bo'lmasa → `404`.

### 5.2 Yaratish / tahrir
**`POST /products` · SELLER**
```jsonc
{
  "name":"Adidas krossovka","categoryId":"7","description":"...",
  "price":499000,"oldPrice":599000,
  "images":["https://.../1.jpg","https://.../2.jpg"],   // birinchisi cover
  "attributes":{"brand":"Adidas","material":"charm"},
  "hasVariants":true,
  "status":"DRAFT"                                        // default DRAFT
}
// 201 data: yaratilgan product (slug avtomat: "adidas-krossovka", shop ichida unique)
```
- Validatsiya: `name` 1..255, `price` > 0, `status ∈ ProductStatus`, `categoryId` mavjud bo'lsin.
- `shopId`/`ownerUserId` — **body'dan olinmaydi**, token'dan (`shopId`). Yuborilsa e'tiborsiz.
- Dublikat slug (shop ichida) → `409`.

**`PATCH /products/:id` · SELLER** — yuqoridagi maydonlar (barchasi ixtiyoriy). O'zganiki → `403`.
**`DELETE /products/:id` · SELLER** — soft-delete (`isDeleted=true`). → `204`-ma'noli.

### 5.3 Variantlar
> Variantsiz mahsulotga ham server **1 ta default variant** yaratadi (sklad `variantId` bo'yicha).

**`POST /products/:id/variants` · SELLER**
```jsonc
{ "sku":"ADI-RED-42","name":"Qizil / 42","attributes":{"rang":"qizil","o'lcham":"42"},
  "price":null,          // null → product.price
  "oldPrice":null,"barcode":"4780000000000","imageUrl":"...","isActive":true }
// 201 data: variant
```
- `sku` **global unique** → dublikat `409`.

**`PATCH /products/:id/variants/:vid`** — tahrir. **`DELETE /.../:vid`** — soft-delete (oxirgi/default variantni o'chirib bo'lmaydi → `409 INVALID_STATE`).

---

## 6. Inventory

### 6.1 Omborlar
**`GET /inventory/warehouses` · SELLER** — o'z omborlari.
**`POST /inventory/warehouses` · SELLER**
```jsonc
{ "name":"Asosiy ombor","regionId":"12","districtId":"140","address":"...","isDefault":true }
// 201 data: warehouse. Birinchi ombor avtomat isDefault=true.
```

### 6.2 Qoldiq
**`GET /inventory/stock` · SELLER** — pagination.
- Query: `warehouseId?, variantId?, productId?, lowOnly?(bool), search?`.
- `items[]`: `{ variantId, productName, variantName, sku, warehouseId, warehouseName, onHand, reserved, available, lowStockThreshold }` (`available = onHand − reserved`).

**`GET /inventory/stock/low` · SELLER** — `available ≤ lowStockThreshold` bo'lganlar (= `?lowOnly=true` qisqartmasi).

### 6.3 Kirim / tuzatish (movement)
**`POST /inventory/stock/inbound` · SELLER**
```jsonc
{ "variantId":"88","warehouseId":"3","quantity":50,"reason":"Yangi partiya",
  "idempotencyKey":"po-2026-07-21-001" }     // ixtiyoriy, takror-himoya
// 200 data: { variantId, warehouseId, onHand, reserved, available }
```
- `quantity` > 0. Yangi (variant,warehouse) juftligi bo'lsa — stock qatori avtomat yaratiladi.

**`POST /inventory/stock/adjust` · SELLER**
```jsonc
{ "variantId":"88","warehouseId":"3","delta":-5,"reason":"Yaroqsiz",
  "idempotencyKey":"adj-..." }               // delta signed (+/−)
// 200 data: yangi holat
```
- **Invariant:** natija `onHand − reserved ≥ 0` bo'lmasa → `422 INSUFFICIENT_STOCK` (holat o'zgarmaydi).
- Har amal `stock_movement` jurnaliga `actorId`(token) bilan yoziladi.

> **Muhim:** `reserve/commit/release` — bu **tashqi API emas**, ichki RMQ pattern (checkout chaqiradi, §8 PRD). Bu yerda faqat **seller qo'lda** ishlatadigan inbound/adjust bor.

### 6.4 Media upload
**`POST /files/upload` · SELLER** · `multipart/form-data`, maydon `file`.
- Ruxsat: `jpeg/png/webp`, ≤ **5 MB**. Aks holda `400 VALIDATION_ERROR`.
- `201 data`: `{ url, size, mime }`. URL'ni product `images[]` ga qo'yasiz.

---

## 7. Seller orders & dashboard

**`GET /seller/orders` · SELLER** — o'z sub-buyurtmalari (`sales_order_seller` + Elchi status), pagination.
- Query: `status(SalesOrderSellerStatus)?, dateFrom?, dateTo?, search?`.
- `items[]`: `{ id, salesOrderId, buyerName, subtotal, codAmount, status, elchiShipmentId, trackingUrl, itemsCount, createdAt }`.
- Buyurtmasiz → bo'sh `items`, `total:0` (xato **emas**).

**`GET /seller/dashboard` · SELLER**
```jsonc
// 200 data
{ "ordersTotal":42, "revenue":5400000, "pendingShipments":3, "delivered":30,
  "lowStockCount":5, "topProducts":[{"productId":"88","name":"...","sold":21}],
  "salesByDay":[{"date":"2026-07-20","amount":320000}] }
```
- Ma'lumot yo'q davr → nol/bo'sh massivlar (xato emas).

---

## 8. Admin / Platform Back-office

> **Domen tavsifi va qamrov:** `ADMIN_TZ.md`. Bu yerda **wire format**. Barcha `/admin/*`
> route `ADMIN|SUPERADMIN` rol talab qiladi; **xavfli** amallar (payout, komissiya, provayder
> kaliti, rol/o'chirish, sozlama) faqat **`SUPERADMIN`**. Har yozuv amali **audit'ga** yoziladi.
> Belgilar: ⭐ MVP · ◻︎ keyin.

### 8.1 Dashboard ⭐
**`GET /admin/dashboard` · ADMIN**
```jsonc
// 200 data
{ "shops": { "total": 120, "pending": 4, "active": 110, "suspended": 6 },
  "users": { "sellers": 118, "buyers": 3400, "admins": 5 },
  "orders": { "total": 5200, "today": 42 },
  "gmv": 840000000, "revenue": 42000000 }   // revenue = komissiya
```
- ◻︎ Keyin: `?range=7d|30d` bilan grafik seriyalari, top do'kon/mahsulot.

### 8.2 Accountlar (users) ⭐
**`GET /admin/users` · ADMIN** — pagination. Query: `role(Role)?, status(active|blocked)?, search?`.
- `items[]`: `{ id, name, phone, role, isActive, shopId?, createdAt }`.

**`GET /admin/users/:id` · ADMIN** — to'liq profil + (seller bo'lsa) shop qisqa + oxirgi faoliyat.
**`POST /admin/users/:id/block` · ADMIN** — `{ "reason":"..." }` → `isActive=false` (kira olmaydi). O'zini bloklab bo'lmaydi → `409`.
**`POST /admin/users/:id/unblock` · ADMIN** → `isActive=true`.
**`POST /admin/users/:id/reset-password` · ADMIN ◻︎** → vaqtinchalik parol / reset havola.
**`PATCH /admin/users/:id/role` · SUPERADMIN ◻︎** — `{ "role":"ADMIN" }`. Oxirgi SUPERADMIN pasaymaydi → `409`.
**`POST /admin/users/:id/impersonate` · SUPERADMIN ◻︎** → `{ impersonationToken }` (cheklangan muddat, audit).

### 8.3 Do'konlar (shops) ⭐
**`GET /admin/shops` · ADMIN** — pagination. Query: `status(ShopStatus)?, search?`.
**`GET /admin/shops/:id` · ADMIN** — to'liq do'kon + statistikasi (mahsulot/buyurtma/ombor soni, ⭐; moliya ◻︎).
**`POST /admin/shops/:id/approve` · ADMIN**
```jsonc
// Request: bo'sh yoki { "note":"..." }
// 200 data: { shop: {...status:"ACTIVE", elchiMarketId:"9001"} }
```
- Ketma-ketlik (§12): `user.active` + `shop.active` + default warehouse + Elchi `POST /partner/markets` → `elchiMarketId`.
- `PENDING` emas shopni approve → `409 INVALID_STATE`.
- Elchi provision xato → tranzaksiya rollback, `shop` `PENDING` qoladi, `502`-ma'noli xato (`errorCode: BUSINESS_RULE_VIOLATION`, message = sabab).

**`POST /admin/shops/:id/reject` · ADMIN** — `{ "reason":"..." }` (majburiy) → `shop.REJECTED` + notify.
**`POST /admin/shops/:id/suspend` · ADMIN** — `active → suspended`, mahsulotlari storefront'da yashirinadi.
**`POST /admin/shops/:id/activate` · ADMIN** — `suspended → active`.
**`PATCH /admin/shops/:id` · ADMIN ◻︎** — profil tahrir. **`POST /admin/shops/:id/feature` · ADMIN ◻︎** — tavsiya (featured).

### 8.4 Katalog / mahsulot moderatsiya
**`GET /admin/products` · ADMIN ⭐** — hamma mahsulot, pagination. Query: `shopId?, categoryId?, status?, search?`.
**`POST /admin/products/:id/hide` · ADMIN ◻︎** — storefront'da yashiradi. **`.../flag` ◻︎** — belgilaydi.

### 8.5 Kategoriyalar ⭐
**`GET /admin/categories` · ADMIN** — daraxt (yoki `?flat=true`).
**`POST /admin/categories` · ADMIN** — `{ name, parentId?, iconUrl?, sortOrder?, isActive? }`. Dublikat slug → `409`.
**`PATCH /admin/categories/:id` · ADMIN** · **`DELETE /admin/categories/:id` · ADMIN** — bola bo'lsa ogohlantirish/`409`.

### 8.6 Buyurtmalar (butun platforma)
**`GET /admin/orders` · ADMIN ⭐** — hamma buyurtma, pagination. Query: `status?, paymentMethod?, shopId?, dateFrom?, dateTo?, search?`.
- `items[]`: `{ id, buyerName, total, paymentMethod, status, sellersCount, createdAt }`.

**`GET /admin/orders/:id` · ADMIN ⭐** — to'liq: sub-buyurtmalar + itemlar + shipmentlar + to'lov + tarix.
**`POST /admin/orders/:id/cancel` · ADMIN ◻︎** — `{ reason }` → majburiy bekor (reserve release + Elchi cancel).
**`POST /admin/orders/:id/refund` · SUPERADMIN ◻︎** — `{ reason, amount? }` → refund oqimi.

### 8.7 Sklad nazorati ◻︎
**`GET /admin/inventory/stock` · ADMIN** — istalgan do'kon qoldig'i (query: `shopId, warehouseId, variantId`).
**`GET /admin/inventory/movements` · ADMIN** — jurnal (audit uchun).

### 8.8 To'lovlar ◻︎
**`GET /admin/payments` · ADMIN** — hamma tranzaksiya (query: `provider?, status?, orderId?, dateFrom/To?`).
**`GET /admin/payments/providers` · SUPERADMIN** · **`PUT /admin/payments/providers/:provider` · SUPERADMIN** — `merchantId`, `secret` (AES; javobda **maskalanadi**), `isActive`.

### 8.9 Moliya: payout + komissiya ◻︎
**`GET /admin/finance/ledger` · ADMIN** — seller ledger (query: `shopId?`).
**`GET /admin/finance/payouts` · ADMIN** — payout ro'yxati (query: `shopId?, status?`).
**`POST /admin/finance/payouts/:id/approve|hold|release` · SUPERADMIN** — holat o'zgartirish. **Release idempotent** (2x → 1 marta).
**`GET/POST/PATCH /admin/finance/commissions` · SUPERADMIN** — `{ scope:"global|category|shop", refId?, type:(PERCENT|FIXED), value }`.
**`GET /admin/finance/reports` · ADMIN** — daromad, COD vs online reconciliation.

### 8.10 Elchi integratsiya ◻︎
**`GET /admin/integration/shipments` · ADMIN** · **`GET /admin/integration/webhooks` · ADMIN** — loglar.
**`POST /admin/integration/shops/:id/reprovision` · ADMIN** — Elchi market qayta ochish (xato bo'lsa).

### 8.11 Broadcast / bildirishnoma ◻︎
**`POST /admin/broadcast` · ADMIN** — `{ audience:"sellers|buyers|all", channel:"inapp|sms|email|telegram", title, body }`.
**`GET /admin/notifications/templates` · ADMIN** — shablonlar.

### 8.12 Kontent / bannerlar ◻︎
**`GET/POST/PATCH/DELETE /admin/content/banners` · ADMIN** — storefront bosh sahifa bloklari.

### 8.13 Platforma sozlamalari ◻︎
**`GET /admin/settings` · ADMIN** · **`PUT /admin/settings` · SUPERADMIN** — komissiya default, rate-limit, feature flag, dostavka narx siyosati.

### 8.14 Admin jamoa ◻︎
**`GET /admin/team` · SUPERADMIN** · **`POST /admin/team` · SUPERADMIN** — `{ name, phone, role }`.
**`PATCH /admin/team/:id/role` · SUPERADMIN** · **`DELETE /admin/team/:id` · SUPERADMIN** — oxirgi SUPERADMIN himoyalangan.

### 8.15 Audit log
- ⭐ **Yozish:** har xavfli admin amali `activity-log` (libs/common) ga yoziladi (kim, nima, resurs, eski→yangi, IP, vaqt).
- ◻︎ **`GET /admin/audit` · ADMIN** — filtr/qidiruv/eksport. Yozuvlar **immutable** (tahrir/o'chirish yo'q).

---

## 9. Webhook receiver (Elchi → Marketplace)

**`POST /webhooks/elchi` · public (imzo bilan himoyalangan)**
- Header: `X-Elchi-Signature: <hmac_sha256(body, WEBHOOK_SECRET)>`.
- Server **HMAC'ni tekshiradi** → mos emas `401`. **Timestamp oynasi** (masalan ±5 daqiqa) — replay himoya.
- **Idempotent:** `eventId` bo'yicha 2x kelsa — 1 marta qayta ishlanadi, ikkinchisi `200` (dedup).
```jsonc
// Elchi yuboradigan body (namuna)
{ "eventId":"evt_123","type":"shipment.status_changed","shipmentId":"77012",
  "externalOrderId":"55-3","status":"sold","codCollected":499000,"occurredAt":"2026-07-21T..." }
```
- Ta'sir: `sales_order_seller.status` mirror; `returned` → `inventory.inbound`; `delivered`+online → finance payout trigger (§9/§11 PRD).
- Javob: `200 { "received": true }` (envelope shart emas — Elchi sodda 2xx kutadi).

---

## 10. Rol → route matritsasi (qisqa)

| Route guruhi | public | SELLER | ADMIN | SUPERADMIN |
|---|:--:|:--:|:--:|:--:|
| `/auth/*` (register,login,refresh) | ✅ | — | — | — |
| `/categories` GET | ✅ | ✅ | ✅ | ✅ |
| `/sellers/me`, `/products/*`, `/inventory/*`, `/seller/*`, `/files/upload` | — | ✅ | — | — |
| `/admin/*` (dashboard, shops, users, orders ko'rish, kategoriya) | — | — | ✅ | ✅ |
| `/admin/finance/*`, `/admin/settings` PUT, `/admin/team/*`, `/admin/payments/providers`, rol/impersonate | — | — | ❌ | ✅ |
| `/webhooks/elchi` | ✅(HMAC) | — | — | — |

---

## 11. Rate-limit (default)
- Auth (`/auth/login`,`/register`,`/refresh`): **10 / daqiqa / IP** → oshsa `429 RATE_LIMITED`.
- Boshqa auth'li route: **120 / daqiqa / user**.
- Webhook: partner kaliti bo'yicha (Elchi tomon boshqaradi).

---

## 12. Payme Merchant API

**`POST /payments/payme/callback` · public (Basic auth bilan himoyalangan)**
- Header: `Authorization: Basic base64(Paycom:<provider-secret>)`.
- JSON-RPC 2.0 metodlari: `CheckPerformTransaction`, `CreateTransaction`,
  `PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement`.
- Summa Payme talabi bo‘yicha tiyinlarda yuboriladi; marketplace payment summasi
  bilan mos kelmasa `-31001` qaytariladi.
- `CreateTransaction`, `PerformTransaction` va `CancelTransaction` takroriy
  chaqirilganda mavjud holat qaytariladi (idempotent).
- Javob oddiy JSON-RPC formatida va har doim HTTP `200`; standart marketplace
  response envelope qo‘shilmaydi.

## 13. Click Merchant API

**`POST /payments/click/prepare` · public**
**`POST /payments/click/complete` · public**
- Click callback maydonlari `application/x-www-form-urlencoded` yoki JSON body orqali
  qabul qilinadi.
- `sign_string` Click protokoli bo‘yicha MD5 bilan tekshiriladi; `service_id`
  provider konfiguratsiyasidagi `merchantId`ga teng bo‘lishi kerak.
- `merchant_trans_id` sifatida marketplace `payment.id` (yoki `salesOrderId`)
  yuboriladi. Click summasi so‘mda va marketplace payment summasiga aynan teng
  bo‘lishi kerak.
- Prepare muvaffaqiyatli bo‘lsa `merchant_prepare_id`, Complete muvaffaqiyatli
  bo‘lsa `merchant_confirm_id` qaytariladi va payment `PAID` holatiga o‘tadi.
- Prepare va Complete takroriy chaqiriqlari idempotent; javob har doim HTTP `200`.
