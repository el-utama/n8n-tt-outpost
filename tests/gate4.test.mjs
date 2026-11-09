import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/services/scheduler.mjs';
import { QueueManager, JOB_PRIORITY, JOB_STATES } from '../src/services/queue-manager.mjs';
import { RetentionCleanupService, RETENTION_CLASS } from '../src/services/retention-cleanup.mjs';
import { MetricsCollector, AlertManager, SystemMetricsCollector } from '../src/services/metrics.mjs';
import { randomUUID } from 'node:crypto';

function createMockDb() {
  const jobs = new Map();
  const queueJobs = new Map();
  const schedules = new Map();
  const artifacts = new Map();
  const metrics = [];
  const alerts = new Map();
  const auditEvents = [];
  const telegramIdempotency = new Map();
  const systemHealth = [];

  return {
    jobs,
    queueJobs,
    schedules,
    artifacts,
    metrics,
    alerts,
    auditEvents,
    telegramIdempotency,
    systemHealth,
    async query(sql, params) {
      // Schedules
      if (sql.includes('FROM schedules')) {
        if (sql.includes('INSERT')) {
          const [id, cron, jobType, payload, enabled] = params;
          schedules.set(id, { id, cron, job_type: jobType, payload: JSON.parse(payload), enabled, next_run: null });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('enabled = TRUE')) {
          const due = [];
          for (const s of schedules.values()) {
            if (s.enabled && s.next_run && new Date() >= new Date(s.next_run)) {
              due.push(s);
            }
          }
          return { rows: due };
        }
      }

      // Jobs (both FROM and INSERT INTO)
      if (sql.includes('jobs') && (sql.includes('FROM') || sql.includes('INSERT INTO'))) {
        if (sql.includes('INSERT')) {
          let jobId, userId, idemKey, themeRaw, themeNorm, profile, tz, status, maxAttempts;
          if (params[6] && typeof params[6] === 'string' && params[6].includes('Asia/')) {
            [jobId, userId, idemKey, themeRaw, themeNorm, profile, tz, maxAttempts] = params;
            status = 'RECEIVED';
          } else {
            [jobId, userId, idemKey, themeRaw, themeNorm, profile, tz, status, maxAttempts] = params;
          }
          console.log('MOCKDB: About to set job:', jobId);
          jobs.set(jobId, { job_id: jobId, user_id: userId, idempotency_key: idemKey, theme_raw: themeRaw, theme_normalized: themeNorm, content_profile: profile, timezone: tz, status: status ?? 'RECEIVED', max_attempts: maxAttempts, attempt: 1 });
          console.log('MOCKDB: Job set, jobs.size now:', jobs.size);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('status IN')) {
          const pending = Array.from(jobs.values()).filter(j => ['RECEIVED', 'VALIDATING', 'FAILED_RETRYABLE'].includes(j.status));
          return { rows: pending.slice(0, params[params.length - 1]) };
        }
        if (sql.includes('UPDATE') && sql.includes('status =')) {
          const [newStatus, jobId] = params;
          const job = jobs.get(jobId);
          if (job) { job.status = newStatus; job.updated_at = new Date().toISOString(); }
          return { rows: job ? [job] : [], rowCount: job ? 1 : 0 };
        }
      }

      // Queue jobs
      if (sql.includes('FROM queue_jobs')) {
        if (sql.includes('INSERT')) {
          const [jobId, priority, leaseExpires, metadata] = params;
          queueJobs.set(jobId, { job_id: jobId, priority, status: 'PENDING', lease_expires_at: leaseExpires, metadata: JSON.parse(metadata), attempt: 0, max_attempts: 3, worker_id: null });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('WITH next_job')) {
          for (const [id, job] of queueJobs.entries()) {
            if (job.status === 'PENDING') {
              job.status = 'LEASED';
              job.worker_id = params[0];
              job.lease_expires_at = params[1];
              job.updated_at = new Date().toISOString();
              return { rows: [{ job_id: id, priority: job.priority }] };
            }
          }
          return { rows: [] };
        }
        if (sql.includes('UPDATE queue_jobs SET status') && sql.includes('COMPLETED')) {
          const [jobId, metadata] = params;
          const job = queueJobs.get(jobId);
          if (job) { job.status = 'COMPLETED'; job.updated_at = new Date().toISOString(); job.metadata = JSON.parse(metadata); }
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE queue_jobs SET status') && sql.includes('DEAD_LETTER')) {
          const [jobId, error] = params;
          const job = queueJobs.get(jobId);
          if (job) { job.status = 'DEAD_LETTER'; job.error = error; job.updated_at = new Date().toISOString(); }
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE queue_jobs SET status = \'PENDING\'')) {
          const [jobId, attempt, error] = params;
          const job = queueJobs.get(jobId);
          if (job) { job.status = 'PENDING'; job.attempt = attempt; job.error = error; job.lease_expires_at = null; job.worker_id = null; job.updated_at = new Date().toISOString(); }
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE queue_jobs SET lease_expires_at')) {
          const [jobId, leaseExpires, workerId] = params;
          const job = queueJobs.get(jobId);
          if (job && job.worker_id === workerId) { job.lease_expires_at = leaseExpires; job.updated_at = new Date().toISOString(); return { rows: [], rowCount: 1 }; }
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT') && sql.includes('COUNT(*)')) {
          const pending = Array.from(queueJobs.values()).filter(j => ['PENDING', 'LEASED', 'PROCESSING'].includes(j.status)).length;
          return { rows: [{ count: String(pending) }] };
        }
      }

      // Metrics
      if (sql.includes('INTO metrics')) {
        metrics.push(params);
        return { rows: [], rowCount: 1 };
      }

      // Alerts
      if (sql.includes('INTO alerts')) {
        const [alertId, ruleId, name, severity, message, timestamp, triggerCount] = params;
        alerts.set(alertId, { alert_id: alertId, rule_id: ruleId, name, severity, message, timestamp, trigger_count: triggerCount });
        return { rows: [], rowCount: 1 };
      }

      // Artifacts (for retention)
      if (sql.includes('FROM artifacts')) {
        if (sql.includes('retention_until < NOW')) {
          const expired = Array.from(artifacts.values()).filter(a => new Date(a.retention_until) < new Date());
          return { rows: expired.slice(0, params[params.length - 1]) };
        }
        if (sql.includes('MIN(retention_until)')) {
          return { rows: [{ count: artifacts.size }] };
        }
      }

      // Audit events
      if (sql.includes('INTO audit_events')) {
        auditEvents.push(params);
        return { rows: [], rowCount: 1 };
      }

      // telegram_idempotency
      if (sql.includes('telegram_idempotency')) {
        if (sql.includes('DELETE')) return { rows: [], rowCount: 0 };
      }

      // state_events
      if (sql.includes('state_events')) {
        if (sql.includes('DELETE')) return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    },
    on() {},
    async end() {}
  };
}

function createMockArtifactRegistry(artifacts) {
  return {
    storage: { delete: async () => {} },
    getArtifactBytes: async (uri) => {
      const id = uri.split('/').pop();
      if (!artifacts.has(id)) throw new Error('Not found');
      return Buffer.from('test');
    }
  };
}

function createMockJobStateService(jobs) {
  return {
    moveToValidating: async (jobId) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'VALIDATING'; job.updated_at = new Date().toISOString(); }
      return job;
    },
    getJobById: async (jobId) => jobs.get(jobId) ?? null
  };
}

test('Scheduler creates scheduled jobs', async () => {
  const mockDb = createMockDb();
  const scheduler = new Scheduler({ db: mockDb, clock: () => new Date() });
  
  scheduler.addSchedule({
    id: 'test-schedule-1',
    cron: '* * * * *',
    jobType: 'content_generation',
    payload: { user_id: 123456789, theme_raw: 'Test theme' }
  });
  
  await scheduler.start();
  
  // Trigger a tick
  await scheduler._tick();
  console.log('DEBUG: Jobs in mockDb after tick:', mockDb.jobs.size);
  console.log('DEBUG: mockDb.jobs is Map:', mockDb.jobs instanceof Map);
  for (const [k, v] of mockDb.jobs) console.log('  Job:', k, v.status);
  
  assert.equal(mockDb.jobs.size, 1);
  const job = mockDb.jobs.values().next().value;
  assert.ok(job);
  assert.equal(job.theme_raw, 'Test theme');
  assert.equal(job.status, 'RECEIVED');
  
  await scheduler.stop();
});

test('Scheduler respects disabled schedules', async () => {
  const mockDb = createMockDb();
  const scheduler = new Scheduler({ db: mockDb, clock: () => new Date() });
  
  scheduler.addSchedule({
    id: 'disabled-schedule',
    cron: '* * * * *',
    jobType: 'test',
    payload: {},
    enabled: false
  });
  
  await scheduler.start();
  await scheduler._tick();
  
  assert.equal(mockDb.jobs.size, 0);
  
  await scheduler.stop();
});

test('QueueManager enqueues and leases jobs', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, clock: () => new Date() });
  
  const jobId = randomUUID();
  mockDb.jobs.set(jobId, { job_id: jobId, status: 'RECEIVED' });
  
  await queue.enqueue(jobId, { priority: JOB_PRIORITY.HIGH });
  
  const leased = await queue.leaseNext('worker-1', { count: 1 });
  
  assert.equal(leased.length, 1);
  assert.equal(leased[0].jobId, jobId);
  assert.equal(leased[0].lease.worker_id, 'worker-1');
  
  const queuedJob = mockDb.queueJobs.get(jobId);
  assert.equal(queuedJob.status, 'LEASED');
  assert.equal(queuedJob.worker_id, 'worker-1');
});

test('QueueManager handles job completion', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, clock: () => new Date() });
  
  const jobId = randomUUID();
  mockDb.jobs.set(jobId, { job_id: jobId, status: 'RECEIVED' });
  mockDb.queueJobs.set(jobId, { job_id: jobId, status: 'LEASED', worker_id: 'worker-1', priority: 50 });
  
  await queue.complete(jobId, 'worker-1', { success: true });
  
  const queuedJob = mockDb.queueJobs.get(jobId);
  assert.equal(queuedJob.status, 'COMPLETED');
});

test('QueueManager handles job failure with retry', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, deadLetterMaxRetries: 3, clock: () => new Date() });
  
  const jobId = randomUUID();
  mockDb.jobs.set(jobId, { job_id: jobId, status: 'RECEIVED' });
  mockDb.queueJobs.set(jobId, { job_id: jobId, status: 'LEASED', worker_id: 'worker-1', priority: 50, attempt: 0, max_attempts: 3 });
  
  await queue.complete(jobId, 'worker-1', { success: false, metadata: { error: 'Test error' } });
  
  const queuedJob = mockDb.queueJobs.get(jobId);
  assert.equal(queuedJob.status, 'PENDING');
  assert.equal(queuedJob.attempt, 1);
  assert.ok(queuedJob.error);
});

test('QueueManager moves to dead letter after max retries', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, deadLetterMaxRetries: 2, clock: () => new Date() });
  
  const jobId = randomUUID();
  mockDb.jobs.set(jobId, { job_id: jobId, status: 'RECEIVED' });
  mockDb.queueJobs.set(jobId, { job_id: jobId, status: 'LEASED', worker_id: 'worker-1', priority: 50, attempt: 1, max_attempts: 2 });
  
  await queue.complete(jobId, 'worker-1', { success: false, metadata: { error: 'Final error' } });
  
  const queuedJob = mockDb.queueJobs.get(jobId);
  assert.equal(queuedJob.status, 'DEAD_LETTER');
});

test('QueueManager detects and recovers stale leases', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, defaultLeaseMs: 1000, clock: () => new Date() });
  
  const jobId = randomUUID();
  mockDb.jobs.set(jobId, { job_id: jobId, status: 'RECEIVED' });
  mockDb.queueJobs.set(jobId, { job_id: jobId, status: 'LEASED', worker_id: 'worker-old', priority: 50 });
  
  // Add active lease with expired time
  queue.activeLeases.set(jobId, {
    job_id: jobId,
    worker_id: 'worker-old',
    lease_expires_at: new Date(Date.now() - 2000).toISOString(),
    acquired_at: new Date(Date.now() - 5000)
  });
  
  const recovered = await queue.recoverStaleLeases({ maxStaleMs: 1000 });
  
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0], jobId);
  
  const queuedJob = mockDb.queueJobs.get(jobId);
  assert.equal(queuedJob.status, 'PENDING');
  assert.equal(queuedJob.worker_id, null);
});

test('QueueManager enforces concurrency limit', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, maxConcurrency: 2, clock: () => new Date() });
  
  const jobIds = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of jobIds) {
    mockDb.jobs.set(id, { job_id: id, status: 'RECEIVED' });
    await queue.enqueue(id);
  }
  
  const first = await queue.leaseNext('worker-1', { count: 2 });
  assert.equal(first.length, 2);
  
  const second = await queue.leaseNext('worker-1', { count: 2 });
  assert.equal(second.length, 0); // Concurrency limit reached
});

test('RetentionCleanupService identifies expired artifacts', async () => {
  const mockDb = createMockDb();
  const artifacts = new Map();
  
  // Add expired artifact
  const expiredArtifact = {
    artifact_id: 'expired-1',
    artifact_uri: 'artifact://video/expired-1',
    owner_user_id: 123456789,
    job_id: 'job-1',
    content_package_id: 'pkg-1',
    retention_until: new Date(Date.now() - 1000).toISOString(),
    status: 'ACTIVE'
  };
  artifacts.set('expired-1', expiredArtifact);
  mockDb.artifacts = artifacts;
  
  // Add active artifact (not expired)
  const activeArtifact = {
    artifact_id: 'active-1',
    artifact_uri: 'artifact://video/active-1',
    owner_user_id: 123456789,
    job_id: 'job-2',
    content_package_id: 'pkg-2',
    retention_until: new Date(Date.now() + 86400000).toISOString(),
    status: 'ACTIVE'
  };
  artifacts.set('active-1', activeArtifact);
  
  const artifactRegistry = createMockArtifactRegistry(artifacts);
  
  const cleanup = new RetentionCleanupService({
    db: mockDb,
    artifactRegistry,
    batchSize: 10
  });
  
  const result = await cleanup.runCleanup();
  
  assert.equal(result.deleted, 1);
  assert.equal(result.errors, 0);
  
  const deletedArtifact = artifacts.get('expired-1');
  assert.equal(deletedArtifact.status, 'DELETED');
  
  const stillActive = artifacts.get('active-1');
  assert.equal(stillActive.status, 'ACTIVE');
});

test('RetentionCleanupService skips artifacts with active references', async () => {
  const mockDb = createMockDb();
  const artifacts = new Map();
  
  const artifactWithRef = {
    artifact_id: 'ref-1',
    artifact_uri: 'artifact://video/ref-1',
    owner_user_id: 123456789,
    job_id: 'job-ref',
    content_package_id: 'pkg-ref',
    retention_until: new Date(Date.now() - 1000).toISOString(),
    status: 'ACTIVE'
  };
  artifacts.set('ref-1', artifactWithRef);
  mockDb.artifacts = artifacts;
  
  // Add active job referencing this content package
  mockDb.jobs.set('job-ref', { job_id: 'job-ref', content_package_id: 'pkg-ref', status: 'GENERATING_IDEATION' });
  
  const artifactRegistry = createMockArtifactRegistry(artifacts);
  
  const cleanup = new RetentionCleanupService({
    db: mockDb,
    artifactRegistry,
    batchSize: 10
  });
  
  const result = await cleanup.runCleanup();
  
  // Should not delete because of active job reference
  assert.equal(result.deleted, 0);
  assert.equal(artifacts.get('ref-1').status, 'ACTIVE');
});

test('MetricsCollector records counters, gauges, and histograms', async () => {
  const mockDb = createMockDb();
  
  const collector = new MetricsCollector({ db: mockDb, flushIntervalMs: 1000 });
  await collector.start();
  
  collector.incrementCounter('jobs_created', { status: 'success' }, 5);
  collector.setGauge('queue_depth', { queue: 'default' }, 42);
  collector.observeHistogram('job_duration_ms', { type: 'video' }, 1500);
  collector.observeHistogram('job_duration_ms', { type: 'video' }, 2300);
  collector.observeHistogram('job_duration_ms', { type: 'image' }, 800);
  
  await collector.flush();
  
  assert.equal(collector.getCounter('jobs_created', { status: 'success' }), 5);
  assert.equal(collector.getGauge('queue_depth', { queue: 'default' }), 42);
  
  const histStats = collector.getHistogramStats('job_duration_ms', { type: 'video' });
  assert.equal(histStats.count, 2);
  assert.equal(histStats.min, 1500);
  assert.equal(histStats.max, 2300);
  assert.ok(histStats.avg > 1500 && histStats.avg < 2300);
  
  await collector.stop();
});

test('AlertManager triggers alerts based on thresholds', async () => {
  const mockDb = createMockDb();
  const collector = new MetricsCollector({ db: mockDb });
  const alertManager = new AlertManager({ db: mockDb, metricsCollector: collector, checkIntervalMs: 100 });
  
  let alertTriggered = false;
  let alertData = null;
  
  alertManager.on('alert', (alert) => {
    alertTriggered = true;
    alertData = alert;
  });
  
  alertManager.addRule({
    id: 'high_queue_depth',
    name: 'High Queue Depth',
    condition: { type: 'threshold', metric: 'queue_depth', labels: { queue: 'default' }, operator: 'gt', threshold: 10 },
    severity: 'warning',
    message: 'Queue depth is too high'
  });
  
  await alertManager.start();
  
  collector.setGauge('queue_depth', { queue: 'default' }, 5);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(alertTriggered, false);
  
  collector.setGauge('queue_depth', { queue: 'default' }, 15);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(alertTriggered, true);
  assert.equal(alertData.ruleId, 'high_queue_depth');
  assert.equal(alertData.severity, 'warning');
  
  await alertManager.stop();
});

test('SystemMetricsCollector collects process metrics', async () => {
  const mockDb = createMockDb();
  const collector = new MetricsCollector({ db: mockDb });
  
  const sysCollector = new SystemMetricsCollector({ metricsCollector: collector, collectIntervalMs: 1000 });
  await sysCollector.start();
  
  await new Promise(r => setTimeout(r, 1500));
  
  assert.ok(collector.getGauge('process_memory_rss_bytes') > 0);
  assert.ok(collector.getGauge('process_uptime_seconds') >= 0);
  assert.ok(collector.getGauge('process_cpu_user_seconds') >= 0);
  
  await sysCollector.stop();
});

test('Scheduler calculates next run correctly', () => {
  const mockDb = createMockDb();
  const scheduler = new Scheduler({ db: mockDb, clock: () => new Date('2026-11-09T10:00:00Z') });
  
  // Every minute
  let next = scheduler._calculateNextRun('* * * * *');
  assert.ok(next > new Date('2026-11-09T10:00:00Z'));
  assert.ok(next <= new Date('2026-11-09T10:01:00Z'));
  
  // Every hour at minute 30
  next = scheduler._calculateNextRun('30 * * * *');
  assert.equal(next.getMinutes(), 30);
  
  // Daily at 09:00
  next = scheduler._calculateNextRun('0 9 * * *');
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 0);
  
  // Specific cron: every Monday at 10:30
  next = scheduler._calculateNextRun('30 10 * * 1');
  assert.equal(next.getHours(), 10);
  assert.equal(next.getMinutes(), 30);
  assert.equal(next.getDay(), 1); // Monday
});

test('QueueManager backpressure detection', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ 
    db: mockDb, 
    jobStateService, 
    maxConcurrency: 2, 
    backpressureThreshold: 0.5, // 50% threshold
    clock: () => new Date() 
  });
  
  const jobIds = [randomUUID(), randomUUID()];
  for (const id of jobIds) {
    mockDb.jobs.set(id, { job_id: id, status: 'RECEIVED' });
    await queue.enqueue(id);
  }
  
  // Lease 1 job (50% of maxConcurrency = 1)
  await queue.leaseNext('worker-1', { count: 1 });
  assert.equal(queue.isBackpressured(), false);
  
  // Lease 2nd job (100% of maxConcurrency)
  await queue.leaseNext('worker-1', { count: 1 });
  assert.equal(queue.isBackpressured(), true); // At threshold
  
  // Release one
  await queue.releaseLease(queue.activeLeases.keys().next().value, 'worker-1');
  assert.equal(queue.isBackpressured(), false);
});

test('RetentionPolicy calculates expiry correctly', () => {
  const base = new Date('2026-11-09T10:00:00Z');
  
  const temp = RetentionPolicy.calculateExpiry('TEMPORARY', base);
  assert.equal(temp.getTime(), base.getTime() + 24 * 60 * 60 * 1000);
  
  const delivery = RetentionPolicy.calculateExpiry('DELIVERY', base);
  assert.equal(delivery.getTime(), base.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  const published = RetentionPolicy.calculateExpiry('PUBLISHED_REFERENCE', base);
  assert.equal(published.getTime(), base.getTime() + 90 * 24 * 60 * 60 * 1000);
  
  const source = RetentionPolicy.calculateExpiry('SOURCE_ASSET', base);
  assert.equal(source.getTime(), base.getTime() + 365 * 24 * 60 * 60 * 1000);
});

test('QueueManager getQueueMetrics returns correct data', async () => {
  const mockDb = createMockDb();
  const jobStateService = createMockJobStateService(mockDb.jobs);
  
  const queue = new QueueManager({ db: mockDb, jobStateService, maxConcurrency: 5, clock: () => new Date() });
  
  const jobIds = [randomUUID(), randomUUID()];
  for (const id of jobIds) {
    mockDb.jobs.set(id, { job_id: id, status: 'RECEIVED' });
    await queue.enqueue(id);
  }
  
  await queue.leaseNext('worker-1', { count: 2 });
  await queue.leaseNext('worker-2', { count: 1 });
  
  const metrics = queue.getQueueMetrics();
  
  assert.equal(metrics.activeLeases, 3);
  assert.equal(metrics.maxConcurrency, 5);
  assert.ok(metrics.workers['worker-1']);
  assert.ok(metrics.workers['worker-2']);
  assert.equal(metrics.workers['worker-1'].leased, 2);
  assert.equal(metrics.workers['worker-2'].leased, 1);
});