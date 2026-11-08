-- Migration 003: Initialize state_events table
-- Description: Audit trail for job state transitions
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TABLE IF NOT EXISTS state_events (
    event_id        BIGSERIAL PRIMARY KEY,
    job_id          UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    from_state      VARCHAR(64),
    to_state        VARCHAR(64) NOT NULL,
    actor           VARCHAR(64) NOT NULL,
    metadata        JSONB,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_events_job ON state_events(job_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_state_events_user ON state_events(user_id, timestamp);

COMMENT ON TABLE state_events IS 'Immutable audit log of job state transitions';
COMMENT ON COLUMN state_events.actor IS 'Module or user that triggered transition (e.g., orchestrator, user, scheduler)';
COMMENT ON COLUMN state_events.metadata IS 'Additional context: attempt, error, idempotency_key, etc.';