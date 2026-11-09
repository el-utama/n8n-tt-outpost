import { createHash } from 'node:crypto';

export class TikTokAdapterError extends Error {
  constructor(message, { code = null, retryable = false, status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'TikTokAdapterError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = status;
  }
}

export class TikTokAdapter {
  constructor({
    config = {},
    clock = () => new Date(),
    publishResultRepository,
    artifactRegistry,
  } = {}) {
    this.config = {
      adapter_version: 'mock-1.0.0',
      max_video_size_mb: 1024,
      max_video_duration_sec: 180,
      supports_scheduling: true,
      supports_title: true,
      max_caption_length: 2200,
      max_hashtags: 100,
      max_mentions: 10,
      ...config,
    };
    this.clock = clock;
    this.publishResultRepository = publishResultRepository;
    this.artifactRegistry = artifactRegistry;
    this.mockStore = new Map(); // In-memory store for mock responses
  }

  async validateCapabilities(account, contentPackage, policy) {
    // Mock capability check
    const accountAge = account.age_gate_status === 'verified_90_plus' ? 90 : 
                       account.age_gate_status === 'verified_31_90' ? 60 : 30;
    
    const canPublish = accountAge >= 31 && account.ownership_verified;
    
    return {
      can_publish: canPublish,
      account_age_days: accountAge,
      ownership_verified: account.ownership_verified,
      supported_features: ['video_upload', 'scheduling', 'title', 'hashtags', 'mentions'],
      limits: {
        max_video_size_mb: this.config.max_video_size_mb,
        max_video_duration_sec: this.config.max_video_duration_sec,
        max_caption_length: this.config.max_caption_length,
        max_hashtags: this.config.max_hashtags,
        max_mentions: this.config.max_mentions,
      },
      warnings: canPublish ? [] : ['Account age or ownership verification insufficient'],
    };
  }

  async buildPayload(contentPackage, platformProfile) {
    return {
      title: contentPackage.ideation?.title ?? 'TikTok Video',
      caption: this._buildCaption(contentPackage.caption, platformProfile),
      hashtags: contentPackage.caption?.hashtags?.slice(0, this.config.max_hashtags) ?? [],
      mentions: contentPackage.caption?.mentions?.slice(0, this.config.max_mentions) ?? [],
      privacy: platformProfile?.privacy ?? 'public',
      scheduled_at: platformProfile?.scheduled_at ?? null,
      platform_options: {
        video_cover: platformProfile?.video_cover,
        allow_comments: platformProfile?.allow_comments ?? true,
        allow_duet: platformProfile?.allow_duet ?? true,
        allow_stitch: platformProfile?.allow_stitch ?? true,
      },
    };
  }

  _buildCaption(caption, platformProfile) {
    if (!caption) return '';
    const maxLen = platformProfile?.max_caption_length ?? this.config.max_caption_length;
    let text = caption.body ?? '';
    if (caption.hashtags && caption.hashtags.length > 0) {
      text += '\n\n' + caption.hashtags.join(' ');
    }
    if (text.length > maxLen) text = text.substring(0, maxLen - 3) + '...';
    return text;
  }

  async preflight(payload, session, policy) {
    // Check session health
    if (!session || session.status !== 'healthy') {
      return { ok: false, reason: 'SESSION_UNHEALTHY', retryable: false };
    }

    // Check policy decision
    if (policy.decision === 'DENY') {
      return { ok: false, reason: 'POLICY_DENIED', retryable: false };
    }

    // Check video requirements
    // Would check video duration, size, format here

    return { ok: true };
  }

  async publish(payload, session, idempotencyKey) {
    // Mock publish - simulate success/failure
    const remotePostId = `mock_tt_${createHash('sha256').update(idempotencyKey).digest('hex').substring(0, 16)}`;
    const remoteUrl = `https://www.tiktok.com/@mock/video/${remotePostId}`;
    
    // Store mock response for verification
    this.mockStore.set(idempotencyKey, {
      remote_post_id: remotePostId,
      remote_url: remoteUrl,
      published_at: this.clock().toISOString(),
    });

    return {
      remote_post_id: remotePostId,
      remote_url: remoteUrl,
      published_at: this.clock().toISOString(),
    };
  }

  async verify(result) {
    const stored = this.mockStore.get(result.idempotency_key);
    if (!stored) {
      return { verified: false, reason: 'NO_MOCK_RECORD' };
    }
    return {
      verified: true,
      remote_post_id: stored.remote_post_id,
      remote_url: stored.remote_url,
      published_at: stored.published_at,
    };
  }

  normalizeError(providerError) {
    // Map TikTok-specific errors to normalized codes
    const errorMap = {
      'SESSION_EXPIRED': { code: 'ERR_TIKTOK_SESSION_INVALID', retryable: false },
      'RATE_LIMIT': { code: 'ERR_TIKTOK_RATE_LIMIT', retryable: true },
      'MEDIA_TOO_LARGE': { code: 'ERR_TIKTOK_MEDIA_REJECTED', retryable: false },
      'PERMISSION_DENIED': { code: 'ERR_TIKTOK_PERMISSION', retryable: false },
      'TIMEOUT': { code: 'ERR_TIKTOK_TIMEOUT', retryable: true },
      'CAPABILITY_UNKNOWN': { code: 'ERR_TIKTOK_CAPABILITY_UNKNOWN', retryable: false },
    };

    const mapped = errorMap[providerError.code] || { code: 'ERR_TIKTOK_UNKNOWN', retryable: false };
    return {
      code: mapped.code,
      message: providerError.message,
      retryable: mapped.retryable,
      provider_status: providerError.status,
    };
  }
}

export class MockTikTokSessionManager {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.sessions = new Map();
  }

  async getSession(accountId) {
    return this.sessions.get(accountId) ?? { status: 'healthy', expires_at: null };
  }

  async setSession(accountId, sessionData) {
    this.sessions.set(accountId, { ...sessionData, updated_at: this.clock().toISOString() });
  }

  async checkHealth(accountId) {
    const session = this.sessions.get(accountId);
    if (!session) return { status: 'missing', healthy: false };
    if (session.expires_at && this.clock() > new Date(session.expires_at)) {
      return { status: 'expired', healthy: false };
    }
    return { status: 'healthy', healthy: true };
  }
}