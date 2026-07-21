-- ============================================================================
-- checkout-service  ·  checkout
-- Savat, buyurtma, ko'p-sotuvchi split.
-- Intra FK: cart_item→cart, sales_order_seller→sales_order, sales_order_item→sales_order_seller.
-- External (logical): customer_id→identity.users; product/variant/shop_id→catalog;
--   reservation_id→inventory.reservation; payment_id→payment.payment;
--   elchi_shipment_id→integration.elchi_shipment
-- ============================================================================

SET search_path = checkout;

-- Savat (anon yoki logged buyer)
CREATE TABLE cart (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT,                              -- → identity.users.id (external, null=anon)
    session_id      VARCHAR(255),
    status          VARCHAR(15)  NOT NULL DEFAULT 'active', -- active|converted|abandoned
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE cart_item (
    id                  BIGSERIAL PRIMARY KEY,
    cart_id             BIGINT   NOT NULL REFERENCES cart(id),   -- intra
    product_id          BIGINT   NOT NULL,                       -- → catalog.product.id (external)
    variant_id          BIGINT   NOT NULL,                       -- → catalog.product_variant.id (external)
    shop_id             BIGINT   NOT NULL,                       -- → catalog.shop.id (external)
    quantity            INTEGER  NOT NULL,
    unit_price_snapshot NUMERIC(14,2) NOT NULL
);

-- Marketplace buyurtmasi (pul source of truth)
CREATE TABLE sales_order (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT       NOT NULL,               -- → identity.users.id (external)
    status          VARCHAR(25)  NOT NULL DEFAULT 'DRAFT', -- DRAFT|PENDING_PAYMENT|PAID|CONFIRMED|PARTIALLY_FULFILLED|FULFILLED|CANCELLED|REFUNDED
    payment_method  VARCHAR(10)  NOT NULL,               -- COD | PAYME | CLICK
    total_amount    NUMERIC(14,2) NOT NULL,
    delivery_address TEXT,
    region_id       BIGINT,
    district_id     BIGINT,
    where_deliver   VARCHAR(10)  NOT NULL DEFAULT 'ADDRESS', -- CENTER | ADDRESS
    reservation_id  BIGINT,                              -- → inventory.reservation.id (external)
    payment_id      BIGINT,                              -- → payment.payment.id (external)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Har sotuvchiga sub-buyurtma (= bitta Elchi shipment birligi)
CREATE TABLE sales_order_seller (
    id                BIGSERIAL PRIMARY KEY,
    sales_order_id    BIGINT       NOT NULL REFERENCES sales_order(id),  -- intra
    shop_id           BIGINT       NOT NULL,             -- → catalog.shop.id (external)
    elchi_market_id   BIGINT,                            -- shop.elchi_market_id nusxasi
    subtotal          NUMERIC(14,2) NOT NULL,
    cod_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 0=prepaid(online), >0=COD
    elchi_shipment_id BIGINT,                            -- → integration.elchi_shipment.id (external)
    status            VARCHAR(20)  NOT NULL DEFAULT 'PENDING', -- PENDING|SHIPMENT_CREATED|ON_THE_ROAD|DELIVERED|CANCELLED|RETURNED
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE sales_order_item (
    id                    BIGSERIAL PRIMARY KEY,
    sales_order_seller_id BIGINT   NOT NULL REFERENCES sales_order_seller(id),  -- intra
    product_id            BIGINT   NOT NULL,             -- → catalog.product.id (external)
    variant_id            BIGINT   NOT NULL,             -- → catalog.product_variant.id (external)
    quantity              INTEGER  NOT NULL,
    unit_price            NUMERIC(14,2) NOT NULL,
    line_total            NUMERIC(14,2) NOT NULL
);
