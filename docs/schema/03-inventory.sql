-- ============================================================================
-- inventory-service  ·  inventory
-- Ko'p ombor, qoldiq, harakat jurnali, rezervatsiya. Invariant: on_hand - reserved >= 0.
-- Intra FK: stock→warehouse, stock_movement→stock, reservation_item→reservation/warehouse.
-- External (logical): *.variant_id → catalog.product_variant.id;
--   warehouse.owner_id → catalog.shop.id; reservation.order_ref → checkout.sales_order.id
-- ============================================================================

SET search_path = inventory;

-- Ombor. owner_type: SHOP → owner_id=shop.id; HQ → markaziy.
CREATE TABLE warehouse (
    id              BIGSERIAL PRIMARY KEY,
    owner_type      VARCHAR(10)  NOT NULL DEFAULT 'SHOP', -- SHOP | HQ
    owner_id        BIGINT       NOT NULL,                -- → catalog.shop.id (external, polymorphic)
    name            VARCHAR(255) NOT NULL,
    region_id       BIGINT,
    district_id     BIGINT,
    address         TEXT,
    is_default      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Qoldiq: har variant × ombor uchun bitta qator.
CREATE TABLE stock (
    id                  BIGSERIAL PRIMARY KEY,
    variant_id          BIGINT   NOT NULL,               -- → catalog.product_variant.id (external)
    warehouse_id        BIGINT   NOT NULL REFERENCES warehouse(id),  -- intra
    quantity_on_hand    INTEGER  NOT NULL DEFAULT 0,
    quantity_reserved   INTEGER  NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER  NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (variant_id, warehouse_id)
);

-- Harakatlar jurnali (append-only)
CREATE TABLE stock_movement (
    id              BIGSERIAL PRIMARY KEY,
    stock_id        BIGINT       NOT NULL REFERENCES stock(id),  -- intra
    variant_id      BIGINT       NOT NULL,               -- denormalizatsiya
    warehouse_id    BIGINT       NOT NULL,
    type            VARCHAR(20)  NOT NULL,               -- INBOUND|OUTBOUND|RESERVE|RELEASE|COMMIT|ADJUST|TRANSFER
    quantity        INTEGER      NOT NULL,               -- signed
    on_hand_after   INTEGER      NOT NULL,
    reserved_after  INTEGER      NOT NULL,
    reference_type  VARCHAR(30),
    reference_id    BIGINT,
    reason          TEXT,
    actor_id        BIGINT,                              -- → identity.users.id (external)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Rezervatsiya (buyurtma uchun qoldiq band)
CREATE TABLE reservation (
    id              BIGSERIAL PRIMARY KEY,
    order_ref       BIGINT       NOT NULL UNIQUE,        -- → checkout.sales_order.id (external)
    status          VARCHAR(15)  NOT NULL DEFAULT 'HELD', -- HELD|COMMITTED|RELEASED|EXPIRED
    expires_at      TIMESTAMPTZ,
    idempotency_key VARCHAR(255),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE reservation_item (
    id              BIGSERIAL PRIMARY KEY,
    reservation_id  BIGINT   NOT NULL REFERENCES reservation(id),   -- intra
    variant_id      BIGINT   NOT NULL,                              -- → catalog.product_variant.id (external)
    warehouse_id    BIGINT   NOT NULL REFERENCES warehouse(id),     -- intra
    quantity        INTEGER  NOT NULL
);
