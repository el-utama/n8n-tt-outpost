import { randomUUID } from 'node:crypto';

export class QueueManagerError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'QueueManagerError';
    this.code = code;
  }
}

export const JOB_PRIORITY = {
  LOW: 0,
  NORMAL: 50,
  HIGH: 100,
  CRITICAL: 200
};

export const JOB_STATES = {
  PENDING: 'PENDING',
  LEASED: 'LEASED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
  CANCELLED: 'CANCELLED'
};

export class QueueManager {
  constructor({
    db,
    jobStateService,
    clock = () => new Date(),
    defaultLeaseMs = 300000,
    maxConcurrency = 10,
    maxDepth = 10000,
    deadLetterMaxRetries = 3,
    backpressureThreshold = 0.8,
    metricsIntervalMs = 10000
  } = {}) {
    if (!db) throw new QueueManagerError('db required', { code: 'ERR_CONFIG' });
    if (!jobStateService) throw new QueueManagerError('jobStateService required', { code: 'ERR_CONFIG' });
    
    this.db = db;
    this.jobStateService = jobStateService;
    this.clock = clock;
    this.defaultLeaseMs = defaultLeaseMs;
    this.maxConcurrency = maxConcurrency;
    this.maxDepth = maxDepth;
    this.deadLetterMaxRetries = deadLetterMaxRetries;
    this.backpressureThreshold = backpressureThreshold;
    this.metricsIntervalMs = metricsIntervalMs;
    
    this.activeLeases = new Map();
    this.workerMetrics = new Map();
    this.running = false;
    this.metricsInterval = null;
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error(`Queue listener error (${event}):`, e); }
    }
  }

  async enqueue(jobId, { priority = JOB_PRIORITY.NORMAL, leaseMs = null, metadata = {} } = {}) {
    const depth = await this._getQueueDepth();
    if (depth >= this.maxDepth) {
      throw new QueueManagerError('Queue depth exceeded', { code: 'ERR_QUEUE_FULL' });
    }

    const leaseExpiresAt = new Date(this.clock().getTime() + (leaseMs ?? this.defaultLeaseMs));
    
    await this.db.query(
      `INSERT INTO queue_jobs (job_id, priority, status, lease_expires_at, metadata, created_at, updated_at)
       VALUES ($1, $2, 'PENDING', $3, $4, NOW(), NOW())
       ON CONFLICT (job_id) DO UPDATE SET priority = $2, status = 'PENDING', lease_expires_at = $3, metadata = $4, updated_at = NOW()`,
      [jobId, priority, leaseExpiresAt, JSON.stringify(metadata)]
    );

    this._emit('enqueued', { jobId, priority });
    return jobId;
  }

  async leaseNext(workerId, { count = 1, leaseMs = null } = {}) {
    const activeCount = this._getActiveWorkerCount(workerId);
    if (activeCount >= this.maxConcurrency) {
      throw new QueueManagerError('Worker concurrency limit reached', { code: 'ERR_CONCURRENCY_LIMIT' });
    }

    const leasedJobs = [];
    
    for (let i = 0; i < count; i++) {
      const job = await this._acquireNextJob(workerId, leaseMs);
      if (!job) break;
      leasedJobs.push(job);
    }
    
    return leasedJobs;
  }

  async _acquireNextJob(workerId, leaseMs = null) {
    const result = await this.db.query(
      `WITH next_job AS (
        SELECT job_id, priority FROM queue_jobs
        WHERE status = 'PENDING'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE queue_jobs SET
        status = 'LEASED',
        worker_id = $1,
        lease_expires_at = $2,
        updated_at = NOW()
      WHERE job_id IN (SELECT job_id FROM next_job)
      RETURNING job_id, priority`,
      [workerId, new Date(this.clock().getTime() + (leaseMs ?? this.defaultLeaseMs))]
    );

    if (result.rows.length === 0) return null;

    const job = result.rows[0];
    const lease = {
      job_id: job.job_id,
      worker_id: workerId,
      priority: job.priority,
      lease_expires_at: new Date(this.clock().getTime() + (leaseMs ?? this.defaultLeaseMs)),
      acquired_at: this.clock()
    };

    this.activeLeases.set(job.job_id, lease);
    this._updateWorkerMetrics(workerId, 'leased');
    this._emit('leased', { jobId: job.job_id, workerId, priority: job.priority });

    return { jobId: job.job_id, lease };
  }

  async complete(jobId, workerId, { success = true, metadata = {} } = {}) {
    const lease = this.activeLeases.get(jobId);
    if (!lease) throw new QueueManagerError('No active lease for job', { code: 'ERR_NO_LEASE' });
    if (lease.worker_id !== workerId) throw new QueueManagerError('Worker mismatch', { code: 'ERR_WORKER_MISMATCH' });

    if (success) {
      await this.db.query(
        `UPDATE queue_jobs SET status = 'COMPLETED', updated_at = NOW(), metadata = metadata || '{}' || $2 WHERE job_id = $1`,
        [jobId, JSON.stringify(metadata)]
      );
      this._emit('completed', { jobId, workerId });
    } else {
      await this._handleFailure(jobId, workerId, metadata);
    }

    this.activeLeases.delete(jobId);
    this._updateWorkerMetrics(workerId, success ? 'completed' : 'failed');
    return success;
  }

  async _handleFailure(jobId, workerId, errorInfo) {
    const jobResult = await this.db.query(
      `SELECT attempt, max_attempts FROM queue_jobs WHERE job_id = $1`,
      [jobId]
    );
    
    if (jobResult.rows.length === 0) return;
    
    const job = jobResult.rows[0];
    const nextAttempt = (job.attempt ?? 0) + 1;
    
    if (nextAttempt >= (job.max_attempts ?? this.deadLetterMaxRetries)) {
      await this.db.query(
        `UPDATE queue_jobs SET status = 'DEAD_LETTER', error = $2, updated_at = NOW() WHERE job_id = $1`,
        [jobId, JSON.stringify(errorInfo)]
      );
      this._emit('dead_letter', { jobId, workerId, error: errorInfo });
    } else {
      await this.db.query(
        `UPDATE queue_jobs SET status = 'PENDING', attempt = $2, lease_expires_at = NULL, worker_id = NULL, error = $3, updated_at = NOW() WHERE job_id = $1`,
        [jobId, nextAttempt, JSON.stringify(errorInfo)]
      );
      this._emit('retry_scheduled', { jobId, workerId, attempt: nextAttempt, error: errorInfo });
    }
  }

  async releaseLease(jobId, workerId) {
    const lease = this.activeLeases.get(jobId);
    if (!lease || lease.worker_id !== workerId) return false;

    await this.db.query(
      `UPDATE queue_jobs SET status = 'PENDING', worker_id = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE job_id = $1`,
      [jobId]
    );
    
    this.activeLeases.delete(jobId);
    this._updateWorkerMetrics(workerId, 'released');
    this._emit('released', { jobId, workerId });
    return true;
  }

  async renewLease(jobId, workerId, { leaseMs = null } = {}) {
    const lease = this.activeLeases.get(jobId);
    if (!lease || lease.worker_id !== workerId) return false;

    const newExpiry = new Date(this.clock().getTime() + (leaseMs ?? this.defaultLeaseMs));
    
    await this.db.query(
      `UPDATE queue_jobs SET lease_expires_at = $2, updated_at = NOW() WHERE job_id = $1 AND worker_id = $3`,
      [jobId, newExpiry, workerId]
    );
    
    lease.lease_expires_at = newExpiry;
    this._emit('renewed', { jobId, workerId });
    return true;
  }

  async detectStaleLeases({ maxStaleMs = 60000 } = {}) {
    const now = this.clock().getTime();
    const stale = [];
    
    for (const [jobId, lease] of this.activeLeases.entries()) {
      if (now - new Date(lease.lease_expires_at).getTime() > maxStaleMs) {
        stale.push({ jobId, lease });
      }
    }
    
    return stale;
  }

  async recoverStaleLeases({ maxStaleMs = 60000 } = {}) {
    const stale = await this.detectStaleLeases({ maxStaleMs });
    const recovered = [];
    
    for (const { jobId, lease } of stale) {
      try {
        await this.releaseLease(jobId, lease.worker_id);
        await this.db.query(
          `UPDATE queue_jobs SET status = 'PENDING', worker_id = NULL, lease_expires_at = NULL, updated_at = NOW() WHERE job_id = $1`,
          [jobId]
        );
        this._emit('stale_recovered', { jobId, workerId: lease.worker_id });
        recovered.push(jobId);
      } catch (error) {
        this._emit('stale_recovery_failed', { jobId, error: error.message });
      }
    }
    
    return recovered;
  }

  async getDeadLetterJobs({ limit = 100 } = {}) {
    const result = await this.db.query(
      `SELECT * FROM queue_jobs WHERE status = 'DEAD_LETTER' ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async retryDeadLetter(jobId) {
    await this.db.query(
      `UPDATE queue_jobs SET status = 'PENDING', attempt = 0, error = NULL, updated_at = NOW() WHERE job_id = $1`,
      [jobId]
    );
    this._emit('dead_letter_retried', { jobId });
  }

  async purgeDeadLetter({ olderThanDays = 30 } = {}) {
    const result = await this.db.query(
      `DELETE FROM queue_jobs WHERE status = 'DEAD_LETTER' AND updated_at < NOW() - INTERVAL '$1 days'`,
      [olderThanDays]
    );
    this._emit('dead_letter_purged', { count: result.rowCount });
    return result.rowCount;
  }

  async _getQueueDepth() {
    const result = await this.db.query(
      `SELECT COUNT(*) FROM queue_jobs WHERE status IN ('PENDING', 'LEASED', 'PROCESSING')`
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  _getActiveWorkerCount(workerId) {
    let count = 0;
    for (const lease of this.activeLeases.values()) {
      if (lease.worker_id === workerId) count++;
    }
    return count;
  }

  _updateWorkerMetrics(workerId, event) {
    if (!this.workerMetrics.has(workerId)) {
      this.workerMetrics.set(workerId, { leased: 0, completed: 0, failed: 0, released: 0, renewed: 0 });
    }
    const metrics = this.workerMetrics.get(workerId);
    metrics[event] = (metrics[event] ?? 0) + 1;
  }

  getWorkerMetrics(workerId) {
    return this.workerMetrics.get(workerId) ?? { leased: 0, completed: 0, failed: 0, released: 0, renewed: 0 };
  }

  getQueueMetrics() {
    return {
      activeLeases: this.activeLeases.size,
      maxConcurrency: this.maxConcurrency,
      workers: Object.fromEntries(this.workerMetrics)
    };
  }

  isBackpressured() {
    return this.activeLeases.size >= this.maxConcurrency * this.backpressureThreshold;
  }

  async startMetricsCollection() {
    if (this.metricsInterval) return;
    this.metricsInterval = setInterval(() => {
      this._emit('metrics', this.getQueueMetrics());
    }, this.metricsIntervalMs);
  }

  async stopMetricsCollection() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  async start() {
    this.running = true;
    await this.startMetricsCollection();
  }

  async stop() {
    this.running = false;
    await this.stopMetricsCollection();
  }
}

export class QueueBackpressure {
  constructor({ queueManager, threshold = 0.8, checkIntervalMs = 5000 } = {}) {
    this.queueManager = queueManager;
    this.threshold = threshold;
    this.checkIntervalMs = checkIntervalMs;
    this.running = false;
    this.intervalHandle = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.intervalHandle = setInterval(() => this._check(), this.checkIntervalMs);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
  }

  _check() {
    if (this.queueManager.isBackpressured()) {
      this.queueManager._emit('backpressure', { 
        active: this.queueManager.activeLeases.size, 
        threshold: this.queueManager.maxConcurrency * this.threshold 
      });
    }
  }
}