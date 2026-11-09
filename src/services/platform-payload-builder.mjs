import { SchemaValidator } from '../core/schema-validator.mjs';

export class PayloadBuilderError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'PayloadBuilderError';
    this.code = code;
  }
}

const PLATFORM_PAYLOAD_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/platform-payload.schema.json',
  title: 'PlatformPayload',
  type: 'object',
  required: ['payload_id', 'publish_intent_id', 'platform', 'adapter_version', 'artifact_uri', 'caption', 'idempotency_key', 'created_at'],
  properties: {
    payload_id: { type: 'string', format: 'uuid' },
    publish_intent_id: { type: 'string', format: 'uuid' },
    platform: { type: 'string', enum: ['tiktok', 'instagram', 'facebook'] },
    adapter_version: { type: 'string' },
    account_id: { type: 'string' },
    artifact_uri: { type: 'string', pattern: '^artifact://[A-Za-z0-9._/-]+$' },
    thumbnail_uri: { type: ['string', 'null'], pattern: '^artifact://[A-Za-z0-9._/-]+$' },
    title: { type: ['string', 'null'], maxLength: 500 },
    caption: { type: 'string', minLength: 1, maxLength: 10000 },
    hashtags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    mentions: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    privacy: { type: ['string', 'null'] },
    scheduled_at: { type: ['string', 'null'], format: 'date-time' },
    platform_options: { type: 'object', additionalProperties: true },
    idempotency_key: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
};

export class PlatformPayloadBuilder {
  constructor({ validator, clock = () => new Date() } = {}) {
    this.validator = validator ?? new SchemaValidator({ schemas: [PLATFORM_PAYLOAD_SCHEMA] });
    this.clock = clock;
  }

  async build(context) {
    const {
      payloadId,
      publishIntentId,
      platform,
      adapterVersion,
      accountId,
      artifactUri,
      thumbnailUri,
      contentPackage,
      platformProfile,
      idempotencyKey,
      scheduledAt,
      platformOptions,
    } = context;

    const baseCaption = contentPackage.caption?.body ?? '';
    const baseHashtags = contentPackage.caption?.hashtags ?? [];
    const baseMentions = contentPackage.caption?.mentions ?? [];

    const payload = {
      payload_id: payloadId,
      publish_intent_id: publishIntentId,
      platform,
      adapter_version: adapterVersion,
      account_id: accountId,
      artifact_uri: artifactUri,
      thumbnail_uri: thumbnailUri ?? null,
      title: null,
      caption: '',
      hashtags: [],
      mentions: [],
      privacy: platformProfile?.privacy ?? null,
      scheduled_at: scheduledAt ?? null,
      platform_options: platformOptions ?? {},
      idempotency_key: idempotencyKey,
      created_at: this.clock().toISOString(),
    };

    // Platform-specific transformation
    const transformed = await this._transformForPlatform(payload, {
      baseCaption,
      baseHashtags,
      baseMentions,
      contentPackage,
      platformProfile,
    });

    this.validator.validate(PLATFORM_PAYLOAD_SCHEMA.$id, transformed);
    return transformed;
  }

  async _transformForPlatform(payload, context) {
    const { platform } = payload;
    const { baseCaption, baseHashtags, baseMentions, contentPackage, platformProfile } = context;

    switch (platform) {
      case 'tiktok':
        return this._buildTikTokPayload(payload, context);
      case 'instagram':
        return this._buildInstagramPayload(payload, context);
      case 'facebook':
        return this._buildFacebookPayload(payload, context);
      default:
        throw new PayloadBuilderError(`Unsupported platform: ${platform}`, { code: 'ERR_UNSUPPORTED_PLATFORM' });
    }
  }

  _buildTikTokPayload(payload, context) {
    const { baseCaption, baseHashtags, baseMentions, platformProfile } = context;
    
    // TikTok supports title, has specific hashtag/mention limits
    const maxCaptionLength = platformProfile?.max_caption_length ?? 2200;
    const maxHashtags = platformProfile?.max_hashtags ?? 100;
    const maxMentions = platformProfile?.max_mentions ?? 10;

    // Build caption with hashtags appended (TikTok style)
    let captionText = this._truncate(baseCaption, maxCaptionLength);
    if (baseHashtags && baseHashtags.length > 0) {
      captionText += '\n\n' + baseHashtags.join(' ');
    }
    if (captionText.length > maxCaptionLength) captionText = captionText.substring(0, maxCaptionLength - 3) + '...';
    
    payload.caption = captionText;
    payload.hashtags = baseHashtags.slice(0, maxHashtags);
    payload.mentions = baseMentions.slice(0, maxMentions);
    
    // TikTok may support title
    if (platformProfile?.supports_title) {
      payload.title = context.contentPackage.ideation?.title ?? null;
    } else {
      payload.title = null;
    }

    payload.privacy = payload.privacy ?? 'public';
    return payload;
  }

  _buildInstagramPayload(payload, context) {
    const { baseCaption, baseHashtags, baseMentions, platformProfile } = context;
    
    // Instagram doesn't use title field
    payload.title = null;
    
    // Instagram caption limits and formatting
    const maxCaptionLength = platformProfile?.max_caption_length ?? 2200;
    const maxHashtags = platformProfile?.max_hashtags ?? 30;
    const maxMentions = platformProfile?.max_mentions ?? 20;

    // Transform caption for Instagram (e.g., add line breaks, move hashtags to end)
    let caption = this._truncate(baseCaption, maxCaptionLength);
    const hashtags = baseHashtags.slice(0, maxHashtags);
    if (hashtags.length > 0) {
      caption += '\n\n' + hashtags.join(' ');
    }
    payload.caption = caption;
    payload.hashtags = []; // Hashtags moved into caption for Instagram
    payload.mentions = baseMentions.slice(0, maxMentions);
    
    // Instagram specific: no title
    payload.title = null;
    payload.privacy = payload.privacy ?? 'public';
    return payload;
  }

  _buildFacebookPayload(payload, context) {
    const { baseCaption, baseHashtags, baseMentions, platformProfile } = context;
    
    // Facebook uses description instead of caption
    const maxDescriptionLength = platformProfile?.max_description_length ?? 5000;
    const maxHashtags = platformProfile?.max_hashtags ?? 30;
    const maxMentions = platformProfile?.max_mentions ?? 50;

    payload.caption = this._truncate(baseCaption, maxDescriptionLength);
    payload.hashtags = baseHashtags.slice(0, maxHashtags);
    payload.mentions = baseMentions.slice(0, maxMentions);
    
    // Facebook may support title for some post types
    if (platformProfile?.supports_title) {
      payload.title = context.contentPackage.ideation?.title ?? null;
    } else {
      payload.title = null;
    }

    payload.privacy = payload.privacy ?? 'EVERYONE';
    return payload;
  }

  _truncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}

export class PlatformCapabilityRegistry {
  constructor({ db, clock = () => new Date() } = {}) {
    this.db = db;
    this.clock = clock;
    this.cache = new Map();
    this.cacheExpiry = null;
  }

  async getCapabilities(platform, adapterVersion) {
    const cacheKey = `${platform}:${adapterVersion}`;
    if (this.cache.has(cacheKey) && this.cacheExpiry && this.clock() < this.cacheExpiry) {
      return this.cache.get(cacheKey);
    }

    const result = await this.db.query(
      `SELECT capability_name, capability_value FROM adapter_capabilities 
       WHERE platform = $1 AND adapter_version = $2 AND is_active = TRUE`,
      [platform, adapterVersion]
    );

    const capabilities = {};
    for (const row of result.rows) {
      capabilities[row.capability_name] = row.capability_value;
    }

    this.cache.set(cacheKey, capabilities);
    this.cacheExpiry = new Date(this.clock().getTime() + 5 * 60 * 1000); // 5 min cache
    return capabilities;
  }

  async setCapability(platform, adapterVersion, capabilityName, capabilityValue) {
    const result = await this.db.query(
      `INSERT INTO adapter_capabilities (platform, adapter_version, capability_name, capability_value, verified_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (platform, adapter_version, capability_name) DO UPDATE SET capability_value = $4, verified_at = NOW()
       RETURNING *`,
      [platform, adapterVersion, capabilityName, JSON.stringify(capabilityValue)]
    );
    this.cache.clear();
    return result.rows[0];
  }

  async checkCapability(platform, adapterVersion, capabilityName) {
    const capabilities = await this.getCapabilities(platform, adapterVersion);
    return capabilities[capabilityName] ?? null;
  }

  async isPlatformSupported(platform, adapterVersion) {
    const caps = await this.getCapabilities(platform, adapterVersion);
    return Object.keys(caps).length > 0;
  }
}