-- ============================================================================
-- Elchi Marketplace — Database Schema (PostgreSQL DDL)
-- ============================================================================
-- drawSQL'ga import: drawSQL → New Diagram → Import → PostgreSQL → shu faylni yuklang.
--
-- MUHIM: Real arxitektura = SCHEMA-PER-SERVICE (har mikroservisning ALOHIDA DB/schema'si).
--   • Bitta servis ichidagi FK'lar = HAQIQIY (fizik foreign key).
--   • Servislar ORASIDAGI bog'lanishlar = MANTIQIY (application darajasida, kodda tekshiriladi),
--     fizik FK EMAS. Bu yerda ular faqat ERD'da chiziq chizilishi uchun qo'shilgan
--     (fayl oxiridagi "CROSS-SERVICE (logical)" bo'limi). Prod'da ularni yaratMANG.
--
-- Servislar (schema): identity, catalog, inventory, checkout, payment, finance,
--   integration, notification, search.
-- Pul: NUMERIC(14,2). ID: BIGSERIAL. Vaqt: TIMESTAMPTZ. Soft-delete: is_deleted.
-- To'liq izoh: MARKETPLACE_PLAN.md §5.
-- ============================================================================


-- ############################################################################
-- # identity
-- ############################################################################

-- Marketplace foydalanuvchilari: seller / buyer / admin (Elchi user'idan ALOHIDA)
CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    role            VARCHAR(20)  NOT NULL,               -- SELLER | BUYER | ADMIN | SUPERADMIN
    name            VARCHAR(255) NOT NULL,
    phone           VARCHAR(20)  NOT NULL UNIQUE,
    email           VARCHAR(255),
    password_hash   VARCHAR(255) NOT NULL,
    avatar_url      VARCHAR(500),
    is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE
);


-- ############################################################################
-- # catalog
-- ############################################################################

-- Do'kon (storefront) — har sotuvchining bitta do'koni
CREATE TABLE shop (
    id              BIGSERIAL PRIMARY KEY,
    owner_user_id   BIGINT       NOT NULL UNIQUE REFERENCES users(id),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    logo_url        VARCHAR(500),
    banner_url      VARCHAR(500),
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING | ACTIVE | SUSPENDED | REJECTED
    phone           VARCHAR(20),
    region_id       BIGINT,                              -- Elchi region id (geo_cache)
    district_id     BIGINT,                              -- Elchi district id (geo_cache)
    address         TEXT,
    rating          NUMERIC(3,2) NOT NULL DEFAULT 0,
    orders_count    INTEGER      NOT NULL DEFAULT 0,
    elchi_market_id BIGINT,                              -- Elchi'da provision qilingan market id (logical)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE
);

-- Kategoriya daraxti (self-referencing)
CREATE TABLE category (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    parent_id       BIGINT       REFERENCES category(id),  -- null = ildiz
    icon_url        VARCHAR(500),
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Mahsulot (boy katalog)
CREATE TABLE product (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT       NOT NULL REFERENCES shop(id),
    owner_user_id   BIGINT       NOT NULL REFERENCES users(id),
    category_id     BIGINT       REFERENCES category(id),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL,
    description     TEXT,
    price           NUMERIC(14,2) NOT NULL,
    old_price       NUMERIC(14,2),
    image_url       VARCHAR(500),
    images          JSONB        NOT NULL DEFAULT '[]',   -- string[] (ko'p rasm)
    attributes      JSONB        NOT NULL DEFAULT '{}',
    has_variants    BOOLEAN      NOT NULL DEFAULT FALSE,
    status          VARCHAR(20)  NOT NULL DEFAULT 'DRAFT', -- DRAFT | ACTIVE | ARCHIVED | OUT_OF_STOCK
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE,
    UNIQUE (shop_id, slug)
);

-- Mahsulot varianti (rang/o'lcham). Variantsizga ham 1 ta "default" variant.
CREATE TABLE product_variant (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT       NOT NULL REFERENCES product(id),
    sku             VARCHAR(100) NOT NULL UNIQUE,
    name            VARCHAR(255),                        -- "Qizil / M"
    attributes      JSONB        NOT NULL DEFAULT '{}',
    price           NUMERIC(14,2),                       -- null → product.price
    old_price       NUMERIC(14,2),
    barcode         VARCHAR(100),
    image_url       VARCHAR(500),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ############################################################################
-- # inventory
-- ############################################################################

-- Ombor (ko'p ombor). owner_type: SHOP → owner_id=shop.id; HQ → markaziy.
CREATE TABLE warehouse (
    id              BIGSERIAL PRIMARY KEY,
    owner_type      VARCHAR(10)  NOT NULL DEFAULT 'SHOP', -- SHOP | HQ
    owner_id        BIGINT       NOT NULL,                -- polymorphic (SHOP→shop.id); logical
    name            VARCHAR(255) NOT NULL,
    region_id       BIGINT,
    district_id     BIGINT,
    address         TEXT,
    is_default      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Qoldiq: har variant × ombor uchun bitta qator. Invariant: on_hand - reserved >= 0.
CREATE TABLE stock (
    id                  BIGSERIAL PRIMARY KEY,
    variant_id          BIGINT   NOT NULL REFERENCES product_variant(id),
    warehouse_id        BIGINT   NOT NULL REFERENCES warehouse(id),
    quantity_on_hand    INTEGER  NOT NULL DEFAULT 0,
    quantity_reserved   INTEGER  NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER  NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (variant_id, warehouse_id)
);

-- Sklad harakatlari jurnali (append-only, audit)
CREATE TABLE stock_movement (
    id              BIGSERIAL PRIMARY KEY,
    stock_id        BIGINT       NOT NULL REFERENCES stock(id),
    variant_id      BIGINT       NOT NULL,               -- denormalizatsiya (tez o'qish)
    warehouse_id    BIGINT       NOT NULL,
    type            VARCHAR(20)  NOT NULL,               -- INBOUND|OUTBOUND|RESERVE|RELEASE|COMMIT|ADJUST|TRANSFER
    quantity        INTEGER      NOT NULL,               -- signed (+/-)
    on_hand_after   INTEGER      NOT NULL,
    reserved_after  INTEGER      NOT NULL,
    reference_type  VARCHAR(30),                         -- sales_order | manual | return ...
    reference_id    BIGINT,
    reason          TEXT,
    actor_id        BIGINT,                              -- kim (users.id) — logical
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Rezervatsiya (buyurtma uchun qoldiq band qilish)
CREATE TABLE reservation (
    id              BIGSERIAL PRIMARY KEY,
    order_ref       BIGINT       NOT NULL UNIQUE,        -- sales_order.id (cross-service, logical)
    status          VARCHAR(15)  NOT NULL DEFAULT 'HELD', -- HELD | COMMITTED | RELEASED | EXPIRED
    expires_at      TIMESTAMPTZ,
    idempotency_key VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE reservation_item (
    id              BIGSERIAL PRIMARY KEY,
    reservation_id  BIGINT   NOT NULL REFERENCES reservation(id),
    variant_id      BIGINT   NOT NULL REFERENCES product_variant(id),
    warehouse_id    BIGINT   NOT NULL REFERENCES warehouse(id),
    quantity        INTEGER  NOT NULL
);


-- ############################################################################
-- # checkout
-- ############################################################################

-- Savat (anon yoki logged buyer)
CREATE TABLE cart (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT       REFERENCES users(id),   -- null = anonim
    session_id      VARCHAR(255),
    status          VARCHAR(15)  NOT NULL DEFAULT 'active', -- active | converted | abandoned
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE cart_item (
    id                  BIGSERIAL PRIMARY KEY,
    cart_id             BIGINT   NOT NULL REFERENCES cart(id),
    product_id          BIGINT   NOT NULL REFERENCES product(id),
    variant_id          BIGINT   NOT NULL REFERENCES product_variant(id),
    shop_id             BIGINT   NOT NULL REFERENCES shop(id),
    quantity            INTEGER  NOT NULL,
    unit_price_snapshot NUMERIC(14,2) NOT NULL
);

-- Marketplace buyurtmasi (pul source of truth)
CREATE TABLE sales_order (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT       NOT NULL REFERENCES users(id),
    status          VARCHAR(25)  NOT NULL DEFAULT 'DRAFT', -- DRAFT|PENDING_PAYMENT|PAID|CONFIRMED|PARTIALLY_FULFILLED|FULFILLED|CANCELLED|REFUNDED
    payment_method  VARCHAR(10)  NOT NULL,               -- COD | PAYME | CLICK
    total_amount    NUMERIC(14,2) NOT NULL,
    delivery_address TEXT,
    region_id       BIGINT,
    district_id     BIGINT,
    where_deliver   VARCHAR(10)  NOT NULL DEFAULT 'ADDRESS', -- CENTER | ADDRESS
    reservation_id  BIGINT,                              -- reservation.id (cross-service, logical)
    payment_id      BIGINT,                              -- payment.id (cross-service, logical)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Har sotuvchiga sub-buyurtma (= bitta Elchi shipment birligi)
CREATE TABLE sales_order_seller (
    id                BIGSERIAL PRIMARY KEY,
    sales_order_id    BIGINT       NOT NULL REFERENCES sales_order(id),
    shop_id           BIGINT       NOT NULL REFERENCES shop(id),
    elchi_market_id   BIGINT,                            -- shop.elchi_market_id nusxasi
    subtotal          NUMERIC(14,2) NOT NULL,
    cod_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 0 = prepaid (online), >0 = COD
    elchi_shipment_id BIGINT,                            -- elchi_shipment.id (cross-service, logical)
    status            VARCHAR(20)  NOT NULL DEFAULT 'PENDING', -- PENDING|SHIPMENT_CREATED|ON_THE_ROAD|DELIVERED|CANCELLED|RETURNED
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE sales_order_item (
    id                    BIGSERIAL PRIMARY KEY,
    sales_order_seller_id BIGINT   NOT NULL REFERENCES sales_order_seller(id),
    product_id            BIGINT   NOT NULL REFERENCES product(id),
    variant_id            BIGINT   NOT NULL REFERENCES product_variant(id),
    quantity              INTEGER  NOT NULL,
    unit_price            NUMERIC(14,2) NOT NULL,
    line_total            NUMERIC(14,2) NOT NULL
);


-- ############################################################################
-- # payment
-- ############################################################################

CREATE TABLE payment (
    id              BIGSERIAL PRIMARY KEY,
    sales_order_id  BIGINT       NOT NULL,               -- sales_order.id (cross-service, logical)
    provider        VARCHAR(10)  NOT NULL,               -- PAYME | CLICK
    amount          NUMERIC(14,2) NOT NULL,
    status          VARCHAR(15)  NOT NULL DEFAULT 'CREATED', -- CREATED|PENDING|PAID|CANCELLED|FAILED|REFUNDED
    external_txn_id VARCHAR(255),
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE payment_transaction (
    id              BIGSERIAL PRIMARY KEY,
    payment_id      BIGINT       NOT NULL REFERENCES payment(id),
    provider_txn_id VARCHAR(255),
    state           INTEGER,                             -- Payme state (1,2,-1,-2 ...)
    action          VARCHAR(50),
    amount          NUMERIC(14,2),
    raw             JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE provider_config (
    id                BIGSERIAL PRIMARY KEY,
    provider          VARCHAR(10)  NOT NULL,             -- PAYME | CLICK
    merchant_id       VARCHAR(255),
    secret_encrypted  TEXT,                              -- AES-encrypted
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ############################################################################
-- # finance (faqat online escrow puli)
-- ############################################################################

CREATE TABLE seller_ledger (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT       NOT NULL,               -- shop.id (cross-service, logical)
    entry_type      VARCHAR(15)  NOT NULL,               -- sale | commission | payout | refund | adjust
    amount          NUMERIC(14,2) NOT NULL,              -- signed
    balance_after   NUMERIC(14,2) NOT NULL,
    reference_type  VARCHAR(30),
    reference_id    BIGINT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE payout (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT       NOT NULL,               -- shop.id (cross-service, logical)
    amount          NUMERIC(14,2) NOT NULL,
    status          VARCHAR(15)  NOT NULL DEFAULT 'PENDING',
    method          VARCHAR(30),
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE commission (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT,                              -- shop.id (logical) — null = global
    category_id     BIGINT,                              -- category.id (logical) — null = barcha
    type            VARCHAR(10)  NOT NULL DEFAULT 'PERCENT', -- PERCENT | FIXED
    value           NUMERIC(14,2) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ############################################################################
-- # integration (Elchi Partner API klient)
-- ############################################################################

CREATE TABLE elchi_shipment (
    id                    BIGSERIAL PRIMARY KEY,
    sales_order_seller_id BIGINT       NOT NULL,         -- sales_order_seller.id (cross-service, logical)
    elchi_shipment_id     BIGINT,                        -- Elchi'dagi order/shipment id
    elchi_market_id       BIGINT,
    last_status           VARCHAR(30),                   -- received|on the road|sold|returned_to_market ...
    cod_collected         NUMERIC(14,2) NOT NULL DEFAULT 0,
    tracking_url          VARCHAR(500),
    synced_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Elchi region/district ↔ nom keshi (manzilni Elchi geo id'ga moslash)
CREATE TABLE geo_cache (
    id              BIGSERIAL PRIMARY KEY,
    type            VARCHAR(10)  NOT NULL,               -- region | district
    elchi_id        BIGINT       NOT NULL,
    name            VARCHAR(255) NOT NULL,
    parent_elchi_id BIGINT,                              -- district → region id
    synced_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (type, elchi_id)
);


-- ############################################################################
-- # notification
-- ############################################################################

CREATE TABLE notification (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT       NOT NULL,               -- users.id (cross-service, logical)
    channel         VARCHAR(15)  NOT NULL DEFAULT 'in_app', -- in_app | email | sms | telegram
    type            VARCHAR(50)  NOT NULL,               -- register | shop_approved | order_created ...
    title           VARCHAR(255),
    body            TEXT,
    is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ############################################################################
-- # search (ixtiyoriy — yoki tashqi Meilisearch/Elastic)
-- ############################################################################

CREATE TABLE search_document (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT       NOT NULL,               -- product.id (cross-service, logical)
    shop_id         BIGINT       NOT NULL,               -- shop.id (logical)
    title           VARCHAR(255) NOT NULL,
    content         TEXT,
    category_id     BIGINT,
    price           NUMERIC(14,2),
    attributes      JSONB,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ============================================================================
-- CROSS-SERVICE bog'lanishlar (LOGICAL — faqat ERD chizig'i uchun)
-- ----------------------------------------------------------------------------
-- DIQQAT: Bular real prod'da FIZIK FK EMAS (har servis alohida DB). Faqat
-- drawSQL relationship chizishi uchun. Migratsiyaga KO'CHIRMANG.
-- ============================================================================

ALTER TABLE reservation        ADD CONSTRAINT fk_reservation_order        FOREIGN KEY (order_ref)              REFERENCES sales_order(id);
ALTER TABLE sales_order        ADD CONSTRAINT fk_order_reservation        FOREIGN KEY (reservation_id)         REFERENCES reservation(id);
ALTER TABLE sales_order        ADD CONSTRAINT fk_order_payment            FOREIGN KEY (payment_id)             REFERENCES payment(id);
ALTER TABLE sales_order_seller ADD CONSTRAINT fk_seller_shipment          FOREIGN KEY (elchi_shipment_id)      REFERENCES elchi_shipment(id);
ALTER TABLE payment            ADD CONSTRAINT fk_payment_order            FOREIGN KEY (sales_order_id)         REFERENCES sales_order(id);
ALTER TABLE elchi_shipment     ADD CONSTRAINT fk_shipment_seller          FOREIGN KEY (sales_order_seller_id)  REFERENCES sales_order_seller(id);
ALTER TABLE seller_ledger      ADD CONSTRAINT fk_ledger_shop              FOREIGN KEY (shop_id)                REFERENCES shop(id);
ALTER TABLE payout             ADD CONSTRAINT fk_payout_shop              FOREIGN KEY (shop_id)                REFERENCES shop(id);
ALTER TABLE commission         ADD CONSTRAINT fk_commission_shop          FOREIGN KEY (shop_id)                REFERENCES shop(id);
ALTER TABLE commission         ADD CONSTRAINT fk_commission_category      FOREIGN KEY (category_id)            REFERENCES category(id);
ALTER TABLE notification       ADD CONSTRAINT fk_notification_user        FOREIGN KEY (user_id)                REFERENCES users(id);
ALTER TABLE search_document    ADD CONSTRAINT fk_search_product           FOREIGN KEY (product_id)             REFERENCES product(id);
ALTER TABLE search_document    ADD CONSTRAINT fk_search_shop              FOREIGN KEY (shop_id)                REFERENCES shop(id);
-- warehouse.owner_id (polymorphic SHOP|HQ) — ataylab FK qo'yilmadi.

-- ============================================================================
-- Foydali indekslar (ERD uchun shart emas, prod uchun)
-- ============================================================================
CREATE INDEX idx_product_shop        ON product(shop_id);
CREATE INDEX idx_product_category    ON product(category_id);
CREATE INDEX idx_variant_product     ON product_variant(product_id);
CREATE INDEX idx_stock_variant       ON stock(variant_id);
CREATE INDEX idx_movement_stock      ON stock_movement(stock_id);
CREATE INDEX idx_cart_item_cart      ON cart_item(cart_id);
CREATE INDEX idx_order_customer      ON sales_order(customer_id);
CREATE INDEX idx_seller_order        ON sales_order_seller(sales_order_id);
CREATE INDEX idx_seller_shop         ON sales_order_seller(shop_id);
CREATE INDEX idx_item_seller         ON sales_order_item(sales_order_seller_id);
CREATE INDEX idx_ledger_shop         ON seller_ledger(shop_id);
CREATE INDEX idx_notification_user   ON notification(user_id);
