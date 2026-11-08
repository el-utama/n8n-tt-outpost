-- Migration 006: Initialize audit_events table
-- Description: Structured audit log for all security-relevant actions
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TYPE audit_action AS ENUM (
    'JOB_CREATED',
    'JOB_TRANSITION',
    'JOB_CANCELLED',
    'JOB_RETRY',
    'IDEMPOTENCY_ACQUIRED',
    'IDEMPOTENCY_REJECTED',
    'LEASE_ACQUIRED',
    'LEASE_RELEASED',
    'LEASE_STALE',
    'CONTENT_PACKAGE_CREATED',
    'CONTENT_PACKAGE_QC_PASSED',
    'CONTENT_PACKAGE_QC_FAILED',
    'POLICY_EVALUATED',
    'BATCH_APPROVAL_REQUESTED',
    'BATCH_APPROVAL_GRANTED',
    'BATCH_APPROVAL_DENIED',
    'BATCH_APPROVAL_EXPIRED',
    'PUBLISH_INTENT_CREATED',
    'PUBLISH_PREFLIGHT',
    'PUBLISH_ATTEMPT',
    'PUBLISH_SUCCESS',
    'PUBLISH_FAILURE',
    'EMERGENCY_STOP_TRIGGERED',
    'EMERGENCY_STOP_RESUMED',
    'ARTIFACT_DOWNLOAD_REQUESTED',
    'ARTIFACT_DOWNLOAD_GRANTED',
    'ARTIFACT_DOWNLOAD_DENIED',
    'USER_ALLOWLIST_CHANGED',
    'ACCOUNT_METADATA_UPDATED',
    'POLICY_PROFILE_CREATED',
    'POLICY_PROFILE_UPDATED',
    'CONFIG_CHANGED'
);

CREATE TABLE IF NOT EXISTS audit_events (
    audit_id        BIGSERIAL PRIMARY KEY,
    action          audit_action NOT NULL,
    user_id         BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    job_id          UUID REFERENCES jobs(job_id) ON DELETE SET NULL,
    account_id      UUID,
    content_package_id UUID,
    publish_intent_id  UUID,
    details         JSONB NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_events(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_job_time ON audit_events(job_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_events(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_content_package ON audit_events(content_package_id, timestamp DESC) WHERE content_package_id IS NOT NULL;

COMMENT ON TABLE audit_events IS 'Immutable structured audit log for all security-relevant actions';
COMMENT ON COLUMN audit_events.action IS 'Categorized action type for querying and alerting';
COMMENT ON COLUMN audit_events.details IS 'Structured details: before/after state, decision reason, error, etc. (NO SECRETS)';
COMMENT ON COLUMN audit_events.ip_address IS 'Client IP if applicable (for security audit)';
COMMENT ON COLUMN audit_events.user_agent IS 'Client user agent if applicable';