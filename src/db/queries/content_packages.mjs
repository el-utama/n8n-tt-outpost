import { getPool, withTransaction, DatabaseError } from '../pool.mjs';

export async function createContentPackage(data) {
  const pool = getPool();
  const { content_package_id, job_id, user_id, schema_version, ideation, caption, media_assets, voiceover_artifact_id, video_artifact_id, carousel_artifacts, quality_checks, retention_days } = data;
  
  const retentionExpiresAt = retention_days ? new Date(Date.now() + retention_days * 24 * 60 * 60 * 1000) : null;

  const result = await pool.query(
    `INSERT INTO content_packages (content_package_id, job_id, user_id, schema_version, ideation, caption, media_assets, voiceover_artifact_id, video_artifact_id, carousel_artifacts, quality_checks, retention_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [content_package_id, job_id, user_id, schema_version ?? '1.0.0', ideation, caption, media_assets, voiceover_artifact_id, video_artifact_id, carousel_artifacts, quality_checks, retentionExpiresAt]
  );
  return result.rows[0];
}

export async function getContentPackageById(packageId) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM content_packages WHERE content_package_id = $1', [packageId]);
  return result.rows[0] ?? null;
}

export async function getContentPackageByJob(jobId) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM content_packages WHERE job_id = $1', [jobId]);
  return result.rows[0] ?? null;
}

export async function updateContentPackageStatus(packageId, status, { quality_checks = null } = {}) {
  const pool = getPool();
  const fields = ['status = $2', 'updated_at = NOW()'];
  const values = [packageId, status];
  let paramIndex = 3;

  if (quality_checks !== null) {
    fields.push(`quality_checks = $${paramIndex++}`);
    values.push(quality_checks);
  }

  const result = await pool.query(
    `UPDATE content_packages SET ${fields.join(', ')} WHERE content_package_id = $1 RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function getPackagesForCleanup() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM content_packages WHERE retention_expires_at IS NOT NULL AND retention_expires_at < NOW() AND status IN ('DELIVERED', 'PUBLISHED', 'ARCHIVED')`
  );
  return result.rows;
}

export async function deleteContentPackage(packageId) {
  const pool = getPool();
  const result = await pool.query('DELETE FROM content_packages WHERE content_package_id = $1', [packageId]);
  return result.rowCount > 0;
}