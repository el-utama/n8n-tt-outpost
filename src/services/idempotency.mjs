import { acquireIdempotencyKey, releaseIdempotencyKey, checkIdempotencyKey, cleanupExpiredIdempotencyKeys } from '../db/queries/idempotency.mjs';
import { DatabaseError } from '../db/pool.mjs';

export class IdempotencyError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'IdempotencyError';
    this.code = code;
  }
}

export class IdempotencyService {
  constructor({ defaultTtlSeconds = 86400 } = {}) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  async acquire(key, { jobId = null, operation = 'create_job', payload = null, ttlSeconds = null } = {}) {
    try {
      const result = await acquireIdempotencyKey(key, {
        jobId,
        operation,
        payload,
        ttlSeconds: ttlSeconds ?? this.defaultTtlSeconds
      });
      return result;
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw new IdempotencyError(error.message, { code: error.code, cause: error });
      }
      throw new IdempotencyError(`Acquire failed: ${error.message}`, { cause: error });
    }
  }

  async release(key, jobId) {
    const result = await releaseIdempotencyKey(key, jobId);
    return result ?? null;
  }

  async check(key) {
    const record = await checkIdempotencyKey(key);
    if (!record) return { exists: false };
    
    const now = new Date();
    const expired = now > new Date(record.expires_at);
    const consumed = !!record.consumed_at;
    
    return {
      exists: true,
      consumed,
      expired,
      valid: !consumed && !expired,
      record
    };
  }

  async cleanup() {
    return cleanupExpiredIdempotencyKeys();
  }
}