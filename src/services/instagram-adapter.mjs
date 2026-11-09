import { createHash } from 'node:crypto';

export class InstagramAdapterError extends Error {
  constructor(message, { code = null, retryable = false, status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'InstagramAdapterError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = status;
  }
}

export class InstagramAdapter {
  constructor({
    config = {},
    clock = () => new Date(),
    publishResultRepository,
    artifactRegistry,
  } = {}) {
    this.config = {
      adapter_version: 'mock-1.0.0',
      max_video_size_mb: 1024,
      max_video_duration_sec: 90, // Reels max
      max_carousel_images: 10,
      supports_scheduling: true,
      supports_title: false, // Instagram doesn't use title
      max_caption_length: 2200,
      max_hashtags: 30,
      max_mentions: 20,
      ...config,
    };
    this.clock = clock;
    this.publishResultRepository = publishResultRepository;
    this.artifactRegistry = artifactRegistry;
    this.mockStore = new Map();
  }

  async validateCapabilities(account, contentPackage, policy) {
    return {
      can_publish: account.ownership_verified && account.permission_valid,
      supported_features: ['reels_upload', 'carousel_upload', 'scheduling', 'hashtags', 'mentions', 'location_tag'],
      limits: {
        max_video_size_mb: this.config.max_video_size_mb,
        max_video_duration_sec: this.config.max_video_duration_sec,
        max_carousel_images: this.config.max_carousel_images,
        max_caption_length: this.config.max_caption_length,
        max_hashtags: this.config.max_hashtags,
        max_mentions: this.config.max_mentions,
      },
      warnings: [],
    };
  }

  async buildPayload(contentPackage, platformProfile) {
    // Instagram doesn't use title field
    const caption = this._buildCaption(contentPackage.caption, platformProfile);
    
    return {
      title: null,
      caption: caption.text,
      hashtags: [], // Hashtags moved into caption for Instagram
      mentions: contentPackage.caption?.mentions?.slice(0, this.config.max_mentions) ?? [],
      privacy: platformProfile?.privacy ?? 'public',
      scheduled_at: platformProfile?.scheduled_at ?? null,
      platform_options: {
        media_type: platformProfile?.media_type ?? 'reel',
        cover_image: platformProfile?.cover_image,
        location: platformProfile?.location,
        allow_comments: platformProfile?.allow_comments ?? true,
        allow_sharing: platformProfile?.allow_sharing ?? true,
      },
    };
  }

  _buildCaption(caption, platformProfile) {
    if (!caption) return { text: '', hashtags: [] };
    const maxLen = platformProfile?.max_caption_length ?? this.config.max_caption_length;
    let text = caption.body ?? '';
    const hashtags = (caption.hashtags ?? []).slice(0, this.config.max_hashtags);
    if (hashtags.length > 0) {
      text += '\n\n' + hashtags.join(' ');
    }
    if (text.length > maxLen) text = text.substring(0, maxLen - 3) + '...';
    return { text, hashtags };
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
    const remotePostId = `mock_ig_${createHash('sha256').update(idempotencyKey).digest('hex').substring(0, 16)}`;
    const remoteUrl = `https://www.instagram.com/p/${remotePostId}/`;
    
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
      'SESSION_EXPIRED': { code: 'ERR_INSTAGRAM_SESSION_INVALID', retryable: false },
      'RATE_LIMIT': { code: 'ERR_INSTAGRAM_RATE_LIMIT', retryable: true },
      'MEDIA_REJECTED': { code: 'ERR_INSTAGRAM_MEDIA_REJECTED', retryable: false },
      'PERMISSION_DENIED': { code: 'ERR_INSTAGRAM_PERMISSION', retryable: false },
      'TIMEOUT': { code: 'ERR_INSTAGRAM_TIMEOUT', retryable: true },
      'UNSUPPORTED_FIELD': { code: 'ERR_INSTAGRAM_UNSUPPORTED_FIELD', retryable: false },
      'CAPABILITY_UNKNOWN': { code: 'ERR_INSTAGRAM_CAPABILITY_UNKNOWN', retryable: false },
    };

    const mapped = errorMap[providerError.code] || { code: 'ERR_INSTAGRAM_UNKNOWN', retryable: false };
    return {
      code: mapped.code,
      message: providerError.message,
      retryable: mapped.retryable,
      provider_status: providerError.status,
    };
  }
}

export class MockInstagramSessionManager {
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