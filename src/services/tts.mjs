import { SchemaValidator, SchemaValidationError } from '../core/schema-validator.mjs';
import { createHash } from 'node:crypto';

export class TTSError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'TTSError';
    this.code = code;
  }
}

const TTS_OUTPUT_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/tts-output.schema.json',
  title: 'TTSOutput',
  type: 'object',
  required: ['artifact_uri', 'engine', 'voice_id', 'duration_sec', 'language', 'sha256'],
  properties: {
    artifact_uri: { type: 'string', pattern: '^artifact://[A-Za-z0-9._/-]+$' },
    engine: { type: 'string', enum: ['edge_tts', 'piper', 'coqui', 'other'] },
    voice_id: { type: 'string' },
    duration_sec: { type: 'number', exclusiveMinimum: 0, maximum: 600 },
    language: { type: 'string', default: 'id-ID' },
    sample_rate_hz: { type: ['integer', 'null'], minimum: 8000, maximum: 192000 },
    sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' }
  },
  additionalProperties: false
};

export class TTSEngine {
  constructor({ name, timeoutMs = 30000, maxRetries = 2, voices = [] } = {}) {
    this.name = name;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.voices = voices;
  }

  async synthesize(text, { voiceId, language = 'id-ID', sampleRateHz = 24000, format = 'mp3', signal = null } = {}) {
    throw new Error('synthesize() must be implemented by engine');
  }

  async healthCheck() {
    return { healthy: true, engine: this.name };
  }

  isVoiceAvailable(voiceId) {
    return this.voices.includes(voiceId);
  }
}

export class MockTTSEngine extends TTSEngine {
  constructor(options = {}) {
    super({ name: 'mock', voices: ['id-ID-mock-voice', 'id-ID-another-voice'], ...options });
    this.mockOutputs = new Map();
  }

  setMockOutput(text, voiceId, output) {
    const key = `${voiceId}:${text.substring(0, 50)}`;
    this.mockOutputs.set(key, output);
  }

  async synthesize(text, options = {}) {
    if (!text || text.trim().length === 0) {
      throw new TTSError('Empty script', { code: 'ERR_TTS_EMPTY_SCRIPT' });
    }

    const key = `${options.voiceId}:${text.substring(0, 50)}`;
    const mockOutput = this.mockOutputs.get(key);
    
    if (mockOutput) {
      return mockOutput;
    }

    // Generate mock audio (silence)
    const durationSec = Math.min(text.length * 0.05, 60); // ~20 chars/sec
    const sampleRate = options.sampleRateHz ?? 24000;
    const numSamples = Math.floor(durationSec * sampleRate);
    
    // Create a minimal WAV header + silence
    const wavHeader = this._createWavHeader(numSamples, sampleRate, 1);
    const audioData = Buffer.alloc(numSamples * 2); // 16-bit mono
    const output = Buffer.concat([wavHeader, audioData]);

    return {
      audioBuffer: output,
      durationSec,
      sampleRateHz: sampleRate,
      format: 'wav',
      engineName: 'other'
    };
  }

  _createWavHeader(numSamples, sampleRate, channels) {
    const byteRate = sampleRate * channels * 2;
    const blockAlign = channels * 2;
    const dataSize = numSamples * channels * 2;
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(fileSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    return buffer;
  }
}

export class TTSService {
  constructor({
    engines = [],
    artifactRegistry,
    validator,
    clock = () => new Date()
  } = {}) {
    this.engines = engines;
    this.artifactRegistry = artifactRegistry;
    this.validator = validator ?? new SchemaValidator({ schemas: [TTS_OUTPUT_SCHEMA] });
    this.clock = clock;
  }

  addEngine(engine) {
    this.engines.push(engine);
  }

  async generateVoiceover({ jobId, contentPackageId, userId, narrationScript, language = 'id-ID', voiceProfile = 'id-ID-mock-voice', maxRetries = 2, contentProfile }) {
    if (!narrationScript || narrationScript.trim().length === 0) {
      throw new TTSError('Empty narration script', { code: 'ERR_TTS_EMPTY_SCRIPT' });
    }

    // Select engine with fallback
    const primaryEngine = this.engines.find(e => e.name !== 'mock') ?? this.engines[0];
    const fallbackEngine = this.engines.find(e => e.name !== primaryEngine.name) ?? this.engines[0];

    let lastError;
    for (const engine of [primaryEngine, fallbackEngine]) {
      if (!engine) continue;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          const health = await engine.healthCheck();
          if (!health.healthy) {
            throw new TTSError(`Engine ${engine.name} unhealthy`, { code: 'ERR_TTS_ENGINE_UNHEALTHY' });
          }

          if (!engine.isVoiceAvailable(voiceProfile)) {
            throw new TTSError(`Voice ${voiceProfile} not available on ${engine.name}`, { code: 'ERR_TTS_VOICE_UNAVAILABLE' });
          }

          // Estimate timeout based on text length
          const estimatedDuration = Math.min(narrationScript.length * 0.05, 120);
          const timeoutMs = Math.max(estimatedDuration * 1000 * 3, 10000);

          const result = await engine.synthesize(narrationScript, {
            voiceId: voiceProfile,
            language,
            sampleRateHz: 48000,
            signal: null
          });

          // Validate audio
          if (!result.audioBuffer || result.audioBuffer.length === 0) {
            throw new TTSError('Engine returned empty audio', { code: 'ERR_AUDIO_INVALID' });
          }

          if (result.durationSec <= 0 || result.durationSec > 600) {
            throw new TTSError(`Invalid duration: ${result.durationSec}`, { code: 'ERR_AUDIO_DURATION' });
          }

          // Register artifact
          const artifact = await this.artifactRegistry.registerArtifact({
            jobId,
            contentPackageId,
            userId,
            bytes: result.audioBuffer,
            artifactType: 'audio',
            mimeType: 'audio/wav',
            durationSec: result.durationSec,
            retentionClass: 'TEMPORARY',
            metadata: { engine: engine.name, voice_id: voiceProfile, language },
            isSourceAsset: false
          });

          const output = {
            artifact_uri: artifact.artifact_uri,
            engine: result.engineName ?? engine.name,
            voice_id: voiceProfile,
            duration_sec: result.durationSec,
            language,
            sample_rate_hz: result.sampleRateHz ?? 48000,
            sha256: artifact.sha256
          };

          this.validator.validate(TTS_OUTPUT_SCHEMA.$id, output);

          return output;

        } catch (error) {
          lastError = error;
          if (error instanceof TTSError && 
              ['ERR_TTS_EMPTY_SCRIPT', 'ERR_TTS_VOICE_UNAVAILABLE', 'ERR_AUDIO_DURATION'].includes(error.code)) {
            throw error;
          }
          if (error instanceof SchemaValidationError) {
            throw new TTSError(`Output validation failed: ${error.message}`, { code: 'ERR_TTS_SCHEMA', cause: error });
          }
          if (attempt <= maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
    }

    throw lastError ?? new TTSError('All TTS engines failed', { code: 'ERR_TTS_ALL_FAILED' });
  }
}