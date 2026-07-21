-- ============================================================================
-- finance-service  ·  finance  (faqat online escrow puli)
-- Sotuvchi ledger, payout, komissiya.
-- Intra FK: yo'q (uch jadval mustaqil, umumiy tashqi shop_id bilan bog'lanadi).
-- External (logical): shop_id → catalog.shop.id; commission.category_id → catalog.category.id
-- ============================================================================

SET search_path = finance;

CREATE TABLE seller_ledger (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT       NOT NULL,               -- → catalog.shop.id (external)
    entry_type      VARCHAR(15)  NOT NULL,               -- sale|commission|payout|refund|adjust
    amount          NUMERIC(14,2) NOT NULL,              -- signed
    balance_after   NUMERIC(14,2) NOT NULL,
    reference_type  VARCHAR(30),
    reference_id    BIGINT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE payout (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT       NOT NULL,               -- → catalog.shop.id (external)
    amount          NUMERIC(14,2) NOT NULL,
    status          VARCHAR(15)  NOT NULL DEFAULT 'PENDING',
    method          VARCHAR(30),
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE commission (
    id              BIGSERIAL PRIMARY KEY,
    shop_id         BIGINT,                              -- → catalog.shop.id (external, null=global)
    category_id     BIGINT,                              -- → catalog.category.id (external, null=barcha)
    type            VARCHAR(10)  NOT NULL DEFAULT 'PERCENT', -- PERCENT | FIXED
    value           NUMERIC(14,2) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
