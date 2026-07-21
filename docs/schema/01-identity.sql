-- ============================================================================
-- identity-service  ·  identity
-- Marketplace foydalanuvchilari: seller / buyer / admin (Elchi user'idan ALOHIDA).
-- Bu servisning tashqi FK'i yo'q — mustaqil.
-- ============================================================================

SET search_path = identity;

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
