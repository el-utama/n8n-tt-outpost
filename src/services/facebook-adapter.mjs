import { createHash } from 'node:crypto';

export class FacebookAdapterError extends Error {
  constructor(message, { code = null, retryable = false, status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'FacebookAdapterError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = status;
  }
}

export class FacebookAdapter {
  constructor({
    config = {},
    clock = () => new Date(),
    publishResultRepository,
    artifactRegistry,
  } = {}) {
    this.config = {
      adapter_version: 'mock-1.0.0',
      max_video_size_mb: 1024,
      max_video_duration_sec: 240,
      supports_scheduling: true,
      supports_title: true,
      max_description_length: 5000,
      max_hashtags: 30,
      max_mentions: 50,
      ...config,
    };
    this.clock = clock;
    this.publishResultRepository = publishResultRepository;
    this.artifactRegistry = artifactRegistry;
    this.mockStore = new Map();
  }

  async validateCapabilities(account, contentPackage, policy) {
    return {
      can_publish: account.ownership_verified && account.page_access_valid,
      supported_features: ['video_upload', 'carousel_upload', 'scheduling', 'hashtags', 'mentions', 'location', 'feeling_activity'],
      limits: {
        max_video_size_mb: this.config.max_video_size_mb,
        max_video_duration_sec: this.config.max_video_duration_sec,
        max_description_length: this.config.max_description_length,
        max_hashtags: this.config.max_hashtags,
        max_mentions: this.config.max_mentions,
      },
      warnings: [],
    };
  }

  async buildPayload(contentPackage, platformProfile) {
    return {
      title: contentPackage.ideation?.title ?? null,
      description: this._buildDescription(contentPackage.caption, platformProfile),
      hashtags: contentPackage.caption?.hashtags?.slice(0, this.config.max_hashtags) ?? [],
      mentions: contentPackage.caption?.mentions?.slice(0, this.config.max_mentions) ?? [],
      privacy: platformProfile?.privacy ?? 'EVERYONE',
      scheduled_at: platformProfile?.scheduled_at ?? null,
      platform_options: {
        page_id: platformProfile?.page_id,
        targeting: platformProfile?.targeting,
        allow_comments: platformProfile?.allow_comments ?? true,
        crosspost_pages: platformProfile?.crosspost_pages ?? [],
      },
    };
  }

  _buildDescription(caption, platformProfile) {
    if (!caption) return '';
    const maxLen = platformProfile?.max_description_length ?? this.config.max_description_length;
    let text = caption.body ?? '';
    if (caption.hashtags && caption.hashtags.length > 0) {
      text += '\n\n' + caption.hashtags.join(' ');
    }
    if (text.length > maxLen) text = text.substring(0, maxLen - 3) + '...';
    return text;
  }

  async preflight(payload, session, policy) {
    if (!session || session.status !== 'healthy') {
      return { ok: false, reason: 'SESSION_UNHEALTHY', retryable: false };
    }
    if (policy.decision === 'DENY') {
      return { ok: false, reason: 'POLICY_DENIED', retryable: false };
    }
    return { ok: true };
  }

  async publish(payload, session, idempotencyKey) {
    const remotePostId = `mock_fb_${createHash('sha256').update(idempotencyKey).digest('hex').substring(0, 16)}`;
    const remoteUrl = `https://www.facebook.com/${remotePostId}`;
    
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
    const errorMap = {
      'SESSION_EXPIRED': { code: 'ERR_FACEBOOK_SESSION_INVALID', retryable: false },
      'RATE_LIMIT': { code: 'ERR_FACEBOOK_RATE_LIMIT', retryable: true },
      'MEDIA_REJECTED': { code: 'ERR_FACEBOOK_MEDIA_REJECTED', retryable: false },
      'PERMISSION_DENIED': { code: 'ERR_FACEBOOK_PERMISSION', retryable: false },
      'TIMEOUT': { code: 'ERR_FACEBOOK_TIMEOUT', retryable: true },
      'UNSUPPORTED_FIELD': { code: 'ERR_FACEBOOK_UNSUPPORTED_FIELD', retryable: false },
      'CAPABILITY_UNKNOWN': { code: 'ERR_FACEBOOK_CAPABILITY_UNKNOWN', retryable: false },
    };

    const mapped = errorMap[providerError.code] || { code: 'ERR_FACEBOOK_UNKNOWN', retryable: false };
    return {
      code: mapped.code,
      message: providerError.message,
      retryable: mapped.retryable,
      provider_status: providerError.status,
    };
  }
}

export class MockFacebookSessionManager {
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