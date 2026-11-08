import { getPool, withTransaction, DatabaseError } from '../pool.mjs';
import { createHash } from 'node:crypto';

export async function acquireIdempotencyKey(key, { jobId = null, operation = 'create_job', payload = null, ttlSeconds = 86400 } = {}) {
  const pool = getPool();
  const payloadHash = payload ? createHash('sha256').update(JSON.stringify(payload)).digest('hex') : null;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    const result = await withTransaction(pool, async (client) => {
      // Try to insert new key
      const insertResult = await client.query(
        `INSERT INTO idempotency_keys (idempotency_key, job_id, operation, payload_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [key, jobId, operation, payloadHash, expiresAt]
      );

      if (insertResult.rows.length > 0) {
        return { acquired: true, existing: false, record: insertResult.rows[0] };
      }

      // Key exists, check if it's still valid
      const existingResult = await client.query(
        `SELECT * FROM idempotency_keys WHERE idempotency_key = $1`,
        [key]
      );
      const existing = existingResult.rows[0];
      
      if (existing.consumed_at) {
        throw new DatabaseError('Idempotency key already consumed', { code: 'ERR_IDEMPOTENCY_CONSUMED' });
      }
      if (new Date() > new Date(existing.expires_at)) {
        throw new DatabaseError('Idempotency key expired', { code: 'ERR_IDEMPOTENCY_EXPIRED' });
      }
      if (existing.payload_hash && payloadHash && existing.payload_hash !== payloadHash) {
        throw new DatabaseError('Idempotency key payload mismatch', { code: 'ERR_IDEMPOTENCY_PAYLOAD_MISMATCH' });
      }

      return { acquired: true, existing: true, record: existing };
    });

    return result;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(`Idempotency acquire failed: ${error.message}`, { cause: error, code: 'ERR_IDEMPOTENCY_ACQUIRE' });
  }
}

export async function releaseIdempotencyKey(key, jobId) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE idempotency_keys SET job_id = $2, consumed_at = NOW() WHERE idempotency_key = $1 AND consumed_at IS NULL RETURNING *`,
    [key, jobId]
  );
  return result.rows[0] ?? null;
}

export async function checkIdempotencyKey(key) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM idempotency_keys WHERE idempotency_key = $1`,
    [key]
  );
  return result.rows[0] ?? null;
}

export async function cleanupExpiredIdempotencyKeys() {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM idempotency_keys WHERE expires_at < NOW() AND consumed_at IS NULL`
  );
  return result.rowCount;
}