import { getJobById } from '../db/queries/jobs.mjs';
import { getLeaseByJob, releaseLease } from '../db/queries/queue_leases.mjs';
import { JobStateService } from './job-state.mjs';
import { QueueLeaseService } from './queue-lease.mjs';

export class CancellationError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'CancellationError';
    this.code = code;
  }
}

export class CancellationService {
  constructor({ jobStateService, queueLeaseService } = {}) {
    this.jobStateService = jobStateService ?? new JobStateService();
    this.queueLeaseService = queueLeaseService ?? new QueueLeaseService();
  }

  async requestCancel(jobId, { actor = 'user', reason = 'user_requested' } = {}) {
    const job = await getJobById(jobId);
    if (!job) throw new CancellationError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });

    if (!this.jobStateService.canCancel(job)) {
      throw new CancellationError(`Cannot cancel job in state: ${job.status}`, { code: 'ERR_CANNOT_CANCEL' });
    }

    return this.jobStateService.requestCancel(jobId, actor, reason);
  }

  async executeCancel(jobId, { actor = 'cancellation_service' } = {}) {
    const job = await getJobById(jobId);
    if (!job) throw new CancellationError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });

    if (job.status !== 'CANCEL_REQUESTED') {
      throw new CancellationError(`Job not in CANCEL_REQUESTED state: ${job.status}`, { code: 'ERR_INVALID_CANCEL_STATE' });
    }

    // Release any active lease
    const lease = await getLeaseByJob(jobId);
    if (lease) {
      await this.queueLeaseService.release(lease.lease_id, lease.worker_id, { completed: false });
    }

    return this.jobStateService.executeCancel(jobId, actor);
  }

  canCancel(job) {
    return this.jobStateService.canCancel(job);
  }

  async getCancellableJobs(userId = null) {
    // This would query for jobs in cancellable states
    // For now, return empty - would be implemented with a proper query
    return [];
  }
}