-- ============================================================================
-- payment-service  ·  payment
-- Payme/Click, escrow, tranzaksiya jurnali.
-- Intra FK: payment_transaction→payment.
-- External (logical): payment.sales_order_id → checkout.sales_order.id
-- ============================================================================

SET search_path = payment;

CREATE TABLE payment (
    id              BIGSERIAL PRIMARY KEY,
    sales_order_id  BIGINT       NOT NULL,               -- → checkout.sales_order.id (external)
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
    payment_id      BIGINT       NOT NULL REFERENCES payment(id),  -- intra
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
