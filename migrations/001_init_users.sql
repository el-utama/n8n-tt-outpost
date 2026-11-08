-- Migration 001: Initialize users table
-- Description: Core users table for allowlist, ownership, and timezone
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TABLE IF NOT EXISTS users (
    user_id         BIGINT PRIMARY KEY,
    username        VARCHAR(255),
    first_name      VARCHAR(255),
    last_name       VARCHAR(255),
    language_code   VARCHAR(10),
    is_bot          BOOLEAN NOT NULL DEFAULT FALSE,
    timezone        VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    is_allowlisted  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_allowlisted ON users(is_allowlisted) WHERE is_allowlisted = TRUE;

COMMENT ON TABLE users IS 'Telegram users with allowlist and ownership metadata';
COMMENT ON COLUMN users.user_id IS 'Telegram user ID (primary key)';
COMMENT ON COLUMN users.is_allowlisted IS 'Whether user is allowed to use the bot';
COMMENT ON COLUMN users.timezone IS 'User timezone for scheduling (IANA format)';