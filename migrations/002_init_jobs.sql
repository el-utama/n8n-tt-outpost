-- Migration 002: Initialize jobs table
-- Description: Core job state machine table per job.schema.json
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TYPE job_status AS ENUM (
    'RECEIVED',
    'VALIDATING',
    'GENERATING_IDEATION',
    'SOURCING_MEDIA',
    'GENERATING_CAPTION',
    'GENERATING_TTS',
    'COMPOSING_VIDEO',
    'VALIDATING_ARTIFACT',
    'DELIVERING',
    'COMPLETED',
    'FAILED_RETRYABLE',
    'FAILED_FINAL',
    'CANCEL_REQUESTED',
    'CANCELLED'
);

CREATE TYPE job_step AS ENUM (
    'RECEIVED',
    'VALIDATING',
    'GENERATING_IDEATION',
    'SOURCING_MEDIA',
    'GENERATING_CAPTION',
    'GENERATING_TTS',
    'COMPOSING_VIDEO',
    'VALIDATING_ARTIFACT',
    'DELIVERING',
    'COMPLETED'
);

CREATE TABLE IF NOT EXISTS jobs (
    job_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    account_id          UUID,
    idempotency_key     VARCHAR(255) NOT NULL,
    theme_raw           TEXT NOT NULL,
    theme_normalized    TEXT,
    content_profile     JSONB,
    status              job_status NOT NULL DEFAULT 'RECEIVED',
    current_step        job_step,
    attempt             INTEGER NOT NULL DEFAULT 1,
    max_attempts        INTEGER NOT NULL DEFAULT 3,
    policy_decision     VARCHAR(64),
    timezone            VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    content_package_id  UUID,
    publish_intent_id   UUID,
    error               JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idempotency_key ON jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at) WHERE status IN ('RECEIVED', 'VALIDATING', 'GENERATING_IDEATION', 'SOURCING_MEDIA', 'GENERATING_CAPTION', 'GENERATING_TTS', 'COMPOSING_VIDEO', 'VALIDATING_ARTIFACT', 'DELIVERING');
CREATE INDEX IF NOT EXISTS idx_jobs_retryable ON jobs(status, attempt, max_attempts) WHERE status = 'FAILED_RETRYABLE' AND attempt < max_attempts;

COMMENT ON TABLE jobs IS 'Job lifecycle state machine per contracts/job.schema.json';
COMMENT ON COLUMN jobs.job_id IS 'Unique job identifier';
COMMENT ON COLUMN jobs.idempotency_key IS 'Client-provided key for deduplication';
COMMENT ON COLUMN jobs.status IS 'Current job state';
COMMENT ON COLUMN jobs.attempt IS 'Current attempt number (1-based)';
COMMENT ON COLUMN jobs.max_attempts IS 'Maximum retry attempts allowed';
COMMENT ON COLUMN jobs.error IS 'Structured error object for failed states';