-- Migration 004: Initialize idempotency_keys table
-- Description: Deduplication keys for job creation and critical operations
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key   VARCHAR(255) PRIMARY KEY,
    job_id            UUID REFERENCES jobs(job_id) ON DELETE SET NULL,
    operation         VARCHAR(64) NOT NULL DEFAULT 'create_job',
    payload_hash      VARCHAR(64),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,
    consumed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at) WHERE consumed_at IS NULL;

COMMENT ON TABLE idempotency_keys IS 'Idempotency keys for deduplication with TTL';
COMMENT ON COLUMN idempotency_keys.operation IS 'Operation type: create_job, cancel_job, publish_batch, etc.';
COMMENT ON COLUMN idempotency_keys.payload_hash IS 'SHA-256 of request payload for collision detection';
COMMENT ON COLUMN idempotency_keys.expires_at IS 'Auto-cleanup deadline';
COMMENT ON COLUMN idempotency_keys.consumed_at IS 'When key was successfully used';