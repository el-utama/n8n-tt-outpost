-- Migration 009: Initialize telegram tables
-- Description: Tables for Telegram bot cursor, idempotency, and user state
-- Author: n8n-tt-outpost
-- Date: 2026-11-09

CREATE TABLE IF NOT EXISTS telegram_cursor (
    id              INTEGER PRIMARY KEY DEFAULT 1,
    cursor_value    BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO telegram_cursor (id, cursor_value) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS telegram_idempotency (
    idempotency_key VARCHAR(255) PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    job_id          UUID REFERENCES jobs(job_id) ON DELETE SET NULL,
    payload_hash    VARCHAR(64) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_idempotency_expires ON telegram_idempotency(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_idempotency_user ON telegram_idempotency(user_id, created_at);

CREATE TABLE IF NOT EXISTS telegram_user_state (
    user_id         BIGINT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    current_mode    VARCHAR(32) NOT NULL DEFAULT 'manual',
    last_job_id     UUID REFERENCES jobs(job_id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE telegram_cursor IS 'Persistent cursor for Telegram getUpdates';
COMMENT ON TABLE telegram_idempotency IS 'Idempotency keys for Telegram updates';
COMMENT ON TABLE telegram_user_state IS 'Per-user Telegram state (mode, last job)';