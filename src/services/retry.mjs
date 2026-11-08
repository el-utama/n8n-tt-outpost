import { getJobById, incrementAttempt, updateJobFields } from '../db/queries/jobs.mjs';
import { JobStateService } from './job-state.mjs';

export class RetryError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'RetryError';
    this.code = code;
  }
}

export const RETRYABLE_ERROR_CODES = [
  'ERR_PROVIDER_TIMEOUT',
  'ERR_PROVIDER_RETRYABLE',
  'ERR_PROVIDER_NETWORK',
  'ERR_QUEUE_STALE_LEASE',
  'ERR_DATABASE_DEADLOCK',
  'ERR_TRANSIENT_FAILURE'
];

export const FINAL_ERROR_CODES = [
  'ERR_SCHEMA_VALIDATION',
  'ERR_CONFIG_INVALID',
  'ERR_OWNERSHIP_FAILURE',
  'ERR_POLICY_DENIED',
  'ERR_UNSUPPORTED_MEDIA',
  'ERR_IDEMPOTENCY_CONSUMED',
  'ERR_ILLEGAL_TRANSITION'
];

export class RetryService {
  constructor({ 
    jobStateService,
    baseDelayMs = 1000,
    maxDelayMs = 60000,
    maxRetries = 3,
    jitterFactor = 0.2
  } = {}) {
    this.jobStateService = jobStateService;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxRetries = maxRetries;
    this.jitterFactor = jitterFactor;
  }

  isRetryable(error) {
    if (!error?.code) return false;
    if (FINAL_ERROR_CODES.includes(error.code)) return false;
    return RETRYABLE_ERROR_CODES.includes(error.code) || error.retryable === true;
  }

  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = exponentialDelay * this.jitterFactor * Math.random();
    return Math.min(exponentialDelay + jitter, this.maxDelayMs);
  }

  async handleFailure(jobId, error, actor = 'retry_service') {
    const job = await getJobById(jobId);
    if (!job) throw new RetryError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });

    const retryable = this.isRetryable(error);

    if (!retryable || job.attempt >= job.max_attempts) {
      await this.jobStateService.failFinal(jobId, error, actor);
      return { action: 'failed_final', retryable: false };
    }

    await incrementAttempt(jobId);
    const delay = this.calculateDelay(job.attempt);
    
    await this.jobStateService.failRetryable(jobId, error, actor);
    
    return { 
      action: 'scheduled_retry', 
      retryable: true, 
      nextAttempt: job.attempt + 1,
      delayMs: delay,
      maxAttempts: job.max_attempts
    };
  }

  async shouldRetry(jobId) {
    const job = await getJobById(jobId);
    if (!job) return false;
    return job.status === 'FAILED_RETRYABLE' && job.attempt < job.max_attempts;
  }

  async getRetryableJobs() {
    // This would typically be called by a scheduler
    // For now, we rely on the query in jobs.mjs
    return [];
  }
}