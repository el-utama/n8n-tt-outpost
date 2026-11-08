import { LEGAL_TRANSITIONS, TERMINAL_STATES } from '../db/queries/jobs.mjs';
import { DatabaseError } from '../db/pool.mjs';

export class JobStateError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'JobStateError';
    this.code = code;
  }
}

export class JobStateService {
  constructor({ 
    clock = () => new Date(),
    // Dependency injection for testing
    getJobById = null,
    getJobByIdempotencyKey = null,
    createJob = null,
    transitionJob = null,
    incrementAttempt = null,
    updateJobFields = null,
    writeAuditEvent = null
  } = {}) {
    this.clock = clock;
    this.queries = {
      getJobById,
      getJobByIdempotencyKey,
      createJob,
      transitionJob,
      incrementAttempt,
      updateJobFields,
      writeAuditEvent
    };
  }

  async createJob({ userId, accountId, idempotencyKey, themeRaw, themeNormalized, contentProfile, timezone, maxAttempts }) {
    const getJobByIdempotencyKey = this.queries.getJobByIdempotencyKey ?? (await import('../db/queries/jobs.mjs')).getJobByIdempotencyKey;
    const createJob = this.queries.createJob ?? (await import('../db/queries/jobs.mjs')).createJob;
    const writeAuditEvent = this.queries.writeAuditEvent ?? (await import('../db/queries/audit_events.mjs')).writeAuditEvent;

    const existing = await getJobByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { job: existing, created: false };
    }

    const job = await createJob({
      job_id: crypto.randomUUID(),
      user_id: userId,
      account_id: accountId,
      idempotency_key: idempotencyKey,
      theme_raw: themeRaw,
      theme_normalized: themeNormalized,
      content_profile: contentProfile,
      timezone: timezone ?? 'Asia/Jakarta',
      max_attempts: maxAttempts ?? 3
    });

    await writeAuditEvent({
      action: 'JOB_CREATED',
      user_id: userId,
      job_id: job.job_id,
      details: { idempotency_key: idempotencyKey, theme_raw: themeRaw }
    });

    return { job, created: true };
  }

  async transition(jobId, fromState, toState, actor, metadata = {}) {
    const getJobById = this.queries.getJobById ?? (await import('../db/queries/jobs.mjs')).getJobById;
    const transitionJob = this.queries.transitionJob ?? (await import('../db/queries/jobs.mjs')).transitionJob;

    const job = await getJobById(jobId);
    if (!job) throw new JobStateError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });

    if (TERMINAL_STATES.includes(job.status)) {
      throw new JobStateError(`Cannot transition from terminal state: ${job.status}`, { code: 'ERR_TERMINAL_STATE' });
    }

    const legal = LEGAL_TRANSITIONS[job.status] ?? [];
    if (!legal.includes(toState)) {
      throw new JobStateError(`Illegal transition: ${job.status} -> ${toState}`, { code: 'ERR_ILLEGAL_TRANSITION' });
    }

    const enrichedMetadata = {
      ...metadata,
      timestamp: this.clock().toISOString(),
      actor,
      attempt: job.attempt,
      max_attempts: job.max_attempts
    };

    const updated = await transitionJob(jobId, job.status, toState, actor, enrichedMetadata);
    return updated;
  }

  async moveToValidating(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'RECEIVED', 'VALIDATING', actor);
  }

  async moveToGeneratingIdeation(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'VALIDATING', 'GENERATING_IDEATION', actor);
  }

  async moveToSourcingMedia(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'GENERATING_IDEATION', 'SOURCING_MEDIA', actor);
  }

  async moveToGeneratingCaption(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'SOURCING_MEDIA', 'GENERATING_CAPTION', actor);
  }

  async moveToGeneratingTTS(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'GENERATING_CAPTION', 'GENERATING_TTS', actor);
  }

  async moveToComposingVideo(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'GENERATING_TTS', 'COMPOSING_VIDEO', actor);
  }

  async moveToValidatingArtifact(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'COMPOSING_VIDEO', 'VALIDATING_ARTIFACT', actor);
  }

  async moveToDelivering(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'VALIDATING_ARTIFACT', 'DELIVERING', actor);
  }

  async moveToReadyForPublish(jobId, actor = 'orchestrator') {
    return this.transition(jobId, 'VALIDATING_ARTIFACT', 'READY_FOR_PUBLISH', actor);
  }

  async complete(jobId, actor = 'orchestrator', metadata = {}) {
    return this.transition(jobId, 'DELIVERING', 'COMPLETED', actor, metadata);
  }

  async failRetryable(jobId, error, actor = 'orchestrator') {
    const getJobById = this.queries.getJobById ?? (await import('../db/queries/jobs.mjs')).getJobById;
    const incrementAttempt = this.queries.incrementAttempt ?? (await import('../db/queries/jobs.mjs')).incrementAttempt;

    const job = await getJobById(jobId);
    if (!job) throw new JobStateError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });

    if (job.attempt >= job.max_attempts) {
      return this.failFinal(jobId, { ...error, reason: 'max_attempts_exceeded' }, actor);
    }

    await incrementAttempt(jobId);
    return this.transition(jobId, job.status, 'FAILED_RETRYABLE', actor, { error });
  }

  async failFinal(jobId, error, actor = 'orchestrator') {
    return this.transition(jobId, 'FAILED_RETRYABLE', 'FAILED_FINAL', actor, { error });
  }

  async requestCancel(jobId, actor = 'user', reason = 'user_requested') {
    const getJobById = this.queries.getJobById ?? (await import('../db/queries/jobs.mjs')).getJobById;

    const job = await getJobById(jobId);
    if (!job) throw new JobStateError('Job not found', { code: 'ERR_JOB_NOT_FOUND' });

    if (TERMINAL_STATES.includes(job.status)) {
      throw new JobStateError(`Cannot cancel from terminal state: ${job.status}`, { code: 'ERR_TERMINAL_STATE' });
    }

    return this.transition(jobId, job.status, 'CANCEL_REQUESTED', actor, { cancel_reason: reason });
  }

  async executeCancel(jobId, actor = 'cancellation_service') {
    return this.transition(jobId, 'CANCEL_REQUESTED', 'CANCELLED', actor, { cancelled_at: this.clock().toISOString() });
  }

  canCancel(job) {
    return !TERMINAL_STATES.includes(job.status) && job.status !== 'CANCEL_REQUESTED';
  }

  isTerminal(state) {
    return TERMINAL_STATES.includes(state);
  }

  isRetryable(state) {
    return state === 'FAILED_RETRYABLE';
  }

  getLegalTransitions(fromState) {
    return LEGAL_TRANSITIONS[fromState] ?? [];
  }
}