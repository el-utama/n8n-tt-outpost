import { SchemaValidator, SchemaValidationError } from '../core/schema-validator.mjs';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

export class VideoComposerError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'VideoComposerError';
    this.code = code;
  }
}

const VIDEO_OUTPUT_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/video-output.schema.json',
  title: 'VideoOutput',
  type: 'object',
  required: ['artifact_uri', 'artifact_type', 'mime_type', 'sha256', 'size_bytes', 'width', 'height', 'duration_sec'],
  properties: {
    artifact_uri: { type: 'string', pattern: '^artifact://[A-Za-z0-9._/-]+$' },
    artifact_type: { type: 'string', enum: ['video'] },
    mime_type: { type: 'string', enum: ['video/mp4'] },
    sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
    size_bytes: { type: 'integer', minimum: 1 },
    width: { type: 'integer', minimum: 1 },
    height: { type: 'integer', minimum: 1 },
    duration_sec: { type: 'number', exclusiveMinimum: 0, maximum: 600 }
  },
  additionalProperties: false
};

const CAROUSEL_OUTPUT_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/carousel-output.schema.json',
  title: 'CarouselOutput',
  type: 'object',
  required: ['manifest_uri', 'images', 'sha256'],
  properties: {
    manifest_uri: { type: 'string', pattern: '^artifact://[A-Za-z0-9._/-]+$' },
    images: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['artifact_uri', 'sequence', 'width', 'height'],
        properties: {
          artifact_uri: { type: 'string', pattern: '^artifact://[A-Za-z0-9._/-]+$' },
          sequence: { type: 'integer', minimum: 1 },
          width: { type: 'integer', minimum: 1 },
          height: { type: 'integer', minimum: 1 }
        },
        additionalProperties: false
      }
    },
    sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }
  },
  additionalProperties: false
};

export class VideoEncoder {
  constructor({ name, codec = 'h264', hardware = false, available = true } = {}) {
    this.name = name;
    this.codec = codec;
    this.hardware = hardware;
    this.available = available;
  }

  async checkAvailability() {
    return this.available;
  }

  async encode(inputFrames, audioBuffer, { width, height, fps = 30, durationSec, bitrate = '5M', preset = 'medium' } = {}) {
    throw new Error('encode() must be implemented by encoder');
  }
}

export class MockVideoEncoder extends VideoEncoder {
  constructor(options = {}) {
    super({ name: 'mock_encoder', codec: 'h264', hardware: false, available: true, ...options });
  }

  async encode(inputFrames, audioBuffer, options = {}) {
    // Create a mock MP4 (minimal valid MP4 container)
    const { width = 1080, height = 1920, durationSec = 10, fps = 30 } = options;
    const frameCount = Math.min(Math.floor(durationSec * fps), 300); // Cap at 300 frames for mock
    
    // Minimal MP4 with ftyp + moov + mdat
    const ftyp = Buffer.from([
      0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
      0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
      0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31
    ]);
    
    // Simplified moov atom (would be much larger in reality)
    const moov = Buffer.alloc(1024);
    moov.writeUInt32BE(1024, 0);
    moov.write('moov', 4);
    
    // Mock mdat with frame data - use small frame size for mock
    const frameSize = 1024; // 1KB per frame for mock
    const mdatSize = 8 + frameCount * frameSize;
    const mdat = Buffer.alloc(mdatSize);
    mdat.writeUInt32BE(mdatSize, 0);
    mdat.write('mdat', 4);
    
    // Fill with pattern
    for (let i = 8; i < mdatSize; i++) {
      mdat[i] = i % 256;
    }
    
    return Buffer.concat([ftyp, moov, mdat]);
  }
}

export class VideoComposerService {
  constructor({
    encoders = [],
    artifactRegistry,
    validator,
    clock = () => new Date()
  } = {}) {
    this.encoders = encoders;
    this.artifactRegistry = artifactRegistry;
    this.validator = validator ?? new SchemaValidator({ 
      schemas: [VIDEO_OUTPUT_SCHEMA, CAROUSEL_OUTPUT_SCHEMA] 
    });
    this.clock = clock;
  }

  addEncoder(encoder) {
    this.encoders.push(encoder);
  }

  async composeVideo({ jobId, contentPackageId, userId, contentPackage, mediaAssets, voiceoverArtifact, contentProfile, maxRetries = 2 }) {
    // Validate inputs
    if (!mediaAssets || mediaAssets.length === 0) {
      throw new VideoComposerError('No media assets provided', { code: 'ERR_COMPOSITION_INPUT' });
    }
    if (!voiceoverArtifact) {
      throw new VideoComposerError('Voiceover artifact required', { code: 'ERR_AUDIO_MISSING' });
    }

    const targetWidth = contentProfile.target_width ?? 1080;
    const targetHeight = contentProfile.target_height ?? 1920;
    const targetFps = contentProfile.target_fps ?? 30;
    const targetDuration = contentProfile.target_duration_sec ?? voiceoverArtifact.duration_sec;

    // Select encoder (prefer hardware, fallback to CPU)
    const hwEncoder = this.encoders.find(e => e.hardware && e.available);
    const cpuEncoder = this.encoders.find(e => !e.hardware && e.available);
    const encoder = hwEncoder ?? cpuEncoder;

    if (!encoder) {
      throw new VideoComposerError('No available encoder', { code: 'ERR_ENCODER_UNAVAILABLE' });
    }

    // Verify encoder availability
    const available = await encoder.checkAvailability();
    if (!available && encoder.hardware && cpuEncoder) {
      // Fallback to CPU
      console.warn(`Hardware encoder ${encoder.name} unavailable, falling back to CPU`);
    } else if (!available) {
      throw new VideoComposerError('No available encoder after fallback', { code: 'ERR_ENCODER_UNAVAILABLE' });
    }

    // Resolve artifact URIs to bytes
    const mediaBytes = await this._resolveMediaBytes(mediaAssets);
    const audioBytes = await this.artifactRegistry.getArtifactBytes(voiceoverArtifact.artifact_uri);

    // Create composition plan
    const plan = this._createCompositionPlan(mediaAssets, voiceoverArtifact, contentProfile, targetWidth, targetHeight, targetDuration, targetFps);

    let lastError;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        // Encode video
        const videoBuffer = await encoder.encode(plan.frames, audioBytes, {
          width: targetWidth,
          height: targetHeight,
          fps: targetFps,
          durationSec: targetDuration,
          bitrate: contentProfile.bitrate ?? '5M',
          preset: contentProfile.preset ?? 'medium'
        });

        // Validate output
        if (!videoBuffer || videoBuffer.length === 0) {
          throw new VideoComposerError('Encoder returned empty output', { code: 'ERR_VIDEO_RENDER' });
        }

        // Register artifact
        const artifact = await this.artifactRegistry.registerArtifact({
          jobId,
          contentPackageId,
          userId,
          bytes: videoBuffer,
          artifactType: 'video',
          mimeType: 'video/mp4',
          width: targetWidth,
          height: targetHeight,
          durationSec: targetDuration,
          retentionClass: 'TEMPORARY',
          metadata: { encoder: encoder.name, composition_plan: plan }
        });

        const output = {
          artifact_uri: artifact.artifact_uri,
          artifact_type: 'video',
          mime_type: 'video/mp4',
          sha256: artifact.sha256,
          size_bytes: artifact.size_bytes,
          width: targetWidth,
          height: targetHeight,
          duration_sec: targetDuration
        };

        this.validator.validate(VIDEO_OUTPUT_SCHEMA.$id, output);

        return output;

      } catch (error) {
        lastError = error;
        if (error instanceof VideoComposerError && 
            ['ERR_COMPOSITION_INPUT', 'ERR_AUDIO_MISSING', 'ERR_VIDEO_DIMENSIONS'].includes(error.code)) {
          throw error;
        }
        if (error instanceof SchemaValidationError) {
          throw new VideoComposerError(`Output validation failed: ${error.message}`, { code: 'ERR_VIDEO_SCHEMA', cause: error });
        }
        if (attempt <= maxRetries) {
          // Try CPU fallback if was using hardware
          if (encoder.hardware && cpuEncoder) {
            encoder = cpuEncoder;
          }
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw lastError ?? new VideoComposerError('Video composition failed', { code: 'ERR_VIDEO_RENDER' });
  }

  async composeCarousel({ jobId, contentPackageId, userId, mediaAssets, contentProfile, maxRetries = 2 }) {
    if (!mediaAssets || mediaAssets.length === 0) {
      throw new VideoComposerError('No media assets for carousel', { code: 'ERR_COMPOSITION_INPUT' });
    }

    const targetWidth = contentProfile.target_width ?? 1080;
    const targetHeight = contentProfile.target_height ?? 1350; // 4:5 for carousel
    const maxImages = contentProfile.max_carousel_images ?? 5;

    const images = [];
    const sortedAssets = mediaAssets
      .filter(a => a.media_type === 'image')
      .slice(0, maxImages);

    for (let i = 0; i < sortedAssets.length; i++) {
      const asset = sortedAssets[i];
      const bytes = await this.artifactRegistry.getArtifactBytes(asset.asset_uri);
      
      // Register each image as artifact
      const artifact = await this.artifactRegistry.registerArtifact({
        jobId,
        contentPackageId,
        userId,
        bytes,
        artifactType: 'image',
        mimeType: 'image/png',
        width: asset.width ?? targetWidth,
        height: asset.height ?? targetHeight,
        retentionClass: 'TEMPORARY',
        metadata: { carousel_index: i + 1, source_asset_id: asset.asset_id }
      });

      images.push({
        artifact_uri: artifact.artifact_uri,
        sequence: i + 1,
        width: artifact.width,
        height: artifact.height
      });
    }

    // Create manifest
    const manifest = {
      type: 'carousel',
      images: images.map(img => ({ uri: img.artifact_uri, sequence: img.sequence })),
      created_at: this.clock().toISOString()
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const manifestArtifact = await this.artifactRegistry.registerArtifact({
      jobId,
      contentPackageId,
      userId,
      bytes: manifestBytes,
      artifactType: 'carousel_manifest',
      mimeType: 'application/json',
      retentionClass: 'TEMPORARY'
    });

    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');

    const output = {
      manifest_uri: manifestArtifact.artifact_uri,
      images,
      sha256: manifestSha256
    };

    this.validator.validate(CAROUSEL_OUTPUT_SCHEMA.$id, output);

    return output;
  }

  _createCompositionPlan(mediaAssets, voiceoverArtifact, contentProfile, width, height, durationSec, fps) {
    const frameCount = Math.floor(durationSec * fps);
    const sceneCount = contentProfile.scene_count ?? mediaAssets.length;
    const framesPerScene = Math.ceil(frameCount / sceneCount);

    const frames = [];
    for (let i = 0; i < sceneCount; i++) {
      const asset = mediaAssets[i % mediaAssets.length];
      for (let f = 0; f < framesPerScene && frames.length < frameCount; f++) {
        frames.push({
          asset_id: asset.asset_id,
          asset_uri: asset.asset_uri,
          scene_index: i + 1,
          frame_index: frames.length,
          overlay_text: asset.overlay_text ?? null
        });
      }
    }

    return {
      frames: frames.slice(0, frameCount),
      audio_uri: voiceoverArtifact.artifact_uri,
      width,
      height,
      fps,
      duration_sec: durationSec,
      scene_count: sceneCount
    };
  }

  async _resolveMediaBytes(mediaAssets) {
    const results = [];
    for (const asset of mediaAssets) {
      try {
        const bytes = await this.artifactRegistry.getArtifactBytes(asset.asset_uri);
        results.push({ ...asset, bytes });
      } catch (error) {
        throw new VideoComposerError(`Failed to resolve asset ${asset.asset_uri}: ${error.message}`, { code: 'ERR_ARTIFACT_NOT_FOUND', cause: error });
      }
    }
    return results;
  }
}