-- Migration 005: Initialize queue_leases table
-- Description: Worker leases for job processing with concurrency control
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TABLE IF NOT EXISTS queue_leases (
    lease_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    worker_id         VARCHAR(255) NOT NULL,
    attempt           INTEGER NOT NULL DEFAULT 1,
    lease_expires_at  TIMESTAMPTZ NOT NULL,
    acquired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at       TIMESTAMPTZ,
    completed         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_queue_leases_job ON queue_leases(job_id) WHERE completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_queue_leases_worker ON queue_leases(worker_id, lease_expires_at) WHERE completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_queue_leases_stale ON queue_leases(lease_expires_at) WHERE completed = FALSE AND released_at IS NULL;

COMMENT ON TABLE queue_leases IS 'Worker leases for job processing with lease-based concurrency control';
COMMENT ON COLUMN queue_leases.worker_id IS 'Unique worker identifier (hostname-pid or container ID)';
COMMENT ON COLUMN queue_leases.attempt IS 'Processing attempt number for this lease';
COMMENT ON COLUMN queue_leases.lease_expires_at IS 'Lease expiry; stale if passed and not completed/released';
COMMENT ON COLUMN queue_leases.completed IS 'Whether job completed successfully under this lease';