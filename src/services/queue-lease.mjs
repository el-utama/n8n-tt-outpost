import { acquireLease, renewLease, releaseLease, getStaleLeases, getWorkerLeases, getLeaseByJob, recoverStaleLease } from '../db/queries/queue_leases.mjs';
import { getJobById, incrementAttempt, updateJobFields } from '../db/queries/jobs.mjs';
import { DatabaseError } from '../db/pool.mjs';

export class QueueLeaseError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'QueueLeaseError';
    this.code = code;
  }
}

export class QueueLeaseService {
  constructor({ defaultTtlSeconds = 300 } = {}) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  async acquire(jobId, workerId, { ttlSeconds = null, attempt = 1 } = {}) {
    try {
      return await acquireLease(jobId, workerId, {
        ttlSeconds: ttlSeconds ?? this.defaultTtlSeconds,
        attempt
      });
    } catch (error) {
      if (error instanceof DatabaseError) {
        throw new QueueLeaseError(error.message, { code: error.code, cause: error });
      }
      throw new QueueLeaseError(`Acquire failed: ${error.message}`, { cause: error });
    }
  }

  async renew(leaseId, workerId, { ttlSeconds = null } = {}) {
    return renewLease(leaseId, workerId, { ttlSeconds: ttlSeconds ?? this.defaultTtlSeconds });
  }

  async release(leaseId, workerId, { completed = false } = {}) {
    return releaseLease(leaseId, workerId, { completed });
  }

  async detectStale() {
    return getStaleLeases();
  }

  async recoverStale(leaseId, newWorkerId) {
    return recoverStaleLease(leaseId, newWorkerId);
  }

  async getWorkerLeases(workerId) {
    return getWorkerLeases(workerId);
  }

  async getJobLease(jobId) {
    return getLeaseByJob(jobId);
  }

  async releaseAllWorkerLeases(workerId, { completed = false } = {}) {
    const leases = await getWorkerLeases(workerId);
    const results = [];
    for (const lease of leases) {
      const result = await releaseLease(lease.lease_id, workerId, { completed });
      results.push(result);
    }
    return results;
  }
}