-- ============================================================================
-- search-service  ·  search  (ixtiyoriy — yoki tashqi Meilisearch/Elastic)
-- Storefront katalog qidiruv/filter indeksi.
-- Intra FK: yo'q.
-- External (logical): product_id/shop_id/category_id → catalog.*
-- ============================================================================

SET search_path = search;

CREATE TABLE search_document (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT       NOT NULL,               -- → catalog.product.id (external)
    shop_id         BIGINT       NOT NULL,               -- → catalog.shop.id (external)
    title           VARCHAR(255) NOT NULL,
    content         TEXT,
    category_id     BIGINT,                              -- → catalog.category.id (external)
    price           NUMERIC(14,2),
    attributes      JSONB,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
