import { randomUUID } from 'node:crypto';

export class SchedulerError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'SchedulerError';
    this.code = code;
  }
}

const TIMEZONE = 'Asia/Jakarta';

export class Scheduler {
  constructor({
    db,
    clock = () => new Date(),
    timezone = TIMEZONE,
    checkIntervalMs = 5000,
    maxJobsPerCycle = 100
  } = {}) {
    if (!db) throw new SchedulerError('db required', { code: 'ERR_CONFIG' });
    this.db = db;
    this.clock = clock;
    this.timezone = timezone;
    this.checkIntervalMs = checkIntervalMs;
    this.maxJobsPerCycle = maxJobsPerCycle;
    this.running = false;
    this.intervalHandle = null;
    this.schedules = new Map();
    this.listeners = new Map();
  }

  addSchedule(schedule) {
    const { id, cron, jobType, payload, enabled = true } = schedule;
    if (!id || !cron || !jobType) {
      throw new SchedulerError('Schedule must have id, cron, and jobType', { code: 'ERR_INVALID_SCHEDULE' });
    }
    this.schedules.set(id, { id, cron, jobType, payload, enabled, nextRun: this._calculateNextRun(cron) });
  }

  removeSchedule(id) {
    this.schedules.delete(id);
  }

  enableSchedule(id) {
    const s = this.schedules.get(id);
    if (s) { s.enabled = true; s.nextRun = this._calculateNextRun(s.cron); }
  }

  disableSchedule(id) {
    const s = this.schedules.get(id);
    if (s) s.enabled = false;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error(`Scheduler listener error (${event}):`, e); }
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.intervalHandle = setInterval(() => this._tick(), this.checkIntervalMs);
    this._emit('started', { timestamp: this.clock().toISOString() });
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
    this._emit('stopped', { timestamp: this.clock().toISOString() });
  }

  async _tick() {
    const now = this.clock();
    const dueSchedules = [];
    
    for (const [id, schedule] of this.schedules.entries()) {
      if (!schedule.enabled) continue;
      if (schedule.nextRun && now >= schedule.nextRun) {
        dueSchedules.push(schedule);
      }
    }

    if (dueSchedules.length === 0) return;

    const toProcess = dueSchedules.slice(0, this.maxJobsPerCycle);
    
    for (const schedule of toProcess) {
      try {
        this._emit('schedule:trigger', { scheduleId: schedule.id, jobType: schedule.jobType, payload: schedule.payload });
        await this._createScheduledJob(schedule);
        schedule.nextRun = this._calculateNextRun(schedule.cron);
      } catch (error) {
        this._emit('schedule:error', { scheduleId: schedule.id, error: error.message });
      }
    }
  }

  async _createScheduledJob(schedule) {
    const jobId = randomUUID();
    const idempotencyKey = `sched_${schedule.id}_${schedule.nextRun?.getTime() ?? Date.now()}`;
    
    await this.db.query(
      `INSERT INTO jobs (job_id, user_id, idempotency_key, theme_raw, theme_normalized, content_profile, timezone, status, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'RECEIVED', $8)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        jobId,
        schedule.payload.user_id ?? 0,
        idempotencyKey,
        schedule.payload.theme_raw ?? `Scheduled: ${schedule.jobType}`,
        schedule.payload.theme_normalized ?? `Scheduled: ${schedule.jobType}`,
        JSON.stringify(schedule.payload.content_profile ?? {}),
        this.timezone,
        schedule.payload.max_attempts ?? 3
      ]
    );
    
    this._emit('job:created', { jobId, scheduleId: schedule.id, jobType: schedule.jobType });
    return jobId;
  }

  _calculateNextRun(cronExpression) {
    const now = this.clock();
    const next = this._parseCron(cronExpression, now);
    if (!next || next <= now) {
      return new Date(now.getTime() + 60000);
    }
    return next;
  }

  _parseCron(cron, from) {
    const parts = cron.split(' ');
    if (parts.length !== 5) return null;
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const next = new Date(from);
    next.setSeconds(0, 0);
    
    const matches = (value, expr) => expr === '*' || expr.split(',').includes(String(value));
    
    for (let i = 0; i < 366 * 24 * 60; i++) {
      const m = next.getMinutes();
      const h = next.getHours();
      const dom = next.getDate();
      const mo = next.getMonth() + 1;
      const dow = next.getDay();
      
      if (matches(m, minute) && matches(h, hour) && matches(dom, dayOfMonth) && matches(mo, month) && matches(dow, dayOfWeek)) {
        if (next > from) return new Date(next);
      }
      next.setMinutes(next.getMinutes() + 1);
    }
    return null;
  }

  getSchedules() {
    return Array.from(this.schedules.values()).map(s => ({
      id: s.id,
      cron: s.cron,
      jobType: s.jobType,
      enabled: s.enabled,
      nextRun: s.nextRun?.toISOString()
    }));
  }
}

export class ScheduledJobRunner {
  constructor({ db, jobStateService, clock = () => new Date() } = {}) {
    this.db = db;
    this.jobStateService = jobStateService;
    this.clock = clock;
  }

  async runDueJobs({ limit = 50 } = {}) {
    const result = await this.db.query(
      `SELECT j.* FROM jobs j
       WHERE j.status IN ('RECEIVED', 'VALIDATING', 'FAILED_RETRYABLE')
       AND j.updated_at <= NOW() - INTERVAL '30 seconds'
       ORDER BY j.updated_at ASC
       LIMIT $1`,
      [limit]
    );
    
    const jobs = result.rows;
    const processed = [];
    
    for (const job of jobs) {
      try {
        if (job.status === 'RECEIVED') {
          await this.jobStateService.moveToValidating(job.job_id, 'scheduler');
        } else if (job.status === 'FAILED_RETRYABLE' && job.attempt < job.max_attempts) {
          await this.jobStateService.moveToValidating(job.job_id, 'scheduler_retry');
        }
        processed.push(job.job_id);
      } catch (error) {
        console.error(`Failed to schedule job ${job.job_id}:`, error);
      }
    }
    
    return processed;
  }
}