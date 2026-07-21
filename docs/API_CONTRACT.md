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
- Public route'lardan tashqari hammasi shu header'ni talab qiladi. Yo'q/muddati o'tган → `401`.
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
- `sort` = `maydon:asc|desc`. Ruxsat etilган maydonlar har endpoint'da.
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
- Access muddati o'tса → `POST /auth/refresh {refreshToken}` → **yangi juftlik**; eski refresh **bekor** qilinadi (rotation).
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
- **Eslatma:** `isActive=false` — approve'gacha faqat kabinetга kiradi, storefront'da ko'rinmaydi.

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
- `slug`, `status`, `elchiMarketId`, `rating` — **tahrir qilib bo'lmaydi** (server boshqaradi). Yuborilса — e'tiborsiz yoki `400`.
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
- `shopId`/`ownerUserId` — **body'dan olinmaydi**, token'dan (`shopId`). Yuborilса e'tiborsiz.
- Dublikat slug (shop ichida) → `409`.

**`PATCH /products/:id` · SELLER** — yuqoridagi maydonlar (barchasi ixtiyoriy). O'zganiki → `403`.
**`DELETE /products/:id` · SELLER** — soft-delete (`isDeleted=true`). → `204`-ma'noli.

### 5.3 Variantlar
> Variantsiz mahsulotга ham server **1 ta default variant** yaratadi (sklad `variantId` bo'yicha).

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
- `quantity` > 0. Yangi (variant,warehouse) juftligi bo'lса — stock qatori avtomat yaratiladi.

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

## 8. Admin — shops moderatsiya

**`GET /admin/shops` · ADMIN** — pagination. Query: `status(ShopStatus)?, search?`.
**`POST /admin/shops/:id/approve` · ADMIN**
```jsonc
// Request: bo'sh yoki { "note":"..." }
// 200 data: { shop: {...status:"ACTIVE", elchiMarketId:"9001"} }
```
- Ketma-ketlik (§12): `user.active` + `shop.active` + default warehouse + Elchi `POST /partner/markets` → `elchiMarketId`.
- `PENDING` emas shopni approve → `409 INVALID_STATE`.
- Elchi provision xato → tranzaksiya rollback, `shop` `PENDING` qoladi, `502`-ma'noli xato (`errorCode: BUSINESS_RULE_VIOLATION`, message = sabab).

**`POST /admin/shops/:id/reject` · ADMIN** — `{ "reason":"..." }` (majburiy) → `shop.REJECTED` + notify.
**`POST /admin/shops/:id/suspend` · ADMIN** (Faza 4) — `active → suspended`, mahsulotlari storefront'da yashirinadi.

---

## 9. Webhook receiver (Elchi → Marketplace)

**`POST /webhooks/elchi` · public (imzo bilan himoyalangan)**
- Header: `X-Elchi-Signature: <hmac_sha256(body, WEBHOOK_SECRET)>`.
- Server **HMAC'ni tekshiradi** → mos emas `401`. **Timestamp oynasi** (masalan ±5 daqiqa) — replay himoya.
- **Idempotent:** `eventId` bo'yicha 2x kelса — 1 marta qayta ishlanadi, ikkinchisi `200` (dedup).
```jsonc
// Elchi yuboradigan body (namuna)
{ "eventId":"evt_123","type":"shipment.status_changed","shipmentId":"77012",
  "externalOrderId":"55-3","status":"sold","codCollected":499000,"occurredAt":"2026-07-21T..." }
```
- Ta'sir: `sales_order_seller.status` mirror; `returned` → `inventory.inbound`; `delivered`+online → finance payout trigger (§9/§11 PRD).
- Javob: `200 { "received": true }` (envelope shart emas — Elchi sodda 2xx kutadi).

---

## 10. Rol → route matritsasi (qisqa)

| Route guruhi | public | SELLER | ADMIN |
|---|:--:|:--:|:--:|
| `/auth/*` (register,login,refresh) | ✅ | — | — |
| `/categories` GET | ✅ | ✅ | ✅ |
| `/sellers/me`, `/products/*`, `/inventory/*`, `/seller/*`, `/files/upload` | — | ✅ | — |
| `/admin/*` | — | — | ✅ |
| `/webhooks/elchi` | ✅(HMAC) | — | — |

---

## 11. Rate-limit (default)
- Auth (`/auth/login`,`/register`,`/refresh`): **10 / daqiqa / IP** → oshsa `429 RATE_LIMITED`.
- Boshqa auth'li route: **120 / daqiqa / user**.
- Webhook: partner kaliti bo'yicha (Elchi tomon boshqaradi).

---

## 12. Keyingi fazalar (placeholder — hozir yozilmaydi)
- **Faza 2:** `GET /storefront/products|shops/:slug`, `/cart/*`, `POST /checkout` (split, reserve).
- **Faza 3:** `POST /payments/payme/callback` (JSON-RPC), `/payments/click/prepare|complete`.
- Ular boshlanganда shu faylga §13/§14 bo'lib qo'shiladi (bir xil konvensiya).
