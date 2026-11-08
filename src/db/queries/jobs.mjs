import { getPool, withTransaction, DatabaseError } from '../pool.mjs';

export const LEGAL_TRANSITIONS = {
  RECEIVED: ['VALIDATING', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  VALIDATING: ['GENERATING_IDEATION', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  GENERATING_IDEATION: ['SOURCING_MEDIA', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  SOURCING_MEDIA: ['GENERATING_CAPTION', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  GENERATING_CAPTION: ['GENERATING_TTS', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  GENERATING_TTS: ['COMPOSING_VIDEO', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  COMPOSING_VIDEO: ['VALIDATING_ARTIFACT', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  VALIDATING_ARTIFACT: ['DELIVERING', 'READY_FOR_PUBLISH', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  DELIVERING: ['COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  READY_FOR_PUBLISH: ['DELIVERING', 'FAILED_FINAL', 'CANCEL_REQUESTED'],
  FAILED_RETRYABLE: ['VALIDATING', 'CANCEL_REQUESTED'],
  CANCEL_REQUESTED: ['CANCELLED', 'FAILED_FINAL']
};

export const TERMINAL_STATES = ['COMPLETED', 'FAILED_FINAL', 'CANCELLED'];

export async function createJob(jobData) {
  const pool = getPool();
  const { job_id, user_id, account_id, idempotency_key, theme_raw, theme_normalized, content_profile, timezone, max_attempts } = jobData;
  const result = await pool.query(
    `INSERT INTO jobs (job_id, user_id, account_id, idempotency_key, theme_raw, theme_normalized, content_profile, timezone, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [job_id, user_id, account_id, idempotency_key, theme_raw, theme_normalized, content_profile, timezone ?? 'Asia/Jakarta', max_attempts ?? 3]
  );
  return result.rows[0];
}

export async function getJobById(jobId) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
  return result.rows[0] ?? null;
}

export async function getJobByIdempotencyKey(key) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM jobs WHERE idempotency_key = $1', [key]);
  return result.rows[0] ?? null;
}

export async function getJobsByUser(userId, { status = null, limit = 50, offset = 0 } = {}) {
  const pool = getPool();
  let query = 'SELECT * FROM jobs WHERE user_id = $1';
  const params = [userId];
  if (status) {
    query += ' AND status = $2';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRetryableJobs(limit = 100) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM jobs WHERE status = 'FAILED_RETRYABLE' AND attempt < max_attempts ORDER BY updated_at ASC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function transitionJob(jobId, fromState, toState, actor, metadata = {}) {
  const pool = getPool();
  
  const legal = LEGAL_TRANSITIONS[fromState] ?? [];
  if (!legal.includes(toState)) {
    throw new DatabaseError(`Illegal state transition: ${fromState} -> ${toState}`, { code: 'ERR_ILLEGAL_TRANSITION' });
  }

  const result = await withTransaction(pool, async (client) => {
    // Lock the job row
    const jobResult = await client.query(
      `SELECT * FROM jobs WHERE job_id = $1 FOR UPDATE`,
      [jobId]
    );
    if (jobResult.rows.length === 0) {
      throw new DatabaseError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });
    }
    const job = jobResult.rows[0];
    if (job.status !== fromState) {
      throw new DatabaseError(`Job state mismatch: expected ${fromState}, got ${job.status}`, { code: 'ERR_STATE_MISMATCH' });
    }

    // Update job
    const updateResult = await client.query(
      `UPDATE jobs SET status = $1, current_step = $2, attempt = $3, max_attempts = $4, error = $5, updated_at = NOW()
       WHERE job_id = $6 RETURNING *`,
      [toState, metadata.current_step ?? toState, metadata.attempt ?? job.attempt, metadata.max_attempts ?? job.max_attempts, metadata.error ?? null, jobId]
    );

    // Insert state event
    await client.query(
      `INSERT INTO state_events (job_id, user_id, from_state, to_state, actor, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [jobId, job.user_id, fromState, toState, actor, metadata]
    );

    // Insert audit event
    await client.query(
      `INSERT INTO audit_events (action, user_id, job_id, details)
       VALUES ($1, $2, $3, $4)`,
      ['JOB_TRANSITION', job.user_id, jobId, { from: fromState, to: toState, actor, ...metadata }]
    );

    return updateResult.rows[0];
  });

  return result;
}

export async function updateJobFields(jobId, fields) {
  const pool = getPool();
  const setClause = [];
  const values = [jobId];
  let paramIndex = 2;

  for (const [key, value] of Object.entries(fields)) {
    setClause.push(`${key} = $${paramIndex++}`);
    values.push(value);
  }
  setClause.push('updated_at = NOW()');

  const result = await pool.query(
    `UPDATE jobs SET ${setClause.join(', ')} WHERE job_id = $1 RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function incrementAttempt(jobId) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE jobs SET attempt = attempt + 1, updated_at = NOW() WHERE job_id = $1 RETURNING *`,
    [jobId]
  );
  return result.rows[0] ?? null;
}