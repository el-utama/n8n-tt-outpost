import { getPool, withTransaction, DatabaseError } from '../pool.mjs';

export async function acquireLease(jobId, workerId, { ttlSeconds = 300, attempt = 1 } = {}) {
  const pool = getPool();
  const leaseExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    const result = await withTransaction(pool, async (client) => {
      // Check for existing active lease on this job
      const existingLease = await client.query(
        `SELECT * FROM queue_leases WHERE job_id = $1 AND completed = FALSE AND released_at IS NULL FOR UPDATE`,
        [jobId]
      );

      if (existingLease.rows.length > 0) {
        const lease = existingLease.rows[0];
        if (new Date() < new Date(lease.lease_expires_at)) {
          throw new DatabaseError('Job already leased by another worker', { code: 'ERR_JOB_ALREADY_LEASED' });
        }
        // Lease is stale, we can take it over
      }

      // Check job status
      const jobResult = await client.query(
        `SELECT status FROM jobs WHERE job_id = $1 FOR UPDATE`,
        [jobId]
      );
      if (jobResult.rows.length === 0) {
        throw new DatabaseError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });
      }
      const job = jobResult.rows[0];
      if (['COMPLETED', 'FAILED_FINAL', 'CANCELLED', 'CANCEL_REQUESTED'].includes(job.status)) {
        throw new DatabaseError(`Job not in processable state: ${job.status}`, { code: 'ERR_JOB_NOT_PROCESSABLE' });
      }

      // Create new lease
      const insertResult = await client.query(
        `INSERT INTO queue_leases (job_id, worker_id, attempt, lease_expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [jobId, workerId, attempt, leaseExpiresAt]
      );

      // Update job status to indicate processing
      await client.query(
        `UPDATE jobs SET updated_at = NOW() WHERE job_id = $1`,
        [jobId]
      );

      // Audit event
      await client.query(
        `INSERT INTO audit_events (action, job_id, details)
         VALUES ($1, $2, $3)`,
        ['LEASE_ACQUIRED', jobId, { worker_id: workerId, attempt, ttl_seconds: ttlSeconds }]
      );

      return insertResult.rows[0];
    });

    return result;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(`Lease acquire failed: ${error.message}`, { cause: error, code: 'ERR_LEASE_ACQUIRE' });
  }
}

export async function renewLease(leaseId, workerId, { ttlSeconds = 300 } = {}) {
  const pool = getPool();
  const leaseExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const result = await pool.query(
    `UPDATE queue_leases SET lease_expires_at = $1 WHERE lease_id = $2 AND worker_id = $3 AND completed = FALSE AND released_at IS NULL RETURNING *`,
    [leaseExpiresAt, leaseId, workerId]
  );
  return result.rows[0] ?? null;
}

export async function releaseLease(leaseId, workerId, { completed = false } = {}) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE queue_leases SET released_at = NOW(), completed = $1 WHERE lease_id = $2 AND worker_id = $3 RETURNING *`,
    [completed, leaseId, workerId]
  );

  if (result.rows.length > 0) {
    await pool.query(
      `INSERT INTO audit_events (action, job_id, details)
       VALUES ($1, $2, $3)`,
      [completed ? 'LEASE_RELEASED' : 'LEASE_RELEASED', result.rows[0].job_id, { worker_id: workerId, completed }]
    );
  }

  return result.rows[0] ?? null;
}

export async function getStaleLeases() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT ql.*, j.status as job_status FROM queue_leases ql
     JOIN jobs j ON ql.job_id = j.job_id
     WHERE ql.completed = FALSE AND ql.released_at IS NULL AND ql.lease_expires_at < NOW()
     AND j.status NOT IN ('COMPLETED', 'FAILED_FINAL', 'CANCELLED')`
  );
  return result.rows;
}

export async function getWorkerLeases(workerId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM queue_leases WHERE worker_id = $1 AND completed = FALSE AND released_at IS NULL`,
    [workerId]
  );
  return result.rows;
}

export async function getLeaseByJob(jobId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM queue_leases WHERE job_id = $1 AND completed = FALSE AND released_at IS NULL`,
    [jobId]
  );
  return result.rows[0] ?? null;
}

export async function recoverStaleLease(leaseId, workerId) {
  const pool = getPool();
  const result = await withTransaction(pool, async (client) => {
    const leaseResult = await client.query(
      `SELECT * FROM queue_leases WHERE lease_id = $1 FOR UPDATE`,
      [leaseId]
    );
    if (leaseResult.rows.length === 0) {
      throw new DatabaseError('Lease not found', { code: 'ERR_LEASE_NOT_FOUND' });
    }
    const lease = leaseResult.rows[0];
    if (new Date() < new Date(lease.lease_expires_at)) {
      throw new DatabaseError('Lease not stale', { code: 'ERR_LEASE_NOT_STALE' });
    }

    // Release old lease
    await client.query(
      `UPDATE queue_leases SET released_at = NOW() WHERE lease_id = $1`,
      [leaseId]
    );

    // Create new lease for recovering worker
    const newLeaseResult = await client.query(
      `INSERT INTO queue_leases (job_id, worker_id, attempt, lease_expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')
       RETURNING *`,
      [lease.job_id, workerId, lease.attempt + 1]
    );

    // Increment job attempt
    await client.query(
      `UPDATE jobs SET attempt = attempt + 1, status = 'FAILED_RETRYABLE', updated_at = NOW() WHERE job_id = $1`,
      [lease.job_id]
    );

    // Audit events
    await client.query(
      `INSERT INTO audit_events (action, job_id, details) VALUES ($1, $2, $3)`,
      ['LEASE_STALE', lease.job_id, { old_lease_id: leaseId, old_worker_id: lease.worker_id, attempt: lease.attempt }]
    );
    await client.query(
      `INSERT INTO audit_events (action, job_id, details) VALUES ($1, $2, $3)`,
      ['LEASE_ACQUIRED', lease.job_id, { worker_id: workerId, attempt: lease.attempt + 1, recovery: true }]
    );

    return newLeaseResult.rows[0];
  });

  return result;
}