# Elchi Marketplace — Texnik reja (PRD / single source of truth)

> **Maqsad.** Ko'p sotuvchili (multi-vendor) marketplace: istalgan odam self-service
> ro'yxatdan o'tib, sotuvchi kabinetida mahsulot joylaydi, ko'p omborli sklad/qoldiqni
> boshqaradi, online sotadi. Yetkazish **Elchi pochta** bilan **Partner API** orqali
> integratsiya qilingan — buyurtma Elchi'ga shipment sifatida uzatiladi, Elchi yetkazadi,
> statusni webhook orqali qaytaradi.
>
> **Bu ALOHIDA, mustaqil loyiha** — Elchi-Backend monorepo ICHIDA emas. O'z serveri, o'z
> DB'si, o'z git repo'si. Yagona bog'liqlik — versiyalangan HTTP kontrakt.
>
> **Maintenance rule.** Entity/pattern/enum/route/flow o'zgarsa — shu faylni ham yangilang.

Holat: **DRAFT** · Oxirgi yangilanish: 2026-07.
Kompaniyon: `../Elchi-Backend/docs/PARTNER_API.md` (Elchi tomonidagi integratsiya kontrakti).

---

## 0. Mundarija

1. [Qarorlar](#1-qarorlar) · 2. [Nega alohida loyiha](#2-nega-alohida-loyiha) ·
3. [Arxitektura](#3-arxitektura) · 4. [Servislar](#4-servislar) ·
5. [Ma'lumot modeli](#5-malumot-modeli) · 6. [Enumlar](#6-enumlar) ·
7. [State machine'lar](#7-state-machinelar) · 8. [Rezervatsiya oqimi](#8-rezervatsiya-oqimi) ·
9. [Checkout → Elchi shipment](#9-checkout--elchi-shipment) · 10. [To'lov (Payme/Click)](#10-tolov-paymeclick) ·
11. [Pul modeli (aralash)](#11-pul-modeli-aralash) · 12. [Sotuvchi onboarding](#12-sotuvchi-onboarding) ·
13. [API kontrakt](#13-api-kontrakt) · 14. [Frontendlar](#14-frontendlar) ·
15. [Fazalar](#15-fazalar) · 16. [Xavflar / ochiq savollar](#16-xavflar--ochiq-savollar) ·
17. [Non-goals](#17-non-goals)

---

## 1. Qarorlar

| # | Qaror | Tanlov |
|---|---|---|
| 1 | Model | Umumiy katalog **+** har sotuvchi alohida do'kon (slug) |
| 2 | To'lov | Online (Payme/Click) **+** COD |
| 3 | MVP birinchi | **Sotuvchi kabineti** |
| 4 | Sklad | Ko'p ombor **+** rezervatsiya |
| 5 | Stack | **Standalone NestJS mikroservis** monorepo (Elchi patterni) |
| 6 | Pul modeli | **Aralash:** online→marketplace escrow; COD→sotuvchiga (Elchi orqali) |
| 7 | Elchi ulanish | **Partner API + outbound webhook** (Elchi'da yangi, izolyatsiya) |

---

## 2. Nega alohida loyiha

- **Toza chegaralar:** marketplace domeni (do'kon/sklad/savat/to'lov) va Elchi domeni
  (dostavka) aralashmaydi. Har biri o'z bounded-context'i.
- **Mustaqil deploy/scale:** marketplace yuklamasi (Black Friday) Elchi production
  dostavkasiga xavf solmaydi.
- **Mustaqil rivojlanish:** ikki repo/jamoa bir-birini buzmaydi.
- **Bir xil ko'nikma:** Elchi'ning sinovdan o'tgan NestJS patternlari (`libs/common`:
  idempotency/outbox/activity-log/response-envelope) qayta ishlatiladi — noldan emas.

---

## 3. Arxitektura

```
┌──────────────────────────────────────────────┐        ┌──────────────────────────────┐
│  ELCHI MARKETPLACE (alohida server)          │        │  ELCHI POCHTA (mavjud)       │
│                                              │        │                              │
│  Storefront (Next.js)  Seller cabinet (React)│        │  API Gateway                 │
│            │                    │            │        │  order/logistics/finance/... │
│            └────────┬───────────┘            │        │                              │
│              API Gateway                     │ HTTPS  │  ┌ Partner API (YANGI) ─────┐ │
│                 │ RMQ (cmd)                  │ ─────► │  │ POST /partner/markets    │ │
│  identity  catalog  inventory  checkout      │ship-   │  │ POST /partner/shipments  │ │→ order.create
│  payment   finance  notification  search     │ment    │  │ GET/POST .../:id[/cancel]│ │
│                 │                            │        │  └ Outbound webhook ───────┘ │→ status push
│         elchi-integration (Partner API klient)◄────── │     (sold/cancel/returned)   │
│                                              │webhook └──────────────────────────────┘
│  Postgres (schema-per-service) · RabbitMQ ·  │
│  MinIO (media)                               │
└──────────────────────────────────────────────┘
```

Konvensiya (Elchi'dan): RMQ `{service}.{resource}.{action}`, `executeAndAck`,
`{statusCode,message,data}`, schema-per-service, JWT + RolesGuard.

---

## 4. Servislar

| Servis | Schema | Egalik | Vazifa |
|---|---|---|---|
| **api-gateway** | — | — | HTTP→RMQ, JWT/RBAC, storefront public, Elchi webhook receiver |
| **identity-service** | `identity` | `users` | Marketplace userlari: **seller / buyer / admin**; auth (JWT) |
| **catalog-service** | `catalog` | `shop`, `category`, `product`, `product_variant` | Do'kon, kategoriya, boy katalog, variant |
| **inventory-service** | `inventory` | `warehouse`, `stock`, `stock_movement`, `reservation`(+`_item`) | Ko'p ombor, qoldiq, jurnal, rezervatsiya |
| **checkout-service** | `checkout` | `cart`(+`_item`), `sales_order`(+`_seller`,+`_item`) | Savat, checkout, ko'p-sotuvchi split |
| **payment-service** | `payment` | `payment`, `payment_transaction`, `provider_config` | Payme/Click, escrow, refund |
| **finance-service** | `finance` | `seller_ledger`, `payout`, `commission` | Online escrow → sotuvchi payout, komissiya |
| **elchi-integration** | `integration` | `elchi_shipment`, `geo_cache` | Elchi Partner API klient; provision/shipment/webhook |
| **notification-service** | `notification` | `notification` | Seller/buyer'ga email/SMS/telegram/in-app |
| **search-service** | `search` | `search_document` | Storefront katalog qidiruv/filter (yoki Meilisearch) |
| **file-service** | — (MinIO) | — | Mahsulot media (ko'p rasm) |

> `identity`, `finance`, `notification`, `search`, `file` — Elchi'dagi bir nomdagi
> servislarga **o'xshash lekin ALOHIDA** (o'z DB, o'z userlari). Elchi bilan faqat
> `elchi-integration` gaplashadi.

---

## 5. Ma'lumot modeli

> Barchasi `BaseEntity` (id bigint, created_at, updated_at, isDeleted). Pul — `numeric(14,2)`.

### 5.1 catalog-service

**`shop`** — do'kon (storefront): `owner_user_id`(unique, seller), `name`, `slug`(unique),
`description`, `logo_url`, `banner_url`, `status`(`ShopStatus`), `phone`, `region_id`,
`district_id`, `address`, `rating`(numeric(3,2)), `orders_count`,
**`elchi_market_id`**(bigint,null — Elchi'da provision qilingandan keyin).

**`category`** — daraxt: `name`, `slug`(unique), `parent_id`(null), `icon_url`, `sort_order`, `is_active`.

**`product`**: `shop_id`, `owner_user_id`, `category_id`(null), `name`, `slug`, `description`(text),
`price`(numeric), `old_price`(null), `image_url`, `images`(jsonb `string[]`),
`attributes`(jsonb), `has_variants`(bool), `status`(`ProductStatus`).

**`product_variant`**: `product_id`, `sku`(unique), `name`("Qizil / M"), `attributes`(jsonb),
`price`(null→product.price), `old_price`, `barcode`, `image_url`, `is_active`.
> Variantsiz mahsulotga ham 1 ta "default" variant — sklad har doim `variant_id` bo'yicha.

### 5.2 inventory-service

**`warehouse`**: `owner_type`(`WarehouseOwnerType`: SHOP/HQ), `owner_id`(shop_id), `name`,
`region_id`, `district_id`, `address`, `is_default`, `is_active`.

**`stock`** — **Unique(`variant_id`,`warehouse_id`)**: `variant_id`, `warehouse_id`,
`quantity_on_hand`(int), `quantity_reserved`(int), `low_stock_threshold`(int).
> **Invariant:** `on_hand − reserved ≥ 0` (har doim; `check-inventory-invariant.ts`).

**`stock_movement`** — append-only jurnal: `stock_id`/`variant_id`/`warehouse_id`,
`type`(`StockMovementType`), `quantity`(signed), `on_hand_after`, `reserved_after`,
`reference_type`, `reference_id`, `reason`, `actor_id`.

**`reservation`**: `order_ref`(sales_order id, unique), `status`(`ReservationStatus`),
`expires_at`, `idempotency_key`. **`reservation_item`**: `reservation_id`, `variant_id`,
`warehouse_id`, `quantity`.

### 5.3 checkout-service

**`cart`**: `customer_id`(null=anon), `session_id`, `status`(active/converted/abandoned).
**`cart_item`**: `cart_id`, `product_id`, `variant_id`, `shop_id`, `quantity`, `unit_price_snapshot`.

**`sales_order`** — marketplace buyurtmasi (money source of truth): `customer_id`,
`status`(`SalesOrderStatus`), `payment_method`(`PaymentMethod`), `total_amount`,
`delivery_address`, `region_id`, `district_id`, `where_deliver`, `reservation_id`, `payment_id`.

**`sales_order_seller`** — har sotuvchiga sub-buyurtma (= Elchi shipment birligi):
`sales_order_id`, `shop_id`, `elchi_market_id`, `subtotal`, `cod_amount`,
**`elchi_shipment_id`**(null), `status`(`SalesOrderSellerStatus`).

**`sales_order_item`**: `sales_order_seller_id`, `product_id`, `variant_id`, `quantity`,
`unit_price`, `line_total`.

### 5.4 payment-service

**`payment`**: `sales_order_id`, `provider`(`PaymentProvider`), `amount`, `status`(`PaymentStatus`),
`external_txn_id`, `paid_at`. **`payment_transaction`**: `payment_id`, `provider_txn_id`,
`state`(int, Payme), `action`, `amount`, `raw`(jsonb). **`provider_config`**: `provider`,
`merchant_id`, `secret_encrypted`(AES), `is_active`.

### 5.5 finance-service (faqat online escrow puli)

**`seller_ledger`**: `shop_id`, `entry_type`(sale/commission/payout/refund/adjust), `amount`,
`balance_after`, `reference`. **`payout`**: `shop_id`, `amount`, `status`, `method`, `paid_at`.
**`commission`**: `shop_id`/`category_id`, `type`(`Commission_type`: percent/fixed), `value`.

### 5.6 elchi-integration

**`elchi_shipment`**: `sales_order_seller_id`, `elchi_shipment_id`, `elchi_market_id`,
`last_status`, `cod_collected`, `synced_at`. **`geo_cache`**: Elchi region/district ↔ nom.

---

## 6. Enumlar (`libs/common/enums`)

```ts
ShopStatus { PENDING, ACTIVE, SUSPENDED, REJECTED }
ProductStatus { DRAFT, ACTIVE, ARCHIVED, OUT_OF_STOCK }
WarehouseOwnerType { SHOP, HQ }
StockMovementType { INBOUND, OUTBOUND, RESERVE, RELEASE, COMMIT, ADJUST, TRANSFER }
ReservationStatus { HELD, COMMITTED, RELEASED, EXPIRED }
SalesOrderStatus { DRAFT, PENDING_PAYMENT, PAID, CONFIRMED, PARTIALLY_FULFILLED, FULFILLED, CANCELLED, REFUNDED }
SalesOrderSellerStatus { PENDING, SHIPMENT_CREATED, ON_THE_ROAD, DELIVERED, CANCELLED, RETURNED }
PaymentMethod { COD, PAYME, CLICK }
PaymentProvider { PAYME, CLICK }
PaymentStatus { CREATED, PENDING, PAID, CANCELLED, FAILED, REFUNDED }
Roles { SELLER, OPERATOR, BUYER, ADMIN, SUPERADMIN }
// OPERATOR — do'kon xodimi (sotuvchi tomonidan qo'shiladi, faqat o'z do'koniga scope)
Commission_type { PERCENT, FIXED }
```

---

## 7. State machine'lar

- **Shop:** `pending → active` (approve) · `pending → rejected` · `active ⇄ suspended`.
- **Product:** `draft → active` · `active → out_of_stock` (qoldiq 0, avtomat) · `→ archived`.
- **Reservation:** `held → committed` · `held → released` · `held → expired` (TTL) · `committed → released` (refund/qaytar).
- **SalesOrder:** `draft → pending_payment → paid → confirmed → (partially_)fulfilled`; istalgan → `cancelled`; `paid/confirmed → refunded`. **COD:** `draft → confirmed` (pending_payment o'tkazib yuboriladi).
- **SalesOrderSeller:** Elchi webhook statusini mirror qiladi (`shipment_created → on_the_road → delivered` | `cancelled` | `returned`).

---

## 8. Rezervatsiya oqimi

Oversell'ni imkonsiz qilish. Barchasi bitta tx, `libs/common` idempotency+outbox bilan.

**Patternlar:** `inventory.reserve` `{order_ref, items:[{variant_id, warehouse_id, quantity}], ttl_ms, idempotency_key}`,
`inventory.commit {order_ref}`, `inventory.release {order_ref, reason}`,
`inventory.inbound {variant_id, warehouse_id, quantity, reason}`, `inventory.adjust`.

```
RESERVE (checkout):  tx: har item SELECT ... FOR UPDATE; available=on_hand−reserved;
                     IF available<qty THROW; reserved+=qty; movement(reserve);
                     reservation(held, expires=now+ttl). Idempotent order_ref bo'yicha.
COMMIT (confirm):    on_hand−=qty; reserved−=qty; movement(commit); reservation=committed;
                     IF on_hand==0 → variant/product out_of_stock (event→catalog).
RELEASE (bekor/TTL): reserved−=qty; movement(release); reservation=released|expired.
SWEEPER (cron):      held & expires_at<now → release(expired).
QAYTGAN TOVAR:       Elchi webhook 'returned' → inventory.inbound (on_hand tiklanadi).
```

---

## 9. Checkout → Elchi shipment

Ko'p sotuvchili savat → har sotuvchiga **alohida Elchi shipment**.

```
Buyurtma berish → checkout.create {cart_id, address, region, district, where_deliver, payment_method}
1. cart_item'lar shop_id bo'yicha guruhlanadi → N ta sales_order_seller
2. sales_order (online→pending_payment | COD→draft) + sub-order + item yoziladi
3. inventory.reserve {order_ref=sales_order_id, ttl=30daq}
4. payment_method:
     COD    → confirmSalesOrder()  (to'lovsiz)
     online → payment.create → xaridor to'lov sahifasi → payment.paid event → confirmSalesOrder()

confirmSalesOrder():
   har sales_order_seller uchun:
     elchi-integration → POST /partner/shipments {
        external_order_id: seller.id,
        elchi_market_id:   shop.elchi_market_id,     // §12 provisioning
        customer:{name,phone}, address, region_id, district_id, where_deliver,
        items:[{name, quantity}],
        cod_amount: (online ? 0 : seller.subtotal)   // 0=prepaid, kuryer pul yig'maydi
     } → {shipment_id} → seller.elchi_shipment_id
   inventory.commit {order_ref=sales_order_id}
   sales_order = confirmed
   notification → sotuvchi(lar) + xaridor

Elchi webhook (status_changed) → elchi-integration → sales_order_seller status yangilanadi
   'returned' → inventory.inbound;  'delivered' + online → finance payout trigger
```

**Muhim:** har sotuvchi = alohida Elchi shipment = alohida posilka. Elchi ichida
region bo'yicha filialga yo'nalish **avtomat** (marketplace bilmaydi).

---

## 10. To'lov (Payme/Click)

`payment-service`, cred **AES-encrypted**, tashqi URL **SSRF-guard**.

- **Payme (JSON-RPC Merchant API):** `POST /payments/payme/callback` (Basic auth). Metodlar:
  `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`,
  `CheckTransaction`, `GetStatement`. `state` → `payment_transaction`.
- **Click (Prepare/Complete):** `POST /payments/click/prepare` + `/complete`, `sign_string` (md5).
- **Success:** `Perform`(Payme)/`Complete`(Click) → `payment.paid` event → `confirmSalesOrder()` (§9).
- **Refund/bekor:** `CancelTransaction` yoki Elchi `returned` → `payment.refund` + `inventory.inbound`.

---

## 11. Pul modeli (aralash)

| Yo'l | Pul yig'ish | Sotuvchiga to'lov | Komissiya |
|---|---|---|---|
| **Online** | Marketplace (Payme/Click escrow) | Marketplace `finance` payout (`delivered` dan keyin) | Payout'dan ushlanadi |
| **COD** | Elchi kuryer | **Elchi** to'g'ridan per-seller Elchi market akkauntiga (mavjud settlement) | ⚠️ §16.1 (davriy invoys / netting) |

- Online: shipment `cod_amount=0` (prepaid). Elchi faqat yetkazadi.
- COD: shipment `cod_amount=subtotal`. Elchi'ning mavjud COD settlement'i o'zgarishsiz.
- Marketplace `seller_ledger` har ikkala yo'lni ham hisobga oladi (COD — reconciliation
  uchun Elchi `shipment.settled` webhook'idan).

---

## 12. Sotuvchi onboarding

```
1. Public: POST /sellers/register {name, phone, password, shop_name, region_id}
     → identity: user(role=seller, inactive) + catalog: shop(status=pending)
     → notification → admin
2. Admin: POST /admin/shops/:id/approve
     → user.active, shop.active
     → inventory: default warehouse
     → elchi-integration: POST /partner/markets → shop.elchi_market_id saqlanadi
3. Seller login → seller-cabinet.  (approve'gacha storefront'da ko'rinmaydi)
```

### 12.1 Market operatorlari (do'kon xodimlari)

Har do'kon (market) uchun **operatorlar** — sotuvchining xodimlari, buyurtmalarni
tasdiqlaydi va ular ustida ishlaydi (kelgusida katalog/qoldiq ham).

```
1. Sotuvchi (owner) operator qo'shadi: POST /sellers/operators {name, phone, password}
     → identity: user(role=OPERATOR, shop_id=owner.shop, active)
2. Operator login → seller-cabinet (faqat o'z do'koni ma'lumoti — scope shop_id bo'yicha)
3. Operator buyurtmalarni ko'radi/tasdiqlaydi/holatini yangilaydi (o'z do'koni);
   boshqa do'kon → 403.
```

- **Scope:** operator `shop_id` do'kon egasining do'koniga bog'lanadi (identity `user.shop_id`).
  Har seller-scope so'rov owner **yoki** shu shopning operatori uchun ochiladi.
- **Ruxsat (MVP):** buyurtmalar (ko'rish/tasdiqlash/holat) + o'qish. ◻︎ Keyin: katalog/qoldiq,
  granular ruxsat (permission matritsasi).
- Owner operatorlarni CRUD qiladi (qo'shish/o'chirish/faollashtirish); operator o'zini o'chira olmaydi.

### 12.2 Xaridor (buyer)

- **Guest:** ro'yxatsiz, telefon bo'yicha lightweight buyer (checkout'da `identity.customer.create`).
- **Ro'yxatdan o'tgan buyer:** `POST /auth/register` (role=BUYER, default) + `POST /auth/login`;
  "Hisobim" + "Mening buyurtmalarim" (telefon/akkaunt bo'yicha). Storefront ikkalasini ham qo'llaydi.

---

## 13. API kontrakt (MVP — sotuvchi kabineti)

| Metod | Route | Rol | Izoh |
|---|---|---|---|
| POST | `/sellers/register` | public | user(seller)+shop(pending) |
| GET/PATCH | `/sellers/me` | seller | shop profil |
| GET | `/categories` | public | daraxt |
| POST/GET | `/products`, `/products/my` | seller | boy product CRUD |
| POST/PATCH | `/products/:id/variants[/:vid]` | seller | variant |
| GET/POST | `/inventory/warehouses` | seller | ombor |
| GET | `/inventory/stock`, `/inventory/stock/low` | seller | qoldiq |
| POST | `/inventory/stock/inbound`, `/adjust` | seller | kirim/tuzatish |
| GET | `/seller/orders` | seller/operator | o'z do'koni buyurtmalari (Elchi status bilan) |
| PATCH | `/seller/orders/:id` | seller/operator | buyurtmani tasdiqlash/holat yangilash |
| GET/POST/DELETE | `/sellers/operators[/:id]` | seller | operator (do'kon xodimi) CRUD |
| GET | `/seller/dashboard` | seller | sotuv/daromad |
| POST | `/auth/register`, `/auth/login` | public | xaridor (BUYER) ro'yxat/kirish |
| GET | `/buyer/orders` | buyer | mening buyurtmalarim |
| GET | `/admin/dashboard` | admin | platforma sanoqlari |
| GET | `/admin/users`, `/admin/users/:id` | admin | account ko'rish |
| POST | `/admin/users/:id/block\|unblock` | admin | bloklash |
| GET/POST | `/admin/shops`, `/admin/shops/:id/approve\|reject\|suspend\|activate` | admin | do'kon moderatsiya |
| GET | `/admin/orders`, `/admin/orders/:id` | admin | hamma buyurtma (ko'rish) |
| GET/POST/PATCH/DELETE | `/admin/categories` | admin | kategoriya daraxt |
| — | `/admin/finance/*`, `/admin/payments/*`, `/admin/settings`, `/admin/team/*` | **superadmin** | moliya/sozlama/jamoa (Faza 3-4) |

> **Admin/back-office to'liq spec:** `ADMIN_TZ.md` (rollar, 15 domen, MVP ajratmasi),
> endpoint shakllari `API_CONTRACT.md §8`. ⭐ MVP = dashboard/shops/users/orders(ko'rish)/kategoriya + audit yozish.

**Faza 2:** `/storefront/*`, `/cart/*`, `POST /checkout`. **Faza 3:** `/payments/*`.
**Webhook:** `POST /webhooks/elchi` (Elchi'dan status; HMAC verify).

---

## 14. Frontendlar

| App | Stack | Auditoriya | Faza |
|---|---|---|---|
| **seller-cabinet** | React SPA (React 19 + antd + RTK + react-query) | Sotuvchi | **1 (MVP)** |
| **storefront** | Next.js (SSR/SEO) | Xaridor | 2 |
| **admin** | seller-cabinet **ichida** (ADMIN role, alohida bo'lim — alohida app emas) | Moderatsiya | 1-2 |

> **Tamoyil (qaror 2026-07):** framework ekranning vazifasiga qarab tanlanadi — **SEO
> kerakmi yoki yo'q**. Ochiq storefront (Google'dan organik trafik) → **Next.js (SSR/SEO)**.
> Login ortidagi panellar (cabinet + admin, SEO shart emas) → **React SPA (Vite + antd)**,
> bir xil komponent/theme'ni ulashadi. Ya'ni 3 xil tex emas — 2 profil: SPA (ichki) + Next
> (ochiq). Admin — alohida app emas, cabinet ichida ADMIN-role bo'lim (o'sganda ajratiladi).

---

## 15. Fazalar

| Faza | Ish | Qabul mezoni |
|---|---|---|
| **0. Skelet + poydevor** | Monorepo (nest-cli, libs/common ko'chirish), identity(seller/buyer/admin), catalog entity, inventory-service | `reserve→commit→release` testlari yashil; oversell imkonsiz |
| **1. Sotuvchi kabineti + admin MVP** ⭐ | register→approve; product+variant+media; inventory route; seller order/dashboard; **elchi-integration provision (`/partner/markets`)**; **admin MVP: dashboard/shops/users/orders(ko'rish)/kategoriya + audit yozish** (`ADMIN_TZ.md §8`) | Sotuvchi ro'yxatdan o'tadi→approve→mahsulot+qoldiq qo'shadi; Elchi'da market akkaunt; **admin do'kon tasdiqlaydi + hamma buyurtmani ko'radi** |
| **2. Storefront + checkout** | Public katalog/qidiruv; cart; checkout split; **`/partner/shipments`** ko'prik; webhook receiver | 2 sotuvchidan savat → checkout → Elchi'da 2 shipment; qoldiq kamayadi; webhook status yangilaydi |
| **3. Online to'lov** | payment-service Payme+Click; `payment.paid`→confirm; finance escrow payout+komissiya | Payme sandbox → shipment avtomat (prepaid); refund→qoldiq qaytadi |
| **4. Sayqal** | Review/rating, qaytarish/refund UI, COD komissiya reconciliation, moderatsiya, analytics | Sharh; payout hisobot; COD komissiya undiriladi |

**Elchi tomonida parallel:** `PARTNER_API.md` §7 (Partner API + webhook) — Faza 1-2 uchun kerak.

---

## 16. Xavflar / ochiq savollar

1. **COD komissiya** — pul to'g'ridan sotuvchiga (Elchi orqali) ketganda marketplace komissiyani
   qanday undiradi? (a) davriy invoys, (b) online payout'dan netting, (c) Elchi ushlab beradi
   (recoupling — tavsiya etilmaydi). *MVP: (a)/(b).*
2. **Guest checkout** — buyer ro'yxatsiz sotib olsinmi? (telefon bo'yicha lightweight buyer).
3. **Dostavka narxi** — kim to'laydi (buyer/seller/split), storefront'da qanday ko'rsatiladi;
   ko'p-sotuvchili savatda har posilkaga alohida.
4. **Geo moslashuv** — marketplace manzili → Elchi region/district id (elchi-integration geo_cache sync).
5. **Katalog Elchi'da** — Elchi shipment `items` faqat nom/qty (Elchi'da katalog shart emas);
   `OrderItem.product_id` majburiyligini kichik moslash kerak (`PARTNER_API.md` §3.3).
6. **Search** — mavjud pattern yetarlimi yoki Meilisearch/Elastic (facet/filter uchun).
7. **Media** — bir mahsulotga ko'p rasm (MinIO/S3).
8. **payment-service vs integration** — alohida (tavsiya, o'z state machine'i).

---

## 17. Non-goals (MVP)

- Chat (buyer↔seller), promo-kod/kupon, sodiqlik dasturi, reklama/promoted listing, recommendation.
- Ko'p valyuta / xalqaro yetkazish. Sotuvchi mobil ilova (faqat web). Avtomatik import (CSV/1C).
- Elchi'dan boshqa dostavka provayderlari (kelajakda `*-integration` qo'shsa bo'ladi).
