# Elchi Marketplace — DB sxema (servis bo'yicha)

## Topologiya qarori (hozircha): 1 Postgres + 9 schema

**1 ta PostgreSQL instance**, har mikroservis uchun **alohida SCHEMA** (bounded context).
Fizik alohida DB'lar EMAS — 3 kishilik jamoa + MVP uchun schema-per-service eng qulay va
xavfsiz o'rta yo'l. Batafsil sabab va qachon fizik bo'lishga o'tish: `../adr/0001-database-topology.md`.

- **Servis ICHIDAGI** bog'lanishlar = **haqiqiy FK** (drawSQL chizadi).
- **Boshqa servisga** havolalar = oddiy `BIGINT` ustun, izohda `→ servis.jadval.id (external, logical)`.
  Bu real prod'da ham fizik FK EMAS — application darajasida (API/event) bog'lanadi.
- **Xavfsizlik:** har servisga alohida DB user, faqat o'z schema'siga ruxsat
  (`00-bootstrap.sql`). Payment buzilsa ham identity jadvalini o'qiy olmaydi.

Shu bois har servis uchun **alohida drawSQL diagramma** (har fayl faqat o'z jadvallarini oladi).

## O'rnatish tartibi (real baza)
1. `00-bootstrap.sql` — database, 9 schema, har servisga least-privilege user (migrator sifatida).
2. `01-identity.sql … 09-search.sql` — jadval DDL'lari, har biri mos schema'da.

## drawSQL'ga yuklash
Har fayl uchun alohida: drawSQL → **New Diagram → Import → PostgreSQL** → tegishli `NN-*.sql`.
(`00-bootstrap.sql` drawSQL uchun emas — uni import qilmang.)

| # | Fayl | Servis | Jadvallar |
|---|---|---|---|
| 00 | `00-bootstrap.sql` | — | database + 9 schema + user/grant (drawSQL emas) |
| 01 | `01-identity.sql` | identity | users |
| 02 | `02-catalog.sql` | catalog | shop, category, product, product_variant |
| 03 | `03-inventory.sql` | inventory | warehouse, stock, stock_movement, reservation, reservation_item |
| 04 | `04-checkout.sql` | checkout | cart, cart_item, sales_order, sales_order_seller, sales_order_item |
| 05 | `05-payment.sql` | payment | payment, payment_transaction, provider_config |
| 06 | `06-finance.sql` | finance | seller_ledger, payout, commission |
| 07 | `07-integration.sql` | integration | elchi_shipment, geo_cache |
| 08 | `08-notification.sql` | notification | notification |
| 09 | `09-search.sql` | search | search_document |

> Bitta katta (hamma servis birga) diagramma kerak bo'lsa — `../schema.sql`.

## Servislararo bog'lanishlar xaritasi (logical — event/API orqali)

| Manba (ustun) | Maqsad |
|---|---|
| catalog.shop.owner_user_id | identity.users.id |
| catalog.product.owner_user_id | identity.users.id |
| inventory.warehouse.owner_id | catalog.shop.id (SHOP holatida) |
| inventory.stock.variant_id | catalog.product_variant.id |
| inventory.reservation_item.variant_id | catalog.product_variant.id |
| inventory.reservation.order_ref | checkout.sales_order.id |
| checkout.cart.customer_id | identity.users.id |
| checkout.cart_item.product_id / variant_id / shop_id | catalog.* |
| checkout.sales_order.customer_id | identity.users.id |
| checkout.sales_order.reservation_id | inventory.reservation.id |
| checkout.sales_order.payment_id | payment.payment.id |
| checkout.sales_order_seller.shop_id | catalog.shop.id |
| checkout.sales_order_seller.elchi_shipment_id | integration.elchi_shipment.id |
| checkout.sales_order_item.product_id / variant_id | catalog.* |
| payment.payment.sales_order_id | checkout.sales_order.id |
| finance.seller_ledger / payout / commission . shop_id | catalog.shop.id |
| finance.commission.category_id | catalog.category.id |
| integration.elchi_shipment.sales_order_seller_id | checkout.sales_order_seller.id |
| notification.notification.user_id | identity.users.id |
| search.search_document.product_id / shop_id / category_id | catalog.* |

> To'liq ustun izohlari: `MARKETPLACE_PLAN.md §5`.
