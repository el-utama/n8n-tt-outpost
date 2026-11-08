import { SchemaValidator, SchemaValidationError } from '../core/schema-validator.mjs';
import { createHash } from 'node:crypto';

export class MediaSourcingError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'MediaSourcingError';
    this.code = code;
  }
}

const MEDIA_ASSET_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/media-asset-output.schema.json',
  title: 'MediaAssetOutput',
  type: 'object',
  required: ['asset_id', 'asset_uri', 'media_type', 'sha256', 'source'],
  properties: {
    asset_id: { type: 'string', format: 'uuid' },
    asset_uri: { type: 'string', pattern: '^asset://[A-Za-z0-9._/-]+$' },
    media_type: { type: 'string', enum: ['image', 'video', 'audio'] },
    width: { type: ['integer', 'null'], minimum: 1 },
    height: { type: ['integer', 'null'], minimum: 1 },
    duration_sec: { type: ['number', 'null'], minimum: 0 },
    sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    source: {
      type: 'object',
      required: ['provider', 'source_url', 'terms_url', 'retrieved_at'],
      properties: {
        provider: { type: 'string', minLength: 1 },
        provider_asset_id: { type: ['string', 'null'] },
        source_url: { type: 'string', format: 'uri' },
        author: { type: ['string', 'null'] },
        terms_url: { type: 'string', format: 'uri' },
        attribution_required: { type: 'boolean' },
        retrieved_at: { type: 'string', format: 'date-time' }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export class MediaProvider {
  constructor({ name, timeoutMs = 10000, maxRetries = 2, rateLimitPerMin = 60 } = {}) {
    this.name = name;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.rateLimitPerMin = rateLimitPerMin;
    this.requestTimes = [];
  }

  async search(keywords, { mediaType = 'image', count = 1, orientation = 'portrait', minWidth = 1080, minHeight = 1920 } = {}) {
    throw new Error('search() must be implemented by provider');
  }

  async download(asset, { signal = null } = {}) {
    throw new Error('download() must be implemented by provider');
  }

  async _rateLimit() {
    const now = Date.now();
    this.requestTimes = this.requestTimes.filter(t => now - t < 60000);
    if (this.requestTimes.length >= this.rateLimitPerMin) {
      const waitMs = 60000 - (now - this.requestTimes[0]);
      await new Promise(r => setTimeout(r, waitMs));
    }
    this.requestTimes.push(now);
  }

  async _withTimeout(promise, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Timeout')));
      })]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class MockMediaProvider extends MediaProvider {
  constructor(options = {}) {
    super({ name: 'mock', ...options });
    this.mockAssets = new Map();
    this.fallbackAsset = null;
    this.downloadCounter = 0;
  }

  setFallbackAsset(asset) {
    this.fallbackAsset = asset;
  }

  addMockAsset(keywords, asset) {
    const key = keywords.sort().join(',');
    if (!this.mockAssets.has(key)) {
      this.mockAssets.set(key, []);
    }
    this.mockAssets.get(key).push(asset);
  }

  async search(keywords, options = {}) {
    await this._rateLimit();
    
    const key = keywords.sort().join(',');
    const assets = this.mockAssets.get(key) ?? [];
    
    if (assets.length > 0) {
      return assets.slice(0, options.count ?? 1);
    }
    
    // Return fallback asset if available
    if (this.fallbackAsset) {
      return [this.fallbackAsset];
    }
    
    throw new MediaSourcingError('No mock assets available for keywords', { code: 'ERR_NO_MOCK_ASSETS' });
  }

  async download(asset, options = {}) {
    await this._rateLimit();
    
    // Return mock bytes (1x1 pixel PNG for images, empty for video)
    // Add counter to make each download unique for hash deduplication
    this.downloadCounter++;
    if (asset.media_type === 'image') {
      // 1x1 transparent PNG + unique suffix bytes
      const basePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      const suffix = Buffer.from(this.downloadCounter.toString());
      return Buffer.concat([basePng, suffix]);
    }
    return Buffer.alloc(0);
  }
}

export class MediaSourcingService {
  constructor({
    providers = [],
    artifactRegistry,
    validator,
    clock = () => new Date()
  } = {}) {
    this.providers = providers;
    this.artifactRegistry = artifactRegistry;
    this.validator = validator ?? new SchemaValidator({ schemas: [MEDIA_ASSET_SCHEMA] });
    this.clock = clock;
  }

  addProvider(provider) {
    this.providers.push(provider);
  }

  async sourceForIdeation({ jobId, contentPackageId, userId, ideation, contentProfile, mediaType = 'image', countPerScene = 1, maxRetries = 2 }) {
    const keywords = ideation.keywords ?? [];
    const sceneCount = ideation.scenes?.length ?? 1;
    const targetCount = Math.max(keywords.length, sceneCount * countPerScene);
    
    if (targetCount === 0) {
      throw new MediaSourcingError('No keywords or scenes to source media for', { code: 'ERR_NO_KEYWORDS' });
    }

    const assets = [];
    const usedHashes = new Set();

    for (let i = 0; i < Math.min(targetCount, 20); i++) {
      const sceneIndex = i % sceneCount;
      const keywordSet = [keywords[i % keywords.length], ...ideation.scenes[sceneIndex]?.visual_prompt?.split(' ').slice(0, 3) ?? []]
        .filter(Boolean)
        .slice(0, 5);

      const asset = await this._sourceSingleAsset({
        jobId,
        contentPackageId,
        userId,
        keywords: keywordSet,
        mediaType,
        sceneIndex: sceneIndex + 1,
        usedHashes,
        maxRetries
      });

      if (asset) {
        assets.push(asset);
      }
    }

    if (assets.length === 0) {
      throw new MediaSourcingError('Failed to source any media assets', { code: 'ERR_NO_ASSETS_SOURCED' });
    }

    return assets;
  }

  async _sourceSingleAsset({ jobId, contentPackageId, userId, keywords, mediaType, sceneIndex, usedHashes, maxRetries }) {
    let lastError;
    
    for (const provider of this.providers) {
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          const results = await provider.search(keywords, { mediaType, count: 1 });
          
          for (const candidate of results) {
            // Download and verify
            const bytes = await provider.download(candidate);
            
            if (bytes.length === 0 && mediaType !== 'video') {
              throw new MediaSourcingError('Downloaded asset is empty', { code: 'ERR_MEDIA_INVALID' });
            }

            const sha256 = createHash('sha256').update(bytes).digest('hex');
            
            if (usedHashes.has(sha256)) {
              throw new MediaSourcingError('Duplicate asset hash', { code: 'ERR_DUPLICATE_ASSET' });
            }

            // Verify source metadata
            if (!candidate.source || !candidate.source.terms_url) {
              throw new MediaSourcingError('Missing license/terms metadata', { code: 'ERR_LICENSE_METADATA' });
            }

            // Register artifact
            const artifact = await this.artifactRegistry.registerAsset({
              jobId,
              contentPackageId,
              userId,
              bytes,
              mediaType,
              width: candidate.width,
              height: candidate.height,
              durationSec: candidate.duration_sec,
              source: candidate.source,
              sceneIndex,
              retentionClass: 'SOURCE_ASSET',
              isSourceAsset: true
            });

            usedHashes.add(sha256);
            return artifact;

          }
        } catch (error) {
          lastError = error;
          if (error instanceof MediaSourcingError && 
              ['ERR_LICENSE_METADATA', 'ERR_HASH_MISMATCH', 'ERR_DUPLICATE_ASSET'].includes(error.code)) {
            throw error;
          }
          if (attempt <= maxRetries) {
            await new Promise(r => setTimeout(r, 500 * attempt));
          }
        }
      }
    }

    throw lastError ?? new MediaSourcingError('All providers failed', { code: 'ERR_PROVIDER_UNAVAILABLE' });
  }
}