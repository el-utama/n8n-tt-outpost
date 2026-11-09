-- Migration 011: Initialize publisher tables
-- Description: Tables for Gate 5 - Policy, Age Gate, Batch Approval, Publish Intent/Result, Adapters
-- Author: n8n-tt-outpost
-- Date: 2026-11-09

-- Policy Profiles
CREATE TABLE IF NOT EXISTS policy_profiles (
    policy_profile_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    mode                  VARCHAR(32) NOT NULL CHECK (mode IN ('SEMI_AUTO', 'FULL_AUTO')),
    timezone              VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    start_at              TIMESTAMPTZ NOT NULL,
    duration_days         INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
    max_posts_per_day     INTEGER NOT NULL CHECK (max_posts_per_day BETWEEN 1 AND 100),
    max_posts_per_platform_per_day INTEGER NOT NULL CHECK (max_posts_per_platform_per_day BETWEEN 1 AND 100),
    minimum_interval_minutes INTEGER NOT NULL CHECK (minimum_interval_minutes BETWEEN 1 AND 10080),
    daily_time_window     JSONB NOT NULL,
    active_days           JSONB NOT NULL,
    active_platforms      JSONB NOT NULL,
    max_batch_items       INTEGER NOT NULL CHECK (max_batch_items BETWEEN 1 AND 50),
    retry_limit           INTEGER NOT NULL CHECK (retry_limit BETWEEN 0 AND 5),
    duplicate_prevention  BOOLEAN NOT NULL DEFAULT TRUE,
    emergency_stop        BOOLEAN NOT NULL DEFAULT FALSE,
    emergency_stop_authority JSONB NOT NULL DEFAULT '[]',
    confirmed_at          TIMESTAMPTZ,
    version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_profiles_user ON policy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_policy_profiles_active ON policy_profiles(start_at, duration_days) WHERE emergency_stop = FALSE;

-- Age Gates
CREATE TABLE IF NOT EXISTS age_gates (
    age_gate_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    platform              VARCHAR(32) NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook')),
    age_gate_status       VARCHAR(32) NOT NULL DEFAULT 'unverified' CHECK (age_gate_status IN ('unverified', 'verified_0_30', 'verified_31_90', 'verified_90_plus')),
    age_days              INTEGER,
    verified_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_age_gates_account_platform ON age_gates(account_id, platform);

-- Batch Approvals
CREATE TABLE IF NOT EXISTS batch_approvals (
    batch_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    publish_intent_id     UUID NOT NULL,
    batch_hash            VARCHAR(64) NOT NULL,
    item_count            INTEGER NOT NULL DEFAULT 0,
    platform_targets      JSONB NOT NULL DEFAULT '[]',
    proposed_schedule     TIMESTAMPTZ,
    preview_payload       JSONB NOT NULL DEFAULT '{}',
    status                VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'NEED_APPROVAL')),
    approved_by           BIGINT,
    approved_at           TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_approvals_user ON batch_approvals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_batch_approvals_intent ON batch_approvals(publish_intent_id);

-- Publish Intents
CREATE TABLE IF NOT EXISTS publish_intents (
    publish_intent_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    content_package_id    UUID NOT NULL REFERENCES content_packages(content_package_id) ON DELETE CASCADE,
    user_id               BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    account_id            UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
    mode                  VARCHAR(32) NOT NULL CHECK (mode IN ('MANUAL', 'SEMI_AUTO', 'FULL_AUTO')),
    policy_profile_id     UUID REFERENCES policy_profiles(policy_profile_id) ON DELETE SET NULL,
    batch_id              UUID REFERENCES batch_approvals(batch_id) ON DELETE SET NULL,
    approval_id           UUID REFERENCES batch_approvals(batch_id) ON DELETE SET NULL,
    platforms             JSONB NOT NULL DEFAULT '[]',
    intended_schedule     TIMESTAMPTZ,
    idempotency_key       VARCHAR(255) NOT NULL UNIQUE,
    status                VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PREFLIGHT', 'READY_TO_PUBLISH', 'UPLOADING', 'PUBLISHED', 'PARTIAL_FAILURE', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'STOPPED', 'CANCELLED')),
    platform_status       JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_publish_intents_user ON publish_intents(user_id, status);
CREATE INDEX IF NOT EXISTS idx_publish_intents_status ON publish_intents(status, updated_at);

-- Publish Results
CREATE TABLE IF NOT EXISTS publish_results (
    publish_result_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publish_intent_id     UUID NOT NULL REFERENCES publish_intents(publish_intent_id) ON DELETE CASCADE,
    platform              VARCHAR(32) NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook')),
    status                VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UPLOADING', 'PUBLISHED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SKIPPED', 'STOPPED')),
    remote_post_id        VARCHAR(255),
    remote_url            VARCHAR(2048),
    idempotency_key       VARCHAR(255) NOT NULL,
    adapter_version       VARCHAR(64) NOT NULL,
    attempt               INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    error                 JSONB,
    verified_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_results_intent ON publish_results(publish_intent_id);
CREATE INDEX IF NOT EXISTS idx_publish_results_platform ON publish_results(platform, status);

-- Adapter Capabilities
CREATE TABLE IF NOT EXISTS adapter_capabilities (
    capability_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform              VARCHAR(32) NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'facebook')),
    adapter_version       VARCHAR(64) NOT NULL,
    capability_name       VARCHAR(128) NOT NULL,
    capability_value      JSONB NOT NULL,
    verified_at           TIMESTAMPTZ,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_adapter_capability ON adapter_capabilities(platform, adapter_version, capability_name);

-- Emergency Stop
CREATE TABLE IF NOT EXISTS emergency_stops (
    stop_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triggered_by          BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    reason                VARCHAR(255) NOT NULL,
    scope                 VARCHAR(32) NOT NULL DEFAULT 'ALL' CHECK (scope IN ('ALL', 'PLATFORM', 'BATCH', 'JOB')),
    target_id             UUID,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resumed_at            TIMESTAMPTZ,
    resumed_by            BIGINT REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_emergency_stops_active ON emergency_stops(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE policy_profiles IS 'Policy profiles for Semi-Auto and Full-Auto modes';
COMMENT ON TABLE age_gates IS 'TikTok/Instagram/Facebook age gate eligibility';
COMMENT ON TABLE batch_approvals IS 'Semi-Auto batch approval lifecycle';
COMMENT ON TABLE publish_intents IS 'Publishing intent records';
COMMENT ON TABLE publish_results IS 'Per-platform publish results';
COMMENT ON TABLE adapter_capabilities IS 'Platform adapter capabilities';
COMMENT ON TABLE emergency_stops IS 'Emergency stop events';