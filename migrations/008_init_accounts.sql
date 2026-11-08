-- Migration 008: Initialize accounts table
-- Description: Platform-neutral account metadata for publishing eligibility
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TYPE account_platform AS ENUM ('tiktok', 'instagram', 'facebook');

CREATE TABLE IF NOT EXISTS accounts (
    account_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    platform            account_platform NOT NULL,
    account_handle      VARCHAR(255) NOT NULL,
    account_metadata    JSONB NOT NULL DEFAULT '{}',
    ownership_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    ownership_method    VARCHAR(64),
    age_gate_status     VARCHAR(32) NOT NULL DEFAULT 'unverified',
    age_gate_verified_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_user_platform_handle ON accounts(user_id, platform, account_handle);
CREATE INDEX IF NOT EXISTS idx_accounts_user_platform ON accounts(user_id, platform);

COMMENT ON TABLE accounts IS 'Platform-neutral account metadata per design.md §5.3, §3.7';
COMMENT ON COLUMN accounts.platform IS 'Target platform';
COMMENT ON COLUMN accounts.account_handle IS 'User-provided handle/username (NOT proof of ownership)';
COMMENT ON COLUMN accounts.account_metadata IS 'Platform-specific metadata: user_id, page_id, creation_date, etc.';
COMMENT ON COLUMN accounts.ownership_verified IS 'Whether ownership was verified via platform OAuth or manual review';
COMMENT ON COLUMN accounts.ownership_method IS 'Verification method: oauth, manual_review, self_declared';
COMMENT ON COLUMN accounts.age_gate_status IS 'TikTok age gate: unverified, verified_0_30, verified_31_90, verified_90_plus';
COMMENT ON COLUMN accounts.age_gate_verified_at IS 'When age gate was last verified';