-- Migration 007: Initialize content_packages table
-- Description: Content packages linking jobs to artifacts and quality checks
-- Author: n8n-tt-outpost
-- Date: 2026-11-08

CREATE TYPE content_package_status AS ENUM (
    'BUILDING',
    'VALIDATING_ARTIFACT',
    'READY_FOR_DELIVERY',
    'READY_FOR_PUBLISH',
    'DELIVERED',
    'PUBLISHED',
    'ARCHIVED'
);

CREATE TABLE IF NOT EXISTS content_packages (
    content_package_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    user_id               BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    schema_version        VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    ideation              JSONB,
    caption               JSONB,
    media_assets          JSONB,
    voiceover_artifact_id UUID,
    video_artifact_id     UUID,
    carousel_artifacts    JSONB,
    quality_checks        JSONB,
    status                content_package_status NOT NULL DEFAULT 'BUILDING',
    retention_expires_at  TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_packages_job ON content_packages(job_id);
CREATE INDEX IF NOT EXISTS idx_content_packages_user_status ON content_packages(user_id, status);
CREATE INDEX IF NOT EXISTS idx_content_packages_retention ON content_packages(retention_expires_at) WHERE retention_expires_at IS NOT NULL;

COMMENT ON TABLE content_packages IS 'Content packages per contracts/content-package.schema.json';
COMMENT ON COLUMN content_packages.ideation IS 'Content ideation: title, hook, scenes, CTA, keywords, source_status';
COMMENT ON COLUMN content_packages.caption IS 'Caption body, hashtags, profile';
COMMENT ON COLUMN content_packages.media_assets IS 'Array of assets: asset_uri, hash, dimensions, source/license metadata';
COMMENT ON COLUMN content_packages.quality_checks IS 'QC results: media, audio, text, ratio, duration, license, completeness';
COMMENT ON COLUMN content_packages.retention_expires_at IS 'When package artifacts can be cleaned up';