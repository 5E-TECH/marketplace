-- ============================================================================
-- elchi-integration  ·  integration  (Elchi Partner API klient)
-- Elchi shipment kuzatuvi + geo kesh.
-- Intra FK: yo'q (ikki jadval mustaqil).
-- External (logical): elchi_shipment.sales_order_seller_id → checkout.sales_order_seller.id
-- ============================================================================

SET search_path = integration;

CREATE TABLE elchi_shipment (
    id                    BIGSERIAL PRIMARY KEY,
    sales_order_seller_id BIGINT       NOT NULL,         -- → checkout.sales_order_seller.id (external)
    elchi_shipment_id     BIGINT,                        -- Elchi'dagi order/shipment id
    elchi_market_id       BIGINT,
    last_status           VARCHAR(30),                   -- received|on the road|sold|returned_to_market ...
    cod_collected         NUMERIC(14,2) NOT NULL DEFAULT 0,
    tracking_url          VARCHAR(500),
    synced_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Elchi region/district ↔ nom keshi
CREATE TABLE geo_cache (
    id              BIGSERIAL PRIMARY KEY,
    kind            VARCHAR(10)  NOT NULL,               -- region | district
    elchi_id        BIGINT       NOT NULL,
    name            VARCHAR(255) NOT NULL,
    sato_code       VARCHAR(20),                         -- SOATO/SATO kodi
    elchi_region_id BIGINT,                              -- district → region id
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT false,
    UNIQUE (kind, elchi_id)
);

-- Shop approve paytidagi Elchi market provisioning snapshoti (retry/idempotency)
CREATE TABLE elchi_market_provision (
    id                BIGSERIAL PRIMARY KEY,
    shop_id           BIGINT        NOT NULL UNIQUE,
    elchi_market_id   BIGINT,
    status            VARCHAR(20)   NOT NULL DEFAULT 'pending',
    shop_name         VARCHAR,
    phone             VARCHAR,
    region_id         BIGINT,
    district_id       BIGINT,
    tariff_home       NUMERIC(14,2) NOT NULL DEFAULT 0,
    tariff_center     NUMERIC(14,2) NOT NULL DEFAULT 0,
    retry_count       INTEGER       NOT NULL DEFAULT 0,
    last_error        TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    is_deleted        BOOLEAN       NOT NULL DEFAULT false
);
