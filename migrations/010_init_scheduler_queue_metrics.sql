-- Migration 010: Initialize scheduler, queue, metrics, and alerts tables
-- Description: Tables for Gate 4 - Scheduler, Queue Manager, Metrics, Alerts
-- Author: n8n-tt-outpost
-- Date: 2026-11-09

-- Schedules table
CREATE TABLE IF NOT EXISTS schedules (
    schedule_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id                VARCHAR(255) NOT NULL UNIQUE,
    cron              VARCHAR(255) NOT NULL,
    job_type          VARCHAR(128) NOT NULL,
    payload           JSONB NOT NULL DEFAULT '{}',
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    next_run          TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run) WHERE enabled = TRUE;

COMMENT ON TABLE schedules IS 'Scheduled job definitions with cron expressions';
COMMENT ON COLUMN schedules.cron IS 'Cron expression (minute hour day month weekday)';
COMMENT ON COLUMN schedules.job_type IS 'Type of job to create';
COMMENT ON COLUMN schedules.payload IS 'Job creation payload';

-- Queue jobs table
CREATE TABLE IF NOT EXISTS queue_jobs (
    job_id            UUID PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
    worker_id         VARCHAR(255),
    priority          INTEGER NOT NULL DEFAULT 50,
    status            VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    attempt           INTEGER NOT NULL DEFAULT 0,
    max_attempts      INTEGER NOT NULL DEFAULT 3,
    lease_expires_at  TIMESTAMPTZ,
    error             JSONB,
    metadata          JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_priority ON queue_jobs(status, priority DESC, created_at) WHERE status IN ('PENDING', 'LEASED');
CREATE INDEX IF NOT EXISTS idx_queue_jobs_worker ON queue_jobs(worker_id, lease_expires_at) WHERE status = 'LEASED';

COMMENT ON TABLE queue_jobs IS 'Queue jobs with lease-based concurrency control';
COMMENT ON COLUMN queue_jobs.priority IS 'Job priority (higher = more important)';
COMMENT ON COLUMN queue_jobs.status IS 'PENDING, LEASED, PROCESSING, COMPLETED, FAILED, DEAD_LETTER, CANCELLED';
COMMENT ON COLUMN queue_jobs.lease_expires_at IS 'Lease expiry for stale detection';

-- Metrics table
CREATE TABLE IF NOT EXISTS metrics (
    metric_id         BIGSERIAL PRIMARY KEY,
    metric_name       VARCHAR(255) NOT NULL,
    labels            JSONB NOT NULL DEFAULT '{}',
    metric_type       VARCHAR(32) NOT NULL,
    metric_value      NUMERIC NOT NULL,
    timestamp         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON metrics(metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_labels ON metrics USING GIN (labels);

COMMENT ON TABLE metrics IS 'Time-series metrics (counters, gauges, histograms)';

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    alert_id          VARCHAR(255) PRIMARY KEY,
    rule_id           VARCHAR(255) NOT NULL,
    name              VARCHAR(255) NOT NULL,
    severity          VARCHAR(32) NOT NULL,
    message           TEXT,
    timestamp         TIMESTAMPTZ NOT NULL,
    trigger_count     INTEGER NOT NULL DEFAULT 1,
    resolved_at       TIMESTAMPTZ,
    acknowledged_by   BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    acknowledged_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_rule_time ON alerts(rule_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(rule_id, resolved_at) WHERE resolved_at IS NULL;

COMMENT ON TABLE alerts IS 'Alert instances from alert rules';

-- System health table
CREATE TABLE IF NOT EXISTS system_health (
    check_id          BIGSERIAL PRIMARY KEY,
    component         VARCHAR(128) NOT NULL,
    status            VARCHAR(32) NOT NULL,
    message           TEXT,
    details           JSONB,
    timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_health_component_time ON system_health(component, timestamp DESC);

COMMENT ON TABLE system_health IS 'System health check results';