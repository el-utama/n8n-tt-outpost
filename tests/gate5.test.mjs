import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine, REASON_CODES } from '../src/services/policy-engine.mjs';
import { AgeGateService } from '../src/services/age-gate.mjs';
import { BatchApprovalService } from '../src/services/batch-approval.mjs';
import { PlatformPayloadBuilder } from '../src/services/platform-payload-builder.mjs';
import { TikTokAdapter, MockTikTokSessionManager } from '../src/services/tiktok-adapter.mjs';
import { InstagramAdapter, MockInstagramSessionManager } from '../src/services/instagram-adapter.mjs';
import { FacebookAdapter, MockFacebookSessionManager } from '../src/services/facebook-adapter.mjs';
import { ResultVerifier } from '../src/services/result-verifier.mjs';
import { EmergencyStopService } from '../src/services/emergency-stop.mjs';
import { randomUUID } from 'node:crypto';

function createMockDb() {
  const policyProfiles = new Map();
  const ageGates = new Map();
  const batchApprovals = new Map();
  const publishIntents = new Map();
  const publishResults = new Map();
  const adapterCapabilities = new Map();
  const emergencyStops = new Map();
  const accounts = new Map();
  const contentPackages = new Map();

  return {
    policyProfiles,
    ageGates,
    batchApprovals,
    publishIntents,
    publishResults,
    adapterCapabilities,
    emergencyStops,
    accounts,
    contentPackages,
    async query(sql, params) {
      // Policy profiles
      if (sql.includes('policy_profiles')) {
        if (sql.includes('INSERT')) {
          const [id, userId, mode, tz, startAt, duration, maxPerDay, maxPerPlatform, interval, timeWindow, activeDays, activePlatforms, maxBatch, retryLimit, dupPrevention, emergencyStop, authority, confirmedAt, version] = params;
          const profile = { policy_profile_id: id, user_id: userId, mode, timezone: tz, start_at: startAt, duration_days: duration, max_posts_per_day: maxPerDay, max_posts_per_platform_per_day: maxPerPlatform, minimum_interval_minutes: interval, daily_time_window: JSON.parse(timeWindow), active_days: JSON.parse(activeDays), active_platforms: JSON.parse(activePlatforms), max_batch_items: maxBatch, retry_limit: retryLimit, duplicate_prevention: dupPrevention, emergency_stop: emergencyStop, emergency_stop_authority: JSON.parse(authority), confirmed_at: confirmedAt, version };
          policyProfiles.set(id, profile);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('policy_profile_id = $1')) {
          const [id] = params;
          return { rows: policyProfiles.has(id) ? [policyProfiles.get(id)] : [] };
        }
      }

      // Age gates
      if (sql.includes('age_gates')) {
        if (sql.includes('INSERT')) {
          const [accountId, platform, status, ageDays, verifiedAt] = params;
          const id = 'age-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const ageGate = { age_gate_id: id, account_id: accountId, platform, age_gate_status: status, age_days: ageDays, verified_at: verifiedAt };
          ageGates.set(`${accountId}:${platform}`, ageGate);
          return { rows: [ageGate], rowCount: 1 };
        }
        if (sql.includes('SELECT')) {
          const [accountId, platform] = params;
          const key = `${accountId}:${platform}`;
          return { rows: ageGates.has(key) ? [ageGates.get(key)] : [] };
        }
        if (sql.includes('UPDATE')) {
          const [ageDays, verifiedAt, status, id] = params;
          const key = Object.keys(ageGates).find(k => ageGates.get(k).age_gate_id === id);
          if (key) {
            const ag = ageGates.get(key);
            if (ageDays !== undefined) ag.age_days = ageDays;
            if (verifiedAt !== undefined) ag.verified_at = verifiedAt;
            if (status !== undefined) ag.age_gate_status = status;
            ag.updated_at = new Date();
          }
          return { rows: [], rowCount: 1 };
        }
      }

      // Batch approvals
      if (sql.includes('batch_approvals')) {
        if (sql.includes('INSERT')) {
          const [userId, publishIntentId, batchHash, itemCount, platformTargets, proposedSchedule, previewPayload, expiresAt] = params;
          const id = 'batch-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const batch = { batch_id: id, user_id: userId, publish_intent_id: publishIntentId, batch_hash: batchHash, item_count: itemCount, platform_targets: JSON.parse(platformTargets), proposed_schedule: proposedSchedule, preview_payload: JSON.parse(previewPayload), status: 'PENDING_APPROVAL', expires_at: expiresAt, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          batchApprovals.set(id, batch);
          return { rows: [batch], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('batch_id = $1')) {
          const [id] = params;
          return { rows: batchApprovals.has(id) ? [batchApprovals.get(id)] : [] };
        }
        if (sql.includes('UPDATE') && sql.includes('status')) {
          const [status, id] = params;
          if (batchApprovals.has(id)) {
            batchApprovals.get(id).status = status;
            batchApprovals.get(id).updated_at = new Date().toISOString();
          }
          return { rows: [], rowCount: 1 };
        }
      }

      // Publish intents
      if (sql.includes('publish_intents')) {
        if (sql.includes('INSERT')) {
          const [id, jobId, pkgId, userId, accountId, mode, policyProfileId, batchId, approvalId, platforms, schedule, idempotencyKey, status, platformStatus] = params;
          const intent = { publish_intent_id: id, job_id: jobId, content_package_id: pkgId, user_id: userId, account_id: accountId, mode, policy_profile_id: policyProfileId, batch_id: batchId, approval_id: approvalId, platforms: JSON.parse(platforms), intended_schedule: schedule, idempotency_key: idempotencyKey, status, platform_status: JSON.parse(platformStatus), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          publishIntents.set(id, intent);
          return { rows: [intent], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('publish_intent_id = $1')) {
          const [id] = params;
          return { rows: publishIntents.has(id) ? [publishIntents.get(id)] : [] };
        }
      }

      // Publish results
      if (sql.includes('publish_results')) {
        if (sql.includes('INSERT')) {
          const [id, intentId, platform, status, remoteId, remoteUrl, idempotencyKey, adapterVersion, attempt, error] = params;
          publishResults.set(id, { publish_result_id: id, publish_intent_id: intentId, platform, status, remote_post_id: remoteId, remote_url: remoteUrl, idempotency_key: idempotencyKey, adapter_version: adapterVersion, attempt, error: error ? JSON.parse(error) : null, verified_at: null, created_at: new Date().toISOString() });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('UPDATE') && sql.includes('status')) {
          const [status, id] = params;
          if (publishResults.has(id)) {
            publishResults.get(id).status = status;
            publishResults.get(id).updated_at = new Date().toISOString();
          }
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('publish_result_id = $1')) {
          const [id] = params;
          return { rows: publishResults.has(id) ? [publishResults.get(id)] : [] };
        }
      }

      // Adapter capabilities
      if (sql.includes('adapter_capabilities')) {
        if (sql.includes('SELECT')) {
          const [platform, adapterVersion] = params;
          const caps = Array.from(adapterCapabilities.entries())
            .filter(([key]) => key.startsWith(`${platform}:${adapterVersion}:`))
            .map(([key, val]) => ({ capability_name: key.split(':')[2], capability_value: val }));
          return { rows: caps };
        }
      }

      // Emergency stops
      if (sql.includes('emergency_stops')) {
        if (sql.includes('INSERT')) {
          const [triggeredBy, reason, scope, targetId] = params;
          const id = 'stop-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const stop = { stop_id: id, triggered_by: triggeredBy, reason, scope, target_id: targetId, is_active: true, created_at: new Date().toISOString() };
          emergencyStops.set(id, stop);
          return { rows: [stop], rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes('is_active = TRUE')) {
          let scope = 'ALL';
          if (sql.includes("scope = 'PLATFORM'")) scope = 'PLATFORM';
          else if (sql.includes("scope = 'BATCH'")) scope = 'BATCH';
          else if (sql.includes("scope = 'JOB'")) scope = 'JOB';
          
          let targetId = null;
          if (params.length > 0) targetId = params[0];
          
          const active = Array.from(emergencyStops.values()).filter(s => {
            if (!s.is_active) return false;
            if (scope === 'ALL') return s.scope === 'ALL';
            if (scope === 'PLATFORM') return s.scope === 'PLATFORM' && s.target_id === targetId;
            if (scope === 'BATCH') return s.scope === 'BATCH' && s.target_id === targetId;
            if (scope === 'JOB') return s.scope === 'JOB' && s.target_id === targetId;
            return false;
          });
          return { rows: active };
        }
        if (sql.includes('UPDATE') && sql.includes('is_active = FALSE')) {
          const [id, resumedBy] = params;
          if (emergencyStops.has(id)) {
            emergencyStops.get(id).is_active = false;
            emergencyStops.get(id).resumed_at = new Date().toISOString();
            emergencyStops.get(id).resumed_by = resumedBy;
          }
          return { rows: emergencyStops.has(id) ? [emergencyStops.get(id)] : [], rowCount: emergencyStops.has(id) ? 1 : 0 };
        }
      }

      // Accounts
      if (sql.includes('FROM accounts')) {
        if (sql.includes('SELECT') && sql.includes('WHERE user_id')) {
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
        if (sql.includes('SELECT') && sql.includes('WHERE account_id = $1')) {
          const [accountId] = params;
          const account = accounts.get(accountId);
          return { rows: account ? [account] : [] };
        }
      }

      // Content packages
      if (sql.includes('FROM content_packages')) {
        if (sql.includes('SELECT') && sql.includes('WHERE content_package_id')) {
          const [pkgId] = params;
          const pkg = contentPackages.get(pkgId);
          return { rows: pkg ? [pkg] : [] };
        }
      }

      return { rows: [], rowCount: 0 };
    },
    on() {},
    async end() {}
  };
}

function createMockArtifactRegistry() {
  return {
    getArtifactBytes: async (uri) => Buffer.from('mock content'),
  };
}

test('PolicyEngine evaluates MANUAL mode correctly', async () => {
  const mockDb = createMockDb();
  const engine = new PolicyEngine({ db: mockDb, featureStage: 'F5_PUBLISHER', enableF5Publisher: true });

  const result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'MANUAL',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test caption', hashtags: ['#test'] } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_90_plus', age_days: 100 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: false,
    featureStage: 'F5_PUBLISHER',
    enableF5Publisher: true,
  });

  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.mode, 'MANUAL');
});

test('PolicyEngine denies SEMI_AUTO when feature disabled', async () => {
  const mockDb = createMockDb();
  const engine = new PolicyEngine({ db: mockDb, featureStage: 'MVP_MANUAL' });

  const result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'SEMI_AUTO',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test' } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_90_plus', age_days: 100 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: false,
    featureStage: 'MVP_MANUAL',
    enableF5Publisher: false,
  });

  assert.equal(result.decision, 'DENY');
  assert.equal(result.reason_codes[0], 'FEATURE_DISABLED');
});

test('PolicyEngine checks TikTok age gate for SEMI_AUTO', async () => {
  const mockDb = createMockDb();
  const engine = new PolicyEngine({ db: mockDb, featureStage: 'F5_PUBLISHER', enableF5Publisher: true });

  // Age below 31 days
  let result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'SEMI_AUTO',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test' } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_0_30', age_days: 15 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: false,
    featureStage: 'F5_PUBLISHER',
    enableF5Publisher: true,
  });

  assert.equal(result.decision, 'DENY');
  assert.equal(result.reason_codes[0], 'AGE_BELOW_THRESHOLD');

  // Age 31+ days should be allowed (if other checks pass)
  result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'SEMI_AUTO',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test' } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_31_90', age_days: 45 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: false,
    featureStage: 'F5_PUBLISHER',
    enableF5Publisher: true,
  });

  // Should be ALLOW or HOLD depending on other factors
  assert.ok(['ALLOW', 'HOLD', 'NEED_APPROVAL'].includes(result.decision));
});

test('PolicyEngine checks FULL_AUTO age gate (90 days)', async () => {
  const mockDb = createMockDb();
  const engine = new PolicyEngine({ db: mockDb, featureStage: 'F5_PUBLISHER', enableF5Publisher: true });

  let result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'FULL_AUTO',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test' } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_31_90', age_days: 45 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: false,
    featureStage: 'F5_PUBLISHER',
    enableF5Publisher: true,
  });

  assert.equal(result.decision, 'DENY');
  assert.equal(result.reason_codes[0], 'AGE_BELOW_THRESHOLD');

  // 90+ days
  result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'FULL_AUTO',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test' } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_90_plus', age_days: 100 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: false,
    policyProfile: { mode: 'FULL_AUTO', start_at: new Date(Date.now() - 86400000).toISOString(), duration_days: 30, emergency_stop: false, mode: 'FULL_AUTO' },
    featureStage: 'F5_PUBLISHER',
    enableF5Publisher: true,
  });

  assert.ok(['ALLOW', 'HOLD', 'NEED_APPROVAL'].includes(result.decision));
});

test('PolicyEngine respects emergency stop', async () => {
  const mockDb = createMockDb();
  const engine = new PolicyEngine({ db: mockDb, featureStage: 'F5_PUBLISHER', enableF5Publisher: true });

  const result = await engine.evaluate({
    userId: '123456789',
    accountId: 'acc-1',
    mode: 'FULL_AUTO',
    contentPackage: { ideation: { title: 'Test' }, caption: { body: 'Test' } },
    contentQcResult: { status: 'PASSED' },
    ageGate: { age_gate_status: 'verified_90_plus', age_days: 100 },
    platformTargets: ['tiktok'],
    adapterCapabilities: [{ platform: 'tiktok', is_active: true }],
    sessionHealth: { isHealthy: true },
    quotaUsage: { dailyTotal: 0, maxPostsPerDay: 10 },
    lastPublishTimestamps: [],
    emergencyStopActive: true,
    featureStage: 'F5_PUBLISHER',
    enableF5Publisher: true,
  });

  assert.equal(result.decision, 'DENY');
  assert.equal(result.reason_codes[0], 'EMERGENCY_STOP_ACTIVE');
});

test('AgeGateService evaluates age eligibility', async () => {
  const mockDb = createMockDb();
  // Add account to mock DB
  mockDb.accounts.set('acc-1', { account_id: 'acc-1', user_id: BigInt(123456789), platform: 'tiktok' });
  const service = new AgeGateService({ db: mockDb });

  // Create age gate
  const ageGate = await service.verify('acc-1', 'tiktok', { ageDays: 45 });
  assert.equal(ageGate.age_gate_status, 'verified_31_90');
  assert.equal(ageGate.age_days, 45);

  // Check eligibility
  const semiAuto = service.isEligibleForMode(ageGate, 'SEMI_AUTO');
  assert.equal(semiAuto.eligible, true);

  const fullAuto = service.isEligibleForMode(ageGate, 'FULL_AUTO');
  assert.equal(fullAuto.eligible, false);
  assert.equal(fullAuto.reason, 'AGE_BELOW_THRESHOLD');
});

test('BatchApprovalService creates and manages batch approvals', async () => {
  const mockDb = createMockDb();
  // Add content packages to mock DB for ownership check
  const pkgId1 = randomUUID();
  const pkgId2 = randomUUID();
  mockDb.contentPackages.set(pkgId1, { content_package_id: pkgId1, user_id: BigInt(123456789) });
  mockDb.contentPackages.set(pkgId2, { content_package_id: pkgId2, user_id: BigInt(123456789) });
  
  const service = new BatchApprovalService({ db: mockDb });

  const publishIntentId = randomUUID();
  const pkgIds = [pkgId1, pkgId2];

  const batch = await service.createBatch({
    userId: '123456789',
    publishIntentId,
    contentPackageIds: pkgIds,
    platformTargets: ['tiktok', 'instagram'],
    proposedSchedule: new Date(Date.now() + 3600000).toISOString(),
    previewPayload: { quota_impact: { daily_total: 2 } },
  });

  assert.ok(batch.batch_id);
  assert.equal(batch.status, 'PENDING_APPROVAL');
  assert.equal(batch.item_count, 2);
  assert.ok(batch.batch_hash);

  // Test approve
  const approved = await service.approve(batch.batch_id, '123456789', { batchHash: batch.batch_hash });
  assert.equal(approved.status, 'APPROVED');
  assert.ok(approved.approved_by);

  // Test reject on new batch
  const pkgId3 = randomUUID();
  mockDb.contentPackages.set(pkgId3, { content_package_id: pkgId3, user_id: BigInt(123456789) });
  const batch2 = await service.createBatch({
    userId: '123456789',
    publishIntentId: randomUUID(),
    contentPackageIds: [pkgId3],
    platformTargets: ['tiktok'],
    previewPayload: {},
  });
  const rejected = await service.reject(batch2.batch_id, '123456789');
  assert.equal(rejected.status, 'REJECTED');
});

test('PlatformPayloadBuilder builds platform-specific payloads', async () => {
  const builder = new PlatformPayloadBuilder();
  const payloadId = randomUUID();
  const intentId = randomUUID();

  const contentPackage = {
    ideation: { title: 'Test Title' },
    caption: { body: 'Test caption', hashtags: ['#test', '#demo'], mentions: ['@user'] },
  };

  // TikTok payload
  const tiktokPayload = await builder.build({
    payloadId: randomUUID(),
    publishIntentId: intentId,
    platform: 'tiktok',
    adapterVersion: '1.0.0',
    accountId: 'acc-1',
    artifactUri: 'artifact://video/abc123',
    thumbnailUri: 'artifact://image/thumb123',
    contentPackage,
    platformProfile: { max_caption_length: 2200, max_hashtags: 100, max_mentions: 10, supports_title: true, privacy: 'public' },
    idempotencyKey: 'idem-1',
  });

  assert.equal(tiktokPayload.platform, 'tiktok');
  assert.ok(tiktokPayload.title);
  assert.ok(tiktokPayload.caption.includes('#test'));
  assert.equal(tiktokPayload.hashtags.length, 2);

  // Instagram payload (no title, hashtags in caption)
  const igPayload = await builder.build({
    payloadId: randomUUID(),
    publishIntentId: intentId,
    platform: 'instagram',
    adapterVersion: '1.0.0',
    accountId: 'acc-1',
    artifactUri: 'artifact://video/abc123',
    contentPackage,
    platformProfile: { max_caption_length: 2200, max_hashtags: 30, max_mentions: 20, privacy: 'public' },
    idempotencyKey: 'idem-2',
  });

  assert.equal(igPayload.platform, 'instagram');
  assert.equal(igPayload.title, null);
  assert.ok(igPayload.caption.includes('#test'));
  assert.equal(igPayload.hashtags.length, 0); // Hashtags moved to caption

  // Facebook payload
  const fbPayload = await builder.build({
    payloadId: randomUUID(),
    publishIntentId: intentId,
    platform: 'facebook',
    adapterVersion: '1.0.0',
    accountId: 'acc-1',
    artifactUri: 'artifact://video/abc123',
    contentPackage,
    platformProfile: { max_description_length: 5000, max_hashtags: 30, max_mentions: 50, supports_title: true, privacy: 'EVERYONE' },
    idempotencyKey: 'idem-3',
  });

  assert.equal(fbPayload.platform, 'facebook');
  assert.ok(fbPayload.title);
  assert.ok(fbPayload.caption);
});

test('TikTokAdapter mock publish and verify', async () => {
  const artifactRegistry = { getArtifactBytes: async () => Buffer.from('mock') };
  const adapter = new TikTokAdapter({ config: { adapter_version: 'mock-1.0.0' }, artifactRegistry });

  const payload = {
    title: 'Test TikTok',
    caption: 'Test caption #hashtag',
    hashtags: ['#hashtag'],
    mentions: [],
    privacy: 'public',
  };

  const idemKey = 'test-idem-1';
  const result = await adapter.publish(payload, { status: 'healthy' }, idemKey);

  assert.ok(result.remote_post_id);
  assert.ok(result.remote_url);
  assert.ok(result.published_at);

  // Verify
  const verification = await adapter.verify({ idempotency_key: idemKey });
  assert.equal(verification.verified, true);
  assert.equal(verification.remote_post_id, result.remote_post_id);
});

test('InstagramAdapter mock publish and verify', async () => {
  const artifactRegistry = { getArtifactBytes: async () => Buffer.from('mock') };
  const adapter = new InstagramAdapter({ config: { adapter_version: 'mock-1.0.0' }, artifactRegistry });

  const payload = {
    title: null,
    caption: 'Test Instagram caption #hashtag',
    hashtags: [],
    mentions: ['@user'],
    privacy: 'public',
  };

  const idemKey = 'test-ig-1';
  const result = await adapter.publish(payload, { status: 'healthy' }, idemKey);

  assert.ok(result.remote_post_id);
  assert.ok(result.remote_url);

  const verification = await adapter.verify({ idempotency_key: idemKey });
  assert.equal(verification.verified, true);
});

test('FacebookAdapter mock publish and verify', async () => {
  const artifactRegistry = { getArtifactBytes: async () => Buffer.from('mock') };
  const adapter = new FacebookAdapter({ config: { adapter_version: 'mock-1.0.0' }, artifactRegistry });

  const payload = {
    title: 'Test Facebook Post',
    description: 'Test description #hashtag',
    hashtags: ['#hashtag'],
    mentions: [],
    privacy: 'EVERYONE',
  };

  const idemKey = 'test-fb-1';
  const result = await adapter.publish(payload, { status: 'healthy' }, idemKey);

  assert.ok(result.remote_post_id);
  assert.ok(result.remote_url);

  const verification = await adapter.verify({ idempotency_key: idemKey });
  assert.equal(verification.verified, true);
});

test('ResultVerifier verifies publish results', async () => {
  const mockDb = createMockDb();
  // Create a mock adapter that returns verified result
  const mockAdapter = {
    async verify(publishResult) {
      return {
        verified: true,
        remote_post_id: 'mock_post_id',
        remote_url: 'https://mock.tiktok.com/post/mock_post_id',
        published_at: new Date().toISOString(),
      };
    },
  };
  const verifier = new ResultVerifier({ adapters: { tiktok: mockAdapter }, db: mockDb });

  const publishResult = {
    publish_result_id: randomUUID(),
    publish_intent_id: randomUUID(),
    platform: 'tiktok',
    status: 'PENDING_VERIFICATION',
    idempotency_key: 'test-idem',
    adapter_version: 'mock-1.0.0',
    attempt: 1,
  };

  const result = await verifier.verify(publishResult);
  assert.equal(result.status, 'PUBLISHED');
  assert.ok(result.verification.verified);
});

test('EmergencyStopService triggers and resumes stops', async () => {
  const mockDb = createMockDb();
  const service = new EmergencyStopService({ db: mockDb });

  // Trigger global stop
  const stop = await service.trigger('admin-1', 'Maintenance window', { scope: 'ALL' });
  assert.ok(stop.stop_id);
  assert.equal(stop.is_active, true);
  assert.equal(stop.scope, 'ALL');

  const active = await service.isActive({ scope: 'ALL' });
  assert.equal(active, true);

  // Resume
  const resumed = await service.resume(stop.stop_id, 'admin-1');
  assert.equal(resumed.is_active, false);
  assert.ok(resumed.resumed_at);

  const activeAfter = await service.isActive({ scope: 'ALL' });
  assert.equal(activeAfter, false);
});

test('EmergencyStopService scopes', async () => {
  const mockDb = createMockDb();
  const service = new EmergencyStopService({ db: mockDb });

  const batchId = randomUUID();
  await service.trigger('admin-1', 'Batch issue', { scope: 'BATCH', targetId: batchId });

  const batchActive = await service.isActive({ scope: 'BATCH', targetId: batchId });
  assert.equal(batchActive, true);

  const globalActive = await service.isActive({ scope: 'ALL' });
  assert.equal(globalActive, false); // Batch stop doesn't activate global

  const platformId = 'tiktok';
  await service.trigger('admin-1', 'Platform issue', { scope: 'PLATFORM', targetId: platformId });
  const platformActive = await service.isActive({ scope: 'PLATFORM', targetId: platformId });
  assert.equal(platformActive, true);
});

test('PlatformCapabilityRegistry caches capabilities', async () => {
  const mockDb = createMockDb();
  // Pre-populate capabilities - value should be the capability value directly
  mockDb.adapterCapabilities.set('tiktok:mock-1.0.0:max_video_size_mb', 1024);
  mockDb.adapterCapabilities.set('tiktok:mock-1.0.0:supports_scheduling', true);

  const { PlatformCapabilityRegistry } = await import('../src/services/platform-payload-builder.mjs');
  const capRegistry = new PlatformCapabilityRegistry({ db: mockDb });

  const caps = await capRegistry.getCapabilities('tiktok', 'mock-1.0.0');
  assert.equal(caps.max_video_size_mb, 1024);
  assert.equal(caps.supports_scheduling, true);
});