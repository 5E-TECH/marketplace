-- ============================================================================
-- notification-service  ·  notification
-- Seller/buyer/admin'ga in-app/email/sms/telegram bildirishnomalar.
-- Intra FK: yo'q.
-- External (logical): user_id → identity.users.id
-- ============================================================================

SET search_path = notification;

CREATE TABLE notification (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT       NOT NULL,               -- → identity.users.id (external)
    channel         VARCHAR(15)  NOT NULL DEFAULT 'in_app', -- in_app|email|sms|telegram
    type            VARCHAR(50)  NOT NULL,               -- register|shop_approved|order_created ...
    title           VARCHAR(255),
    body            TEXT,
    is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
