import { SchemaValidator } from '../core/schema-validator.mjs';

export class PolicyEngineError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'PolicyEngineError';
    this.code = code;
  }
}

const REASON_CODES = {
  AGE_BELOW_THRESHOLD: 'AGE_BELOW_THRESHOLD',
  AGE_UNVERIFIED: 'AGE_UNVERIFIED',
  POLICY_EXPIRED: 'POLICY_EXPIRED',
  DAILY_QUOTA_EXCEEDED: 'DAILY_QUOTA_EXCEEDED',
  PLATFORM_QUOTA_EXCEEDED: 'PLATFORM_QUOTA_EXCEEDED',
  MIN_INTERVAL_NOT_MET: 'MIN_INTERVAL_NOT_MET',
  SESSION_UNHEALTHY: 'SESSION_UNHEALTHY',
  ADAPTER_UNAVAILABLE: 'ADAPTER_UNAVAILABLE',
  CONTENT_QC_FAILED: 'CONTENT_QC_FAILED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED',
  APPROVAL_HASH_MISMATCH: 'APPROVAL_HASH_MISMATCH',
  EMERGENCY_STOP_ACTIVE: 'EMERGENCY_STOP_ACTIVE',
  POLICY_EXPIRED_OR_INACTIVE: 'POLICY_EXPIRED_OR_INACTIVE',
  POLICY_CONFLICT: 'POLICY_CONFLICT',
  SESSION_ACTION_REQUIRED: 'SESSION_ACTION_REQUIRED',
  CAPABILITY_UNKNOWN: 'CAPABILITY_UNKNOWN',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  POLICY_PROFILE_MISSING: 'POLICY_PROFILE_MISSING',
  INVALID_MODE: 'INVALID_MODE',
  MISSING_DATA: 'MISSING_DATA',
};

export class PolicyEngine {
  constructor({
    db,
    featureStage = 'MVP_MANUAL',
    enableF5Publisher = false,
    enableRealProviderCalls = false,
    clock = () => new Date(),
    timezone = 'Asia/Jakarta',
  } = {}) {
    this.db = db;
    this.featureStage = featureStage;
    this.enableF5Publisher = enableF5Publisher;
    this.enableRealProviderCalls = enableRealProviderCalls;
    this.clock = clock;
    this.timezone = timezone;
  }

  async evaluate(context) {
    const {
      userId,
      accountId,
      mode,
      contentPackage,
      policyProfile,
      ageGate,
      platformTargets,
      adapterCapabilities,
      sessionHealth,
      quotaUsage,
      lastPublishTimestamps,
      approval,
      emergencyStopActive,
      contentQcResult,
      featureStage = this.featureStage,
      enableF5Publisher = this.enableF5Publisher,
    } = context;

    const reasonCodes = [];
    let decision = 'ALLOW';
    let requiresApproval = false;

    // 1. Feature flag check
    if (['SEMI_AUTO', 'FULL_AUTO'].includes(mode)) {
      if (featureStage === 'MVP_MANUAL' || !enableF5Publisher) {
        return {
          decision: 'DENY',
          mode,
          reason_codes: [REASON_CODES.FEATURE_DISABLED],
          requires_approval: false,
          checked_at: this.clock().toISOString(),
        };
      }
    }

    // 2. Check ownership and account mapping
    if (!accountId) {
      return {
        decision: 'DENY',
        mode,
        reason_codes: [REASON_CODES.ACCOUNT_NOT_FOUND],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 3. Check mode and TikTok age gate
    if (mode !== 'MANUAL') {
      const ageGateCheck = await this._checkAgeGate(accountId, mode, ageGate);
      if (!ageGateCheck.eligible) {
        return {
          decision: 'DENY',
          mode,
          reason_codes: ageGateCheck.reasonCodes,
          requires_approval: false,
          checked_at: this.clock().toISOString(),
        };
      }
    }

    // 4. Check verification status and conservative policy
    if (mode !== 'MANUAL' && ageGate?.age_gate_status === 'unverified') {
      // Conservative policy: deny automatic modes if age unverified
      return {
        decision: 'DENY',
        mode,
        reason_codes: [REASON_CODES.AGE_UNVERIFIED],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 5. Content package QC
    if (!contentQcResult || contentQcResult.status === 'FAILED') {
      return {
        decision: 'DENY',
        mode,
        reason_codes: [REASON_CODES.CONTENT_QC_FAILED],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 6. Platform capability/session summary
    const capabilityCheck = this._checkCapabilities(platformTargets, adapterCapabilities);
    if (!capabilityCheck.ok) {
      return {
        decision: 'HOLD',
        mode,
        reason_codes: [REASON_CODES.CAPABILITY_UNKNOWN],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
        details: capabilityCheck.details,
      };
    }

    // 7. Session health
    const sessionCheck = this._checkSessionHealth(sessionHealth);
    if (!sessionCheck.healthy) {
      return {
        decision: 'HOLD',
        mode,
        reason_codes: [REASON_CODES.SESSION_UNHEALTHY, REASON_CODES.SESSION_ACTION_REQUIRED],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 8. Emergency stop (check early)
    if (emergencyStopActive) {
      return {
        decision: 'DENY',
        mode,
        reason_codes: [REASON_CODES.EMERGENCY_STOP_ACTIVE],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 9. Policy active window (for FULL_AUTO)
    if (mode === 'FULL_AUTO') {
      const policyCheck = this._checkPolicyActive(policyProfile);
      if (!policyCheck.active) {
        return {
          decision: 'DENY',
          mode,
          reason_codes: [REASON_CODES.POLICY_EXPIRED_OR_INACTIVE],
          requires_approval: false,
          checked_at: this.clock().toISOString(),
        };
      }
    }

    // 10. Daily/total quota check
    const quotaCheck = this._checkQuota(quotaUsage, mode, platformTargets);
    if (!quotaCheck.ok) {
      return {
        decision: 'DENY',
        mode,
        reason_codes: quotaCheck.reasonCodes,
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 9. Minimum interval check
    const intervalCheck = this._checkMinimumInterval(lastPublishTimestamps, mode);
    if (!intervalCheck.ok) {
      return {
        decision: 'HOLD',
        mode,
        reason_codes: [REASON_CODES.MIN_INTERVAL_NOT_MET],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
        next_allowed_at: intervalCheck.nextAllowedAt,
      };
    }

    // 10. Approval check for SEMI_AUTO
    if (mode === 'SEMI_AUTO') {
      const approvalCheck = this._checkApproval(approval);
      if (!approvalCheck.ok) {
        if (approvalCheck.reason === 'REQUIRED') {
          requiresApproval = true;
          decision = 'NEED_APPROVAL';
        } else if (approvalCheck.reason === 'EXPIRED') {
          return {
            decision: 'DENY',
            mode,
            reason_codes: [REASON_CODES.APPROVAL_EXPIRED],
            requires_approval: false,
            checked_at: this.clock().toISOString(),
          };
        } else if (approvalCheck.reason === 'HASH_MISMATCH') {
          return {
            decision: 'DENY',
            mode,
            reason_codes: [REASON_CODES.APPROVAL_HASH_MISMATCH],
            requires_approval: false,
            checked_at: this.clock().toISOString(),
          };
        }
      }
    }

    // 11. Emergency stop (move up before policy check)
    if (emergencyStopActive) {
      return {
        decision: 'DENY',
        mode,
        reason_codes: [REASON_CODES.EMERGENCY_STOP_ACTIVE],
        requires_approval: false,
        checked_at: this.clock().toISOString(),
      };
    }

    // 12. Policy active window (for FULL_AUTO)
    if (mode === 'FULL_AUTO') {
      const policyCheck = this._checkPolicyActive(policyProfile);
      if (!policyCheck.active) {
        return {
          decision: 'DENY',
          mode,
          reason_codes: [REASON_CODES.POLICY_EXPIRED_OR_INACTIVE],
          requires_approval: false,
          checked_at: this.clock().toISOString(),
        };
      }
    }

    // 13. Retry and duplicate constraints
    if (mode === 'FULL_AUTO') {
      const duplicateCheck = this._checkDuplicatePrevention(mode, lastPublishTimestamps);
      if (!duplicateCheck.ok) {
        return {
          decision: 'HOLD',
          mode,
          reason_codes: [REASON_CODES.DUPLICATE_RISK],
          requires_approval: false,
          checked_at: this.clock().toISOString(),
        };
      }
    }

    return {
      decision,
      mode,
      reason_codes: reasonCodes,
      requires_approval: requiresApproval,
      checked_at: this.clock().toISOString(),
      next_allowed_at: intervalCheck?.nextAllowedAt ?? null,
    };
  }

  async _checkAgeGate(accountId, mode, ageGate) {
    if (!ageGate) {
      return { eligible: false, reasonCodes: [REASON_CODES.AGE_UNVERIFIED] };
    }

    const requiredAge = mode === 'FULL_AUTO' ? 90 : 31;

    if (ageGate.age_gate_status === 'unverified') {
      return { eligible: false, reasonCodes: [REASON_CODES.AGE_UNVERIFIED] };
    }

    if (ageGate.age_days !== null && ageGate.age_days < requiredAge) {
      return { eligible: false, reasonCodes: [REASON_CODES.AGE_BELOW_THRESHOLD] };
    }

    return { eligible: true, reasonCodes: [] };
  }

  _checkCapabilities(platformTargets, adapterCapabilities) {
    if (!platformTargets || platformTargets.length === 0) {
      return { ok: true, details: [] };
    }

    const details = [];
    for (const platform of platformTargets) {
      const cap = adapterCapabilities?.find(c => c.platform === platform);
      if (!cap || !cap.is_active) {
        details.push({ platform, reason: 'ADAPTER_UNAVAILABLE' });
      }
    }

    return {
      ok: details.length === 0,
      details,
    };
  }

  _checkSessionHealth(sessionHealth) {
    if (!sessionHealth) return { healthy: true };
    return { healthy: sessionHealth.isHealthy ?? true };
  }

  _checkPolicyActive(policyProfile) {
    if (!policyProfile) return { active: false };

    const now = this.clock();
    const startAt = new Date(policyProfile.start_at);
    const endAt = new Date(startAt.getTime() + policyProfile.duration_days * 24 * 60 * 60 * 1000);

    if (now < startAt || now > endAt) return { active: false };
    if (policyProfile.emergency_stop) return { active: false };
    if (policyProfile.mode !== 'FULL_AUTO') return { active: false };

    return { active: true };
  }

  _checkQuota(quotaUsage, mode, platformTargets) {
    if (!quotaUsage) return { ok: true, reasonCodes: [] };

    const reasonCodes = [];

    if (quotaUsage.dailyTotal >= quotaUsage.maxPostsPerDay) {
      reasonCodes.push('DAILY_QUOTA_EXCEEDED');
    }

    for (const platform of platformTargets) {
      const platformQuota = quotaUsage.platforms?.[platform];
      if (platformQuota && platformQuota.daily >= platformQuota.maxPerDay) {
        reasonCodes.push('PLATFORM_QUOTA_EXCEEDED');
      }
    }

    return { ok: reasonCodes.length === 0, reasonCodes };
  }

  _checkMinimumInterval(lastPublishTimestamps, mode) {
    if (!lastPublishTimestamps || mode === 'MANUAL') {
      return { ok: true };
    }

    const now = this.clock();
    let minInterval = 60; // default 1 hour

    // Would get from policy profile
    const nextAllowedAt = null;

    return { ok: true, nextAllowedAt: nextAllowedAt };
  }

  _checkApproval(approval) {
    if (!approval) return { ok: false, reason: 'REQUIRED' };

    if (approval.status === 'EXPIRED') return { ok: false, reason: 'EXPIRED' };
    if (approval.status === 'REJECTED') return { ok: false, reason: 'REJECTED' };
    if (approval.status !== 'APPROVED') return { ok: false, reason: 'REQUIRED' };

    if (approval.expires_at && new Date() > new Date(approval.expires_at)) {
      return { ok: false, reason: 'EXPIRED' };
    }

    // Hash check would be done here
    return { ok: true };
  }

  _checkDuplicatePrevention(mode, lastPublishTimestamps) {
    // Simplified check - would check for duplicate content
    return { ok: true };
  }
}

export { REASON_CODES };