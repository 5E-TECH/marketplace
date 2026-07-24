-- ============================================================================
-- catalog-service  ·  catalog
-- Do'kon, kategoriya (daraxt), mahsulot, variant.
-- Intra FK: product→shop, product→category, product_variant→product, category→category(self).
-- External (logical): shop.owner_user_id, product.owner_user_id → identity.users.id
-- ============================================================================

SET search_path = catalog;

-- Do'kon (storefront)
CREATE TABLE shop (
    id              BIGSERIAL PRIMARY KEY,
    owner_user_id   BIGINT       NOT NULL UNIQUE,        -- → identity.users.id (external, logical)
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    logo_url        VARCHAR(500),
    banner_url      VARCHAR(500),
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- PENDING|ACTIVE|SUSPENDED|REJECTED
    phone           VARCHAR(20),
    region_id       BIGINT,                              -- → integration.geo_cache (Elchi region)
    district_id     BIGINT,                              -- → integration.geo_cache (Elchi district)
    address         TEXT,
    rating          NUMERIC(3,2) NOT NULL DEFAULT 0,
    orders_count    INTEGER      NOT NULL DEFAULT 0,
    elchi_market_id BIGINT,                              -- Elchi'da provision qilingan market id (external)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE
);

-- Kategoriya daraxti (self-referencing)
CREATE TABLE category (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    parent_id       BIGINT       REFERENCES category(id),   -- intra: self-ref (null = ildiz)
    icon_url        VARCHAR(500),
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE
);

-- Mahsulot
CREATE TABLE product (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT       NOT NULL REFERENCES shop(id),      -- intra
    owner_user_id   BIGINT       NOT NULL,                          -- → identity.users.id (external)
    category_id     BIGINT       REFERENCES category(id),           -- intra
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL,
    description     TEXT,
    price           NUMERIC(14,2) NOT NULL,
    old_price       NUMERIC(14,2),
    image_url       VARCHAR(500),
    images          JSONB        NOT NULL DEFAULT '[]',
    attributes      JSONB        NOT NULL DEFAULT '{}',
    has_variants    BOOLEAN      NOT NULL DEFAULT FALSE,
    status          VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',          -- DRAFT|ACTIVE|ARCHIVED|OUT_OF_STOCK
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE,
    UNIQUE (shop_id, slug)
);

-- Mahsulot varianti (rang/o'lcham). Variantsizga ham 1 ta "default".
CREATE TABLE product_variant (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT       NOT NULL REFERENCES product(id),   -- intra
    sku             VARCHAR(100) NOT NULL UNIQUE,
    name            VARCHAR(255),                                   -- "Qizil / M"
    attributes      JSONB        NOT NULL DEFAULT '{}',
    price           NUMERIC(14,2),                                  -- null → product.price
    old_price       NUMERIC(14,2),
    barcode         VARCHAR(100),
    image_url       VARCHAR(500),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    is_deleted      BOOLEAN      NOT NULL DEFAULT FALSE
);
