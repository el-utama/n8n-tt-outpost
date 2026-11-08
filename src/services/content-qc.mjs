import { SchemaValidator, SchemaValidationError } from '../core/schema-validator.mjs';

export class ContentQCError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'ContentQCError';
    this.code = code;
  }
}

const QC_RESULT_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/qc-result.schema.json',
  title: 'QCResult',
  type: 'object',
  required: ['status', 'checks', 'blocking_reasons', 'warnings', 'checked_at', 'package_version'],
  properties: {
    status: { type: 'string', enum: ['PASSED', 'WARNING', 'FAILED'] },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['check_id', 'status', 'checked_at'],
        properties: {
          check_id: { type: 'string' },
          status: { type: 'string', enum: ['PASSED', 'FAILED', 'WARNING'] },
          message: { type: ['string', 'null'] },
          checked_at: { type: 'string', format: 'date-time' }
        },
        additionalProperties: false
      }
    },
    blocking_reasons: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    checked_at: { type: 'string', format: 'date-time' },
    package_version: { type: 'string' }
  },
  additionalProperties: false
};

export class ContentQCService {
  constructor({
    artifactRegistry,
    validator,
    config = {},
    clock = () => new Date()
  } = {}) {
    this.artifactRegistry = artifactRegistry;
    this.validator = validator ?? new SchemaValidator({ schemas: [QC_RESULT_SCHEMA] });
    this.config = {
      maxVideoSizeBytes: config.maxVideoSizeBytes ?? 500 * 1024 * 1024, // 500MB
      maxAudioSizeBytes: config.maxAudioSizeBytes ?? 50 * 1024 * 1024, // 50MB
      maxImageSizeBytes: config.maxImageSizeBytes ?? 20 * 1024 * 1024, // 20MB
      allowedVideoMimeTypes: config.allowedVideoMimeTypes ?? ['video/mp4'],
      allowedAudioMimeTypes: config.allowedAudioMimeTypes ?? ['audio/wav', 'audio/mpeg', 'audio/mp4'],
      allowedImageMimeTypes: config.allowedImageMimeTypes ?? ['image/png', 'image/jpeg', 'image/webp'],
      targetAspectRatio: config.targetAspectRatio ?? { width: 9, height: 16 },
      aspectRatioTolerance: config.aspectRatioTolerance ?? 0.02,
      minVideoDurationSec: config.minVideoDurationSec ?? 5,
      maxVideoDurationSec: config.maxVideoDurationSec ?? 180,
      ...config
    };
    this.clock = clock;
  }

  async runQC(contentPackage, { contentProfile, userId } = {}) {
    const checks = [];
    const blockingReasons = [];
    const warnings = [];

    // 1. Schema validation
    try {
      this._validateSchema(contentPackage);
      checks.push({ check_id: 'SCHEMA', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    } catch (error) {
      checks.push({ check_id: 'SCHEMA', status: 'FAILED', message: error.message, checked_at: this.clock().toISOString() });
      blockingReasons.push(`Schema validation failed: ${error.message}`);
    }

    // 2. Identity checks
    const identityChecks = this._checkIdentity(contentPackage);
    checks.push(...identityChecks.checks);
    blockingReasons.push(...identityChecks.blocking);
    warnings.push(...identityChecks.warnings);

    // 3. Artifact integrity
    const artifactChecks = await this._checkArtifactIntegrity(contentPackage, userId);
    checks.push(...artifactChecks.checks);
    blockingReasons.push(...artifactChecks.blocking);
    warnings.push(...artifactChecks.warnings);

    // 4. Video/audio/image validation
    const mediaChecks = await this._checkMedia(contentPackage);
    checks.push(...mediaChecks.checks);
    blockingReasons.push(...mediaChecks.blocking);
    warnings.push(...mediaChecks.warnings);

    // 5. Source and license
    const sourceChecks = this._checkSourceAndLicense(contentPackage);
    checks.push(...sourceChecks.checks);
    blockingReasons.push(...sourceChecks.blocking);
    warnings.push(...sourceChecks.warnings);

    // 6. Text and content
    const textChecks = this._checkTextContent(contentPackage, contentProfile);
    checks.push(...textChecks.checks);
    blockingReasons.push(...textChecks.blocking);
    warnings.push(...textChecks.warnings);

    // Determine overall status
    const hasFailed = checks.some(c => c.status === 'FAILED');
    const hasWarning = checks.some(c => c.status === 'WARNING');
    let status = 'PASSED';
    if (hasFailed) status = 'FAILED';
    else if (hasWarning) status = 'WARNING';

    const result = {
      status,
      checks,
      blocking_reasons: blockingReasons,
      warnings: warnings,
      checked_at: this.clock().toISOString(),
      package_version: contentPackage.schema_version ?? '1.0.0'
    };

    this.validator.validate(QC_RESULT_SCHEMA.$id, result);

    return result;
  }

  _validateSchema(contentPackage) {
    // In production, would validate against content-package.schema.json
    // For now, basic structural validation
    const required = ['content_package_id', 'job_id', 'schema_version', 'ideation', 'caption', 'media_assets', 'artifacts'];
    for (const field of required) {
      if (!contentPackage[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate schema version format
    if (!/^1\.\d+\.\d+$/.test(contentPackage.schema_version)) {
      throw new Error(`Unsupported schema version: ${contentPackage.schema_version}`);
    }

    // Validate content_status
    const validStatuses = ['DRAFT', 'QC_PASSED', 'READY_FOR_DELIVERY', 'READY_FOR_PUBLISH', 'REJECTED'];
    if (!validStatuses.includes(contentPackage.content_status)) {
      throw new Error(`Invalid content_status: ${contentPackage.content_status}`);
    }
  }

  _checkIdentity(contentPackage) {
    const checks = [];
    const blocking = [];
    const warnings = [];

    // content_package_id and job_id
    if (!contentPackage.content_package_id || !contentPackage.job_id) {
      checks.push({ check_id: 'IDENTITY', status: 'FAILED', message: 'Missing content_package_id or job_id', checked_at: this.clock().toISOString() });
      blocking.push('Missing identity fields');
    } else {
      checks.push({ check_id: 'IDENTITY', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    }

    // Timestamps
    if (!contentPackage.created_at || !contentPackage.updated_at) {
      checks.push({ check_id: 'TIMESTAMPS', status: 'FAILED', message: 'Missing timestamps', checked_at: this.clock().toISOString() });
      blocking.push('Missing timestamps');
    } else {
      checks.push({ check_id: 'TIMESTAMPS', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    }

    return { checks, blocking, warnings };
  }

  async _checkArtifactIntegrity(contentPackage, userId) {
    const checks = [];
    const blocking = [];
    const warnings = [];

    const allArtifacts = [
      ...(contentPackage.artifacts ?? []),
      ...(contentPackage.media_assets ?? []),
      contentPackage.voiceover ? { ...contentPackage.voiceover, artifact_type: 'audio' } : null
    ].filter(Boolean);

    for (const artifact of allArtifacts) {
      const artifactUri = artifact.artifact_uri ?? artifact.asset_uri;
      const artifactId = artifactUri.split('/').pop();

      // Check URI format
      if (!artifactUri.match(/^(artifact|asset):\/\/[A-Za-z0-9._/-]+$/)) {
        checks.push({ check_id: 'ARTIFACT_URI_FORMAT', status: 'FAILED', message: `Invalid URI: ${artifactUri}`, checked_at: this.clock().toISOString() });
        blocking.push(`Invalid artifact URI format: ${artifactUri}`);
        continue;
      }

      // Resolve and check
      try {
        const record = await this.artifactRegistry.getArtifact(artifactUri);
        
        // Ownership
        if (userId && record.owner_user_id !== userId) {
          checks.push({ check_id: 'ARTIFACT_OWNERSHIP', status: 'FAILED', message: `Ownership mismatch: ${artifactUri}`, checked_at: this.clock().toISOString() });
          blocking.push(`Artifact ownership mismatch: ${artifactUri}`);
          continue;
        }

        // Hash verification
        if (artifact.sha256 && record.sha256 !== artifact.sha256) {
          checks.push({ check_id: 'HASH_MISMATCH', status: 'FAILED', message: `Hash mismatch: ${artifactUri}`, checked_at: this.clock().toISOString() });
          blocking.push(`Hash mismatch for artifact: ${artifactUri}`);
          continue;
        }

        // Size
        if (artifact.size_bytes && record.size_bytes !== artifact.size_bytes) {
          checks.push({ check_id: 'SIZE_MISMATCH', status: 'FAILED', message: `Size mismatch: ${artifactUri}`, checked_at: this.clock().toISOString() });
          blocking.push(`Size mismatch for artifact: ${artifactUri}`);
          continue;
        }

        // MIME type consistency
        if (artifact.mime_type && record.mime_type !== artifact.mime_type) {
          checks.push({ check_id: 'MIME_MISMATCH', status: 'WARNING', message: `MIME type mismatch: ${artifactUri}`, checked_at: this.clock().toISOString() });
          warnings.push(`MIME type mismatch for artifact: ${artifactUri}`);
        }

        checks.push({ check_id: 'ARTIFACT_INTEGRITY', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });

      } catch (error) {
        checks.push({ check_id: 'ARTIFACT_NOT_FOUND', status: 'FAILED', message: `Artifact not found: ${artifactUri}`, checked_at: this.clock().toISOString() });
        blocking.push(`Artifact not found: ${artifactUri}`);
      }
    }

    return { checks, blocking, warnings };
  }

  async _checkMedia(contentPackage) {
    const checks = [];
    const blocking = [];
    const warnings = [];

    // Video
    const videoArtifact = contentPackage.artifacts?.find(a => a.artifact_type === 'video');
    if (videoArtifact) {
      try {
        const record = await this.artifactRegistry.getArtifact(videoArtifact.artifact_uri);
        
        // Playable check (basic)
        if (record.size_bytes === 0) {
          checks.push({ check_id: 'VIDEO_PLAYABLE', status: 'FAILED', message: 'Video file is empty', checked_at: this.clock().toISOString() });
          blocking.push('Video artifact is empty');
        } else if (record.size_bytes > this.config.maxVideoSizeBytes) {
          checks.push({ check_id: 'VIDEO_SIZE', status: 'FAILED', message: `Video exceeds max size: ${record.size_bytes}`, checked_at: this.clock().toISOString() });
          blocking.push(`Video exceeds max size (${this.config.maxVideoSizeBytes} bytes)`);
        } else if (!this.config.allowedVideoMimeTypes.includes(record.mime_type)) {
          checks.push({ check_id: 'VIDEO_MIME', status: 'FAILED', message: `Invalid video MIME: ${record.mime_type}`, checked_at: this.clock().toISOString() });
          blocking.push(`Invalid video MIME type: ${record.mime_type}`);
        } else {
          // Aspect ratio
          if (record.width && record.height) {
            const targetRatio = this.config.targetAspectRatio.width / this.config.targetAspectRatio.height;
            const actualRatio = record.width / record.height;
            if (Math.abs(actualRatio - targetRatio) > this.config.aspectRatioTolerance) {
              checks.push({ check_id: 'VIDEO_ASPECT_RATIO', status: 'WARNING', message: `Aspect ratio ${actualRatio.toFixed(2)} differs from target ${targetRatio.toFixed(2)}`, checked_at: this.clock().toISOString() });
              warnings.push(`Video aspect ratio warning: ${actualRatio.toFixed(2)} vs target ${targetRatio.toFixed(2)}`);
            }
          }

          // Duration
          if (record.duration_sec) {
            if (record.duration_sec < this.config.minVideoDurationSec) {
              checks.push({ check_id: 'VIDEO_DURATION_MIN', status: 'FAILED', message: `Video too short: ${record.duration_sec}s`, checked_at: this.clock().toISOString() });
              blocking.push(`Video duration below minimum (${this.config.minVideoDurationSec}s)`);
            } else if (record.duration_sec > this.config.maxVideoDurationSec) {
              checks.push({ check_id: 'VIDEO_DURATION_MAX', status: 'FAILED', message: `Video too long: ${record.duration_sec}s`, checked_at: this.clock().toISOString() });
              blocking.push(`Video duration exceeds maximum (${this.config.maxVideoDurationSec}s)`);
            }
          } else {
            checks.push({ check_id: 'VIDEO_DURATION_MISSING', status: 'FAILED', message: 'Video duration not available', checked_at: this.clock().toISOString() });
            blocking.push('Video duration missing');
          }

          // Audio track presence
          if (contentPackage.voiceover) {
            checks.push({ check_id: 'VIDEO_AUDIO_TRACK', status: 'PASSED', message: 'Voiceover present', checked_at: this.clock().toISOString() });
          } else {
            checks.push({ check_id: 'VIDEO_AUDIO_TRACK', status: 'WARNING', message: 'No voiceover artifact referenced', checked_at: this.clock().toISOString() });
            warnings.push('Video has no voiceover reference');
          }

          checks.push({ check_id: 'VIDEO_PLAYABLE', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
        }
      } catch (error) {
        checks.push({ check_id: 'VIDEO_PLAYABLE', status: 'FAILED', message: error.message, checked_at: this.clock().toISOString() });
        blocking.push(`Video check failed: ${error.message}`);
      }
    }

    // Audio
    if (contentPackage.voiceover) {
      try {
        const record = await this.artifactRegistry.getArtifact(contentPackage.voiceover.artifact_uri);
        
        if (record.size_bytes === 0) {
          checks.push({ check_id: 'AUDIO_EMPTY', status: 'FAILED', message: 'Audio file is empty', checked_at: this.clock().toISOString() });
          blocking.push('Voiceover artifact is empty');
        } else if (record.size_bytes > this.config.maxAudioSizeBytes) {
          checks.push({ check_id: 'AUDIO_SIZE', status: 'FAILED', message: `Audio exceeds max size`, checked_at: this.clock().toISOString() });
          blocking.push('Audio exceeds max size');
        } else if (!this.config.allowedAudioMimeTypes.includes(record.mime_type)) {
          checks.push({ check_id: 'AUDIO_MIME', status: 'FAILED', message: `Invalid audio MIME: ${record.mime_type}`, checked_at: this.clock().toISOString() });
          blocking.push(`Invalid audio MIME type: ${record.mime_type}`);
        } else if (record.duration_sec && contentPackage.video?.duration_sec) {
          const diff = Math.abs(record.duration_sec - contentPackage.video.duration_sec);
          if (diff > 2) { // More than 2 seconds mismatch
            checks.push({ check_id: 'AUDIO_DURATION_MISMATCH', status: 'WARNING', message: `Audio/video duration mismatch: ${diff.toFixed(1)}s`, checked_at: this.clock().toISOString() });
            warnings.push(`Audio/video duration mismatch: ${diff.toFixed(1)}s`);
          }
        }
        
        checks.push({ check_id: 'AUDIO_VALID', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
      } catch (error) {
        checks.push({ check_id: 'AUDIO_VALID', status: 'FAILED', message: error.message, checked_at: this.clock().toISOString() });
        blocking.push(`Audio check failed: ${error.message}`);
      }
    }

    // Images (media assets)
    for (const asset of contentPackage.media_assets ?? []) {
      try {
        const record = await this.artifactRegistry.getArtifact(asset.asset_uri);
        
        if (record.size_bytes === 0) {
          checks.push({ check_id: 'IMAGE_EMPTY', status: 'FAILED', message: `Image asset empty: ${asset.asset_uri}`, checked_at: this.clock().toISOString() });
          blocking.push(`Image asset empty: ${asset.asset_uri}`);
        } else if (record.size_bytes > this.config.maxImageSizeBytes) {
          checks.push({ check_id: 'IMAGE_SIZE', status: 'FAILED', message: `Image exceeds max size`, checked_at: this.clock().toISOString() });
          blocking.push(`Image exceeds max size`);
        } else if (!this.config.allowedImageMimeTypes.includes(record.mime_type)) {
          checks.push({ check_id: 'IMAGE_MIME', status: 'FAILED', message: `Invalid image MIME: ${record.mime_type}`, checked_at: this.clock().toISOString() });
          blocking.push(`Invalid image MIME type`);
        } else {
          checks.push({ check_id: 'IMAGE_VALID', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
        }
      } catch (error) {
        checks.push({ check_id: 'IMAGE_VALID', status: 'FAILED', message: error.message, checked_at: this.clock().toISOString() });
        blocking.push(`Image check failed: ${error.message}`);
      }
    }

    return { checks, blocking, warnings };
  }

  _checkSourceAndLicense(contentPackage) {
    const checks = [];
    const blocking = [];
    const warnings = [];

    for (const asset of contentPackage.media_assets ?? []) {
      const source = asset.source;
      if (!source) {
        checks.push({ check_id: 'SOURCE_METADATA_MISSING', status: 'FAILED', message: `Missing source metadata for asset: ${asset.asset_uri}`, checked_at: this.clock().toISOString() });
        blocking.push(`Missing source/license metadata for asset: ${asset.asset_uri}`);
        continue;
      }

      // Required fields
      if (!source.provider || !source.source_url || !source.terms_url || !source.retrieved_at) {
        checks.push({ check_id: 'SOURCE_INCOMPLETE', status: 'FAILED', message: `Incomplete source metadata for: ${asset.asset_uri}`, checked_at: this.clock().toISOString() });
        blocking.push(`Incomplete source metadata for: ${asset.asset_uri}`);
        continue;
      }

      // No "royalty-free" claim without terms evidence
      if (source.provider.toLowerCase().includes('royalty') || source.provider.toLowerCase().includes('free')) {
        if (!source.terms_url.match(/^https?:\/\//)) {
          checks.push({ check_id: 'LICENSE_CLAIM_UNVERIFIED', status: 'WARNING', message: `Provider claims free/royalty but terms URL not verifiable`, checked_at: this.clock().toISOString() });
          warnings.push(`License claim for ${asset.asset_uri} needs verification`);
        }
      }

      // Attribution
      if (source.attribution_required && !source.author) {
        checks.push({ check_id: 'ATTRIBUTION_MISSING', status: 'WARNING', message: `Attribution required but no author provided`, checked_at: this.clock().toISOString() });
        warnings.push(`Attribution required for ${asset.asset_uri} but no author`);
      }

      checks.push({ check_id: 'SOURCE_LICENSE_VALID', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    }

    return { checks, blocking, warnings };
  }

  _checkTextContent(contentPackage, contentProfile) {
    const checks = [];
    const blocking = [];
    const warnings = [];

    // Language
    if (contentPackage.language !== (contentProfile?.language ?? 'id-ID')) {
      checks.push({ check_id: 'LANGUAGE_MISMATCH', status: 'WARNING', message: `Package language ${contentPackage.language} differs from profile`, checked_at: this.clock().toISOString() });
      warnings.push(`Language mismatch: ${contentPackage.language} vs profile ${contentProfile?.language}`);
    } else {
      checks.push({ check_id: 'LANGUAGE', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    }

    // Caption
    const caption = contentPackage.caption;
    if (!caption || !caption.body || caption.body.trim().length === 0) {
      checks.push({ check_id: 'CAPTION_EMPTY', status: 'FAILED', message: 'Caption body is empty', checked_at: this.clock().toISOString() });
      blocking.push('Caption body is empty');
    } else {
      // Check unverified notice
      if (contentPackage.unverified_notice && !caption.body.includes('unverified') && !caption.body.includes('tidak terverifikasi')) {
        warnings.push('Caption may contain unverified claims without qualifier');
      }
      checks.push({ check_id: 'CAPTION_VALID', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    }

    // Hashtags
    if (!caption?.hashtags || caption.hashtags.length === 0) {
      checks.push({ check_id: 'HASHTAGS_EMPTY', status: 'WARNING', message: 'No hashtags provided', checked_at: this.clock().toISOString() });
      warnings.push('No hashtags in caption');
    } else {
      const invalidTags = caption.hashtags.filter(tag => !/^#[^\s#]{1,100}$/.test(tag));
      if (invalidTags.length > 0) {
        checks.push({ check_id: 'HASHTAGS_INVALID', status: 'FAILED', message: `Invalid hashtags: ${invalidTags.join(', ')}`, checked_at: this.clock().toISOString() });
        blocking.push(`Invalid hashtags: ${invalidTags.join(', ')}`);
      }
      
      const duplicates = caption.hashtags.filter((tag, i) => caption.hashtags.indexOf(tag) !== i);
      if (duplicates.length > 0) {
        checks.push({ check_id: 'HASHTAGS_DUPLICATE', status: 'FAILED', message: `Duplicate hashtags: ${duplicates.join(', ')}`, checked_at: this.clock().toISOString() });
        blocking.push(`Duplicate hashtags`);
      }
      
      checks.push({ check_id: 'HASHTAGS_VALID', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
    }

    // Ideation
    const ideation = contentPackage.ideation;
    if (!ideation || !ideation.scenes || ideation.scenes.length === 0) {
      checks.push({ check_id: 'IDEATION_EMPTY', status: 'FAILED', message: 'Ideation or scenes missing', checked_at: this.clock().toISOString() });
      blocking.push('Ideation missing or empty');
    } else {
      // Scene sequence
      const sequences = ideation.scenes.map(s => s.sequence).sort((a, b) => a - b);
      if (sequences.some((v, i) => v !== i + 1)) {
        checks.push({ check_id: 'SCENE_SEQUENCE', status: 'FAILED', message: 'Scene sequences not consecutive from 1', checked_at: this.clock().toISOString() });
        blocking.push('Scene sequence not consecutive');
      } else {
        checks.push({ check_id: 'SCENE_SEQUENCE', status: 'PASSED', message: null, checked_at: this.clock().toISOString() });
      }

      // Unverified facts
      if (!ideation.is_fact_checked && ideation.sources.length === 0) {
        const riskText = `${ideation.hook} ${ideation.scenes.map(s => s.narration).join(' ')} ${ideation.cta}`.toLowerCase();
        const riskKeywords = ['angka', 'persen', 'statistik', 'data', 'studi', 'penelitian', 'terbukti', 'fakta'];
        if (riskKeywords.some(k => riskText.includes(k))) {
          checks.push({ check_id: 'UNVERIFIED_FACTS', status: 'WARNING', message: 'Ideation contains potential unverified factual claims', checked_at: this.clock().toISOString() });
          warnings.push('Ideation may contain unverified factual claims; unverified_notice should be present');
        }
      }
    }

    // Secret/credential check
    const fullText = JSON.stringify(contentPackage);
    
    // Check specific high-confidence secret patterns on original text
    const specificPatterns = [
      /sk-[a-zA-Z0-9]{32,}/,
      /Bearer\s+[a-zA-Z0-9_-]{20,}/
    ];
    for (const pattern of specificPatterns) {
      if (pattern.test(fullText)) {
        checks.push({ check_id: 'SECRET_DETECTED', status: 'FAILED', message: 'High-confidence secret detected in package', checked_at: this.clock().toISOString() });
        blocking.push('High-confidence secret/credential detected in content package');
      }
    }
    
    // Exclude known hash fields, URI fields, UUID-like patterns, and long alphanumeric strings from generic secret detection
    const sanitizedText = fullText
      .replace(/"sha256"\s*:\s*"[a-fA-F0-9]{64}"/g, '"sha256":"[REDACTED]"')
      .replace(/"sha256"\s*:\s*"[a-fA-F0-9]{64}"/g, '"sha256":"[REDACTED]"')
      .replace(/"artifact_uri"\s*:\s*"[^"]*"/g, '"artifact_uri":"[REDACTED]"')
      .replace(/"asset_uri"\s*:\s*"[^"]*"/g, '"asset_uri":"[REDACTED]"')
      .replace(/"artifact_id"\s*:\s*"[^"]*"/g, '"artifact_id":"[REDACTED]"')
      .replace(/"asset_id"\s*:\s*"[^"]*"/g, '"asset_id":"[REDACTED]"')
      .replace(/"manifest_uri"\s*:\s*"[^"]*"/g, '"manifest_uri":"[REDACTED]"')
      // Remove UUID-like patterns (8-4-4-4-12 hex)
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[UUID]')
      // Remove 32+ char alphanumeric strings
      .replace(/[a-zA-Z0-9]{32,}/g, '[LONG_STRING]')
      // Remove common false positive field names/values
      .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"[REDACTED]"')
      .replace(/"key"\s*:\s*"[^"]*"/gi, '"key":"[REDACTED]"')
      .replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"[REDACTED]"')
      .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"');
    
    // Check generic patterns on sanitized text
    const genericPatterns = [
      { pattern: /password|secret|token|key/i, status: 'WARNING' }
    ];
    for (const { pattern, status } of genericPatterns) {
      if (pattern.test(sanitizedText)) {
        checks.push({ check_id: 'SECRET_DETECTED', status, message: 'Potential secret detected in package', checked_at: this.clock().toISOString() });
        if (status === 'FAILED') {
          blocking.push('Potential secret/credential detected in content package');
        } else {
          warnings.push('Potential secret/credential detected in content package (generic pattern)');
        }
      }
    }

    return { checks, blocking, warnings };
  }
}