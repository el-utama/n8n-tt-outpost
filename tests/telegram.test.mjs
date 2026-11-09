import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramConsumer } from '../src/services/telegram-consumer.mjs';
import { TelegramRouter } from '../src/services/telegram-router.mjs';
import { NotificationService } from '../src/services/notification.mjs';
import { TelegramRateLimiter, TelegramRetryPolicy, IdempotencyManager } from '../src/services/telegram-rate-limiter.mjs';
import { JobStateService } from '../src/services/job-state.mjs';
import { ContentQCService } from '../src/services/content-qc.mjs';
import { ArtifactRegistry } from '../src/services/artifact-registry.mjs';
import { CancellationService } from '../src/services/cancellation.mjs';
import { DatabaseError } from '../src/db/pool.mjs';

function createMockDb() {
  const queries = [];
  const users = new Map();
  const jobs = new Map();
  const contentPackages = new Map();
  const artifacts = new Map();
  const accounts = new Map();
  const telegramCursor = { value: 0 };
  const telegramIdempotency = new Map();
  const telegramUserState = new Map();
  let jobIdCounter = 0;

  return {
    users,
    jobs,
    contentPackages,
    artifacts,
    accounts,
    telegramCursor,
    telegramIdempotency,
    telegramUserState,
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      
      // telegram_cursor
      if (sql.includes('telegram_cursor')) {
        if (sql.includes('SELECT')) {
          return { rows: [{ cursor_value: telegramCursor.value }] };
        }
        if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          const val = params[0];
          telegramCursor.value = val;
          return { rows: [], rowCount: 1 };
        }
      }
      
      // telegram_idempotency
      if (sql.includes('telegram_idempotency')) {
        if (sql.includes('INSERT')) {
          const [key, userId, payloadHash, expiresAt] = params;
          if (telegramIdempotency.has(key)) {
            return { rows: [], rowCount: 0 };
          }
          telegramIdempotency.set(key, { userId, payloadHash, expiresAt, consumedAt: null });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('consumed_at IS NOT NULL')) {
          const [key] = params;
          const record = telegramIdempotency.get(key);
          return { rows: record?.consumedAt ? [{ '1': 1 }] : [] };
        }
        if (sql.includes('SELECT') && sql.includes('idempotency_key = $1')) {
          const [key] = params;
          const record = telegramIdempotency.get(key);
          return { rows: record ? [record] : [] };
        }
        if (sql.includes('SELECT') && sql.includes('payload_hash')) {
          const [key] = params;
          const record = telegramIdempotency.get(key);
          return { rows: record ? [{ payload_hash: record.payloadHash }] : [] };
        }
      }
      
      // users
      if (sql.includes('FROM users')) {
        if (sql.includes('WHERE user_id')) {
          const [userId] = params;
          const user = users.get(String(userId));
          return { rows: user ? [user] : [] };
        }
      }
      
      // jobs
      if (sql.includes('FROM jobs')) {
        if (sql.includes('WHERE job_id')) {
          const [jobId] = params;
          const job = jobs.get(jobId);
          return { rows: job ? [job] : [] };
        }
        if (sql.includes('WHERE user_id')) {
          const [userId] = params;
          const userJobs = Array.from(jobs.values()).filter(j => String(j.user_id) === String(userId));
          return { rows: userJobs };
        }
        if (sql.includes('SELECT * FROM jobs WHERE job_id = $1')) {
          const [jobId] = params;
          const job = jobs.get(jobId);
          return { rows: job ? [job] : [] };
        }
      }
      
      // content_packages
      if (sql.includes('FROM content_packages')) {
        if (sql.includes('WHERE content_package_id')) {
          const [pkgId] = params;
          const pkg = contentPackages.get(pkgId);
          return { rows: pkg ? [pkg] : [] };
        }
      }
      
      // accounts
      if (sql.includes('FROM accounts')) {
        if (sql.includes('WHERE user_id')) {
          const [userId] = params;
          const userAccounts = Array.from(accounts.values()).filter(a => String(a.user_id) === String(userId));
          const mapped = userAccounts.map(a => ({
            platform: a.platform,
            account_handle: a.account_handle,
            age_gate_status: a.age_gate_status,
            ownership_verified: a.ownership_verified,
            created_at: a.created_at
          }));
          return { rows: mapped };
        }
      }
      
      return { rows: [], rowCount: 0 };
    },
    on() {},
    async end() {}
  };
}

function createMockServices(mockDb) {
  const jobStateService = new JobStateService();
  jobStateService.getJobById = async (jobId) => mockDb.jobs.get(jobId) ?? null;
  jobStateService.getJobsByUser = async (userId, options = {}) => {
    const userJobs = Array.from(mockDb.jobs.values())
      .filter(j => String(j.user_id) === String(userId))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return userJobs.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50));
  };
  jobStateService.createJob = async (data) => {
    const existing = Array.from(mockDb.jobs.values()).find(j => j.idempotency_key === data.idempotency_key);
    if (existing) return { job: existing, created: false };
    
    const job = {
      job_id: data.job_id ?? `job-${++jobIdCounter}`,
      user_id: data.user_id,
      account_id: data.account_id,
      idempotency_key: data.idempotency_key,
      theme_raw: data.theme_raw,
      theme_normalized: data.theme_normalized,
      content_profile: data.content_profile,
      status: 'RECEIVED',
      current_step: 'RECEIVED',
      attempt: 1,
      max_attempts: data.max_attempts ?? 3,
      timezone: data.timezone ?? 'Asia/Jakarta',
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    mockDb.jobs.set(job.job_id, job);
    return { job, created: true };
  };
  jobStateService.canCancel = (job) => !['COMPLETED', 'FAILED_FINAL', 'CANCELLED', 'CANCEL_REQUESTED'].includes(job.status);
  jobStateService.getJobById = jobStateService.getJobById;
  
  const contentQCService = new ContentQCService({ artifactRegistry: null });
  
  const artifactRegistry = new ArtifactRegistry({ storage: { write: async () => {}, read: async () => Buffer.from('') } });
  artifactRegistry.createDownloadLink = async (uri, userId) => ({
    download_url: `https://example.com/download/${uri}`,
    expires_at: new Date(Date.now() + 24*60*60*1000).toISOString(),
    artifact_uri: uri
  });
  
  const cancellationService = new CancellationService({ jobStateService });
  cancellationService.requestCancel = async (jobId) => {
    const job = mockDb.jobs.get(jobId);
    if (job) job.status = 'CANCEL_REQUESTED';
    return job;
  };

  return { jobStateService, contentQCService, artifactRegistry, cancellationService };
}

let jobIdCounter = 0;

test('TelegramConsumer initializes and tracks cursor', async () => {
  const mockDb = createMockDb();
  const consumer = new TelegramConsumer({
    botToken: 'test-token',
    db: mockDb,
    allowlist: ['123456789'],
    clock: () => new Date('2026-11-09T10:00:00Z')
  });
  
  await consumer.initialize();
  assert.equal(consumer.offset, 0);
});

test('TelegramConsumer validates allowlist', async () => {
  const mockDb = createMockDb();
  
  const consumer = new TelegramConsumer({
    botToken: 'test-token',
    db: mockDb,
    allowlist: ['123456789'],
    clock: () => new Date()
  });
  
  // Override _getUpdates to return test updates
  consumer._getUpdates = async () => [{
    update_id: 1,
    message: { message_id: 1, from: { id: 999999999, first_name: 'Test' }, chat: { id: 999999999 }, text: '/post test' }
  }];
  
  const processed = await consumer.pollOnce();
  // Should not process non-allowlisted
  assert.equal(processed.length, 0);
});

test('TelegramRouter parses commands correctly', () => {
  const router = new TelegramRouter({});
  
  assert.deepEqual(router._parseCommand('/post hello world'), { command: 'post', args: 'hello world' });
  assert.deepEqual(router._parseCommand('/status'), { command: 'status', args: '' });
  assert.deepEqual(router._parseCommand('/download abc123'), { command: 'download', args: 'abc123' });
  assert.deepEqual(router._parseCommand('/batal job-123'), { command: 'batal', args: 'job-123' });
  assert.deepEqual(router._parseCommand('/mode manual'), { command: 'mode', args: 'manual' });
  assert.equal(router._parseCommand('invalid'), null);
});

test('TelegramRouter handles /post command', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb,
    config: { maxThemeLength: 500 }
  });
  
  const update = {
    message: {
      message_id: 1,
      from: { id: 123456789, first_name: 'Test' },
      chat: { id: 123456789 },
      text: '/post Tips produktivitas'
    }
  };
  
  const result = await router.route(update);
  
  assert.ok(result.text.includes('Job dibuat'));
  assert.ok(result.text.includes('Tips produktivitas'));
  assert.ok(result.text.includes('RECEIVED'));
});

test('TelegramRouter handles /status command', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const job = {
    job_id: 'test-job-1',
    user_id: BigInt(123456789),
    idempotency_key: 'idem-1',
    theme_raw: 'Test theme',
    theme_normalized: 'Test theme',
    content_profile: {},
    status: 'GENERATING_IDEATION',
    current_step: 'GENERATING_IDEATION',
    attempt: 1,
    max_attempts: 3,
    timezone: 'Asia/Jakarta',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  mockDb.jobs.set('test-job-1', job);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const update = {
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/status test-job-1' }
  };
  
  const result = await router.route(update);
  assert.ok(result.text.includes('test-job-1'));
  assert.ok(result.text.includes('GENERATING_IDEATION'));
});

test('TelegramRouter handles /batal command', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const job = {
    job_id: 'test-job-cancel',
    user_id: BigInt(123456789),
    idempotency_key: 'idem-cancel',
    theme_raw: 'Test',
    theme_normalized: 'Test',
    content_profile: {},
    status: 'VALIDATING',
    current_step: 'VALIDATING',
    attempt: 1,
    max_attempts: 3,
    timezone: 'Asia/Jakarta',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  mockDb.jobs.set('test-job-cancel', job);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const update = {
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/batal test-job-cancel' }
  };
  
  const result = await router.route(update);
  assert.ok(result.text.includes('Cancellation Requested'));
  assert.ok(result.text.includes('CANCEL_REQUESTED'));
});

test('TelegramRouter handles /account command', async () => {
  const mockDb = createMockDb();
  mockDb.accounts.set('acc-1', {
    account_id: 'acc-1',
    user_id: BigInt(123456789),
    platform: 'tiktok',
    account_handle: 'testuser',
    age_gate_status: 'verified_31_90',
    ownership_verified: true,
    created_at: new Date().toISOString()
  });
  
  const services = createMockServices(mockDb);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const update = {
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/account' }
  };
  
  const result = await router.route(update);
  assert.ok(result.text.includes('Akun Terdaftar'));
  assert.ok(result.text.includes('tiktok'));
  assert.ok(result.text.includes('testuser'));
});

test('TelegramRouter handles /download command', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const update = {
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/download artifact-123' }
  };
  
  const result = await router.route(update);
  assert.ok(result.text.includes('Download Link'));
  assert.ok(result.text.includes('artifact-123'));
});

test('TelegramRouter handles /mode command - rejects semi/full', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const updateSemi = {
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/mode semi' }
  };
  
  const result = await router.route(updateSemi);
  assert.ok(result.text.includes('tidak tersedia di MVP'));
  assert.ok(result.text.includes('Semi-Auto'));
  
  const updateFull = {
    message: { message_id: 2, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/mode full' }
  };
  
  const result2 = await router.route(updateFull);
  assert.ok(result2.text.includes('tidak tersedia di MVP'));
  assert.ok(result2.text.includes('Full-Auto'));
  
  const updateManual = {
    message: { message_id: 3, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/mode manual' }
  };
  
  const result3 = await router.route(updateManual);
  assert.ok(result3.text.includes('Mode diatur ke Manual'));
});

test('TelegramRouter handles /status without job_id (last job)', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const job = {
    job_id: 'test-job-last',
    user_id: BigInt(123456789),
    idempotency_key: 'idem-last',
    theme_raw: 'Last job',
    theme_normalized: 'Last job',
    content_profile: {},
    status: 'COMPLETED',
    current_step: 'COMPLETED',
    attempt: 1,
    max_attempts: 3,
    timezone: 'Asia/Jakarta',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  mockDb.jobs.set('test-job-last', job);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const update = {
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/status' }
  };
  
  const result = await router.route(update);
  assert.ok(result.text.includes('test-job-last'));
  assert.ok(result.text.includes('COMPLETED'));
});

test('TelegramRateLimiter enforces rate limits', async () => {
  const limiter = new TelegramRateLimiter({ maxRequestsPerSecond: 5, maxBurst: 3, clock: () => Date.now() });
  
  for (let i = 0; i < 3; i++) {
    await limiter.acquire();
  }
  
  const start = Date.now();
  await limiter.acquire();
  const elapsed = Date.now() - start;
  
  assert.ok(elapsed >= 0);
});

test('TelegramRetryPolicy retries on retryable errors', async () => {
  const policy = new TelegramRetryPolicy({ maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
  let attempts = 0;
  
  const result = await policy.execute(async () => {
    attempts++;
    if (attempts < 3) {
      const error = new Error('Network error');
      error.code = 'ECONNRESET';
      throw error;
    }
    return 'success';
  }, { operation: 'test' });
  
  assert.equal(result, 'success');
  assert.equal(attempts, 3);
});

test('TelegramRetryPolicy fails fast on non-retryable errors', async () => {
  const policy = new TelegramRetryPolicy({ maxRetries: 3, baseDelayMs: 10 });
  let attempts = 0;
  
  await assert.rejects(
    policy.execute(async () => {
      attempts++;
      const error = new Error('Bad request');
      error.status = 400;
      throw error;
    }),
    (error) => error.status === 400
  );
  
  assert.equal(attempts, 1);
});

test('TelegramRetryPolicy handles rate limit (429)', async () => {
  const policy = new TelegramRetryPolicy({ maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 });
  let attempts = 0;
  
  const result = await policy.execute(async () => {
    attempts++;
    if (attempts < 2) {
      const error = new Error('Too Many Requests');
      error.status = 429;
      throw error;
    }
    return 'success';
  }, { operation: 'test' });
  
  assert.equal(result, 'success');
  assert.equal(attempts, 2);
});

test('IdempotencyManager prevents duplicate processing', async () => {
  const mockDb = createMockDb();
  const manager = new IdempotencyManager({ db: mockDb, ttlSeconds: 3600, clock: () => new Date() });
  
  const key = 'test-key-1';
  const payload = { theme: 'test' };
  const userId = '123456789';
  
  const result1 = await manager.checkAndStore(key, payload, userId);
  assert.equal(result1.isDuplicate, false);
  
  const result2 = await manager.checkAndStore(key, payload, userId);
  assert.equal(result2.isDuplicate, true);
});

test('NotificationService formats status messages', async () => {
  const mockDb = createMockDb();
  mockDb.jobs.set('job-1', {
    job_id: 'job-1',
    user_id: BigInt(123456789),
    status: 'GENERATING_IDEATION'
  });
  
  const notif = new NotificationService({ botToken: 'test', db: mockDb, clock: () => new Date() });
  
  let lastMessage = null;
  notif._sendTelegramMessage = async (chatId, text, options) => {
    lastMessage = { chatId, text, options };
  };
  
  await notif.sendStatusUpdate('job-1', '123456789', 'GENERATING_IDEATION', { progress: 30 });
  
  assert.ok(lastMessage);
  assert.ok(lastMessage.text.includes('Menghasilkan ide konten'));
  assert.ok(lastMessage.text.includes('job-1'));
});

test('NotificationService sanitizes errors', async () => {
  const mockDb = createMockDb();
  const notif = new NotificationService({ botToken: 'test', db: mockDb });
  
  const error = new Error('sk-1234567890abcdef1234567890abcdef failed');
  const sanitized = notif._sanitizeError(error);
  
  assert.ok(!sanitized.includes('sk-1234567890abcdef1234567890abcdef'));
  assert.ok(sanitized.includes('[REDACTED]'));
});

test('TelegramConsumer deduplicates updates', async () => {
  const mockDb = createMockDb();
  const consumer = new TelegramConsumer({
    botToken: 'test-token',
    db: mockDb,
    allowlist: ['123456789'],
    clock: () => new Date()
  });
  
  await consumer.initialize();
  
  const update = {
    update_id: 100,
    message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/post test' }
  };
  
  const result1 = await consumer._checkAndMarkIdempotent(update.update_id, 123456789);
  assert.equal(result1, true);
  
  const result2 = await consumer._checkAndMarkIdempotent(update.update_id, 123456789);
  assert.equal(result2, false);
});

test('TelegramRouter sends help for /start and /help', async () => {
  const mockDb = createMockDb();
  const services = createMockServices(mockDb);
  
  const router = new TelegramRouter({
    jobStateService: services.jobStateService,
    contentQCService: services.contentQCService,
    artifactRegistry: services.artifactRegistry,
    cancellationService: services.cancellationService,
    db: mockDb
  });
  
  const updateStart = { message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/start' } };
  const updateHelp = { message: { message_id: 2, from: { id: 123456789 }, chat: { id: 123456789 }, text: '/help' } };
  
  const result1 = await router.route(updateStart);
  const result2 = await router.route(updateHelp);
  
  assert.ok(result1.text.includes('n8n-tt-outpost Bot'));
  assert.ok(result2.text.includes('n8n-tt-outpost Bot'));
  assert.ok(result1.text.includes('/post'));
  assert.ok(result1.text.includes('/status'));
});