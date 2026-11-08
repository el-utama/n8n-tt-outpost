import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentIdeationService } from '../src/services/content-ideation.mjs';
import { CaptionWriterService } from '../src/services/caption-writer.mjs';
import { MediaSourcingService, MockMediaProvider } from '../src/services/media-sourcing.mjs';
import { ArtifactRegistry, MockStorage } from '../src/services/artifact-registry.mjs';
import { TTSService, MockTTSEngine } from '../src/services/tts.mjs';
import { VideoComposerService, MockVideoEncoder } from '../src/services/video-composer.mjs';
import { ContentQCService } from '../src/services/content-qc.mjs';
import { SchemaValidator } from '../src/core/schema-validator.mjs';

// Mock NemotronAdapter for testing
function createMockNemotronAdapter() {
  const adapter = {
    async complete({ responseSchema, messages }) {
      // Return mock response based on schema
      if (responseSchema.$id?.includes('ideation')) {
        return {
          content: JSON.stringify({
            title: "5 Tips Produktivitas Developer",
            hook: "Kamu kerja keras tapi output kurang? Coba 5 tips ini.",
            scenes: [
              { sequence: 1, narration: "Buka dengan masalah umum developer", visual_prompt: "Developer di depan laptop kelihatan frustrasi", overlay_text: "Masalah: Output rendah" },
              { sequence: 2, narration: "Tip 1: Time blocking untuk deep work", visual_prompt: "Kalender dengan blok waktu warna-warni", overlay_text: "Time Blocking" },
              { sequence: 3, narration: "Tip 2: Automate repetitive tasks", visual_prompt: "Script otomatisasi berjalan di terminal", overlay_text: "Automasi" },
              { sequence: 4, narration: "Tip 3: Code review teratur", visual_prompt: "Dua developer review code bersama", overlay_text: "Code Review" },
              { sequence: 5, narration: "Tip 4: Break pomodoro", visual_prompt: "Timer pomodoro 25 menit", overlay_text: "Pomodoro" },
              { sequence: 6, narration: "Tip 5: Dokumentasi singkat", visual_prompt: "Notebook dengan catatan ringkas", overlay_text: "Dokumentasi" },
              { sequence: 7, narration: "Kesimpulan dan CTA", visual_prompt: "Developer tersenyum, output naik", overlay_text: "Coba hari ini!" }
            ],
            cta: "Simpan video ini dan coba satu tips hari ini!",
            keywords: ["produktivitas", "developer", "time blocking", "automasi", "pomodoro"],
            is_fact_checked: false,
            sources: []
          }),
          model: 'mock-model',
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
        };
      }
      
      if (responseSchema.$id?.includes('caption')) {
        return {
          content: JSON.stringify({
            body: "Developer sering frustrasi karena kerja keras tapi output tidak maksimal. 😅\n\n5 tips produktivitas yang bisa dicoba:\n1️⃣ Time blocking untuk deep work\n2️⃣ Automate repetitive tasks\n3️⃣ Code review teratur\n4️⃣ Break pomodoro 25/5\n5️⃣ Dokumentasi singkat\n\nKunci konsistensi bukan intensitas. Coba satu tips hari ini dan rasakan bedanya! 🚀",
            hashtags: ["#produktivitas", "#developer", "#timeblocking", "#automasi", "#pomodoro", "#codinglife", "#tipsprogrammer"],
            profile_id: "informative_engaging",
            call_to_action: "Simpan dan coba hari ini!"
          }),
          model: 'mock-model',
          usage: { prompt_tokens: 80, completion_tokens: 150, total_tokens: 230 }
        };
      }
      
      throw new Error('Unknown schema');
    },
    validateToolDefinitions: () => {},
    profile: { model_id: 'mock', timeout_seconds: 30 }
  };
  return adapter;
}

// Create validators with schemas loaded
function createValidators() {
  // Load schemas from the service files
  const ideationSchema = {
    $id: 'https://n8n-tt-outpost.local/schemas/ideation-output.schema.json',
    title: 'IdeationOutput',
    type: 'object',
    required: ['title', 'hook', 'scenes', 'cta', 'keywords', 'is_fact_checked'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      hook: { type: 'string', minLength: 1, maxLength: 300 },
      scenes: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          required: ['sequence', 'narration', 'visual_prompt'],
          properties: {
            sequence: { type: 'integer', minimum: 1 },
            narration: { type: 'string', minLength: 1, maxLength: 1000 },
            visual_prompt: { type: 'string', minLength: 1, maxLength: 500 },
            overlay_text: { type: ['string', 'null'], maxLength: 300 }
          },
          additionalProperties: false
        }
      },
      cta: { type: 'string', maxLength: 300 },
      keywords: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: { type: 'string', minLength: 1, maxLength: 100 },
        uniqueItems: true
      },
      is_fact_checked: { type: 'boolean', default: false },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          required: ['provider', 'source_url', 'terms_url', 'retrieved_at'],
          properties: {
            provider: { type: 'string' },
            provider_asset_id: { type: ['string', 'null'] },
            source_url: { type: 'string', format: 'uri' },
            author: { type: ['string', 'null'] },
            terms_url: { type: 'string', format: 'uri' },
            attribution_required: { type: 'boolean' },
            retrieved_at: { type: 'string', format: 'date-time' }
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  };

  const captionSchema = {
    $id: 'https://n8n-tt-outpost.local/schemas/caption-output.schema.json',
    title: 'CaptionOutput',
    type: 'object',
    required: ['body', 'hashtags', 'profile_id'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 5000 },
      hashtags: {
        type: 'array',
        maxItems: 100,
        items: { type: 'string', pattern: '^#[^\\s#]{1,100}$' },
        uniqueItems: true
      },
      profile_id: { type: 'string' },
      call_to_action: { type: ['string', 'null'], maxLength: 500 }
    },
    additionalProperties: false
  };

  const mediaAssetSchema = {
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

  const ttsOutputSchema = {
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

  const videoOutputSchema = {
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

  const carouselOutputSchema = {
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

  const qcResultSchema = {
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

  const validator = new SchemaValidator({ 
    schemas: [
      ideationSchema, captionSchema, mediaAssetSchema, 
      ttsOutputSchema, videoOutputSchema, carouselOutputSchema, qcResultSchema
    ] 
  });

  return validator;
}

test('end-to-end content generation: ideation -> caption -> media -> TTS -> video -> QC', async () => {
  const mockAdapter = createMockNemotronAdapter();
  const validator = createValidators();
  
  // Initialize services
  const storage = new MockStorage();
  const artifactRegistry = new ArtifactRegistry({ storage, clock: () => new Date() });
  
  const ideationService = new ContentIdeationService({
    nemotronAdapter: mockAdapter,
    validator
  });
  
  const captionService = new CaptionWriterService({
    nemotronAdapter: mockAdapter,
    validator
  });
  
  const mediaProvider = new MockMediaProvider();
  // Set fallback asset for any keyword search
  mediaProvider.setFallbackAsset({
    media_type: 'image',
    width: 1080,
    height: 1920,
    duration_sec: null,
    source: {
      provider: 'mock_provider',
      provider_asset_id: 'mock-fallback',
      source_url: 'https://mock.example/asset/fallback',
      author: 'Mock Author',
      terms_url: 'https://mock.example/terms',
      attribution_required: false,
      retrieved_at: new Date().toISOString()
    }
  });
  
  const mediaSourcing = new MediaSourcingService({
    providers: [mediaProvider],
    artifactRegistry,
    validator
  });
  
  const ttsEngine = new MockTTSEngine();
  const ttsService = new TTSService({
    engines: [ttsEngine],
    artifactRegistry,
    validator
  });
  
  const videoEncoder = new MockVideoEncoder();
  const videoComposer = new VideoComposerService({
    encoders: [videoEncoder],
    artifactRegistry,
    validator
  });
  
  const qcService = new ContentQCService({
    artifactRegistry,
    validator
  });

  // Test data
  const jobId = 'test-job-' + Date.now();
  const contentPackageId = 'test-package-' + Date.now();
  const userId = 123456789;
  const themeNormalized = 'Tips produktivitas untuk developer';
  const contentProfile = {
    profile_id: 'informative_engaging',
    language: 'id-ID',
    target_format: 'video_9_16',
    target_duration_sec: 60,
    tone: 'informative',
    target_width: 1080,
    target_height: 1920,
    target_fps: 30
  };

  // Step 1: Content Ideation
  const ideationResult = await ideationService.generate({
    jobId,
    themeNormalized,
    contentProfile
  });
  
  assert.ok(ideationResult.ideation);
  assert.equal(ideationResult.ideation.title, "5 Tips Produktivitas Developer");
  assert.equal(ideationResult.ideation.scenes.length, 7);
  assert.equal(ideationResult.ideation.is_fact_checked, false);
  // unverified_notice may be null if no risk keywords detected in mock
  
  // Step 2: Caption Writer
  const captionResult = await captionService.generate({
    jobId,
    ideation: ideationResult.ideation,
    contentProfile
  });
  
  assert.ok(captionResult.caption);
  assert.ok(captionResult.caption.body.length > 0);
  assert.ok(captionResult.caption.hashtags.length > 0);
  assert.equal(captionResult.caption.profile_id, 'informative_engaging');
  assert.ok(captionResult.caption.hashtags.every(t => t.startsWith('#')));
  
  // Step 3: Media Sourcing
  const mediaAssets = await mediaSourcing.sourceForIdeation({
    jobId,
    contentPackageId,
    userId,
    ideation: ideationResult.ideation,
    contentProfile,
    mediaType: 'image',
    countPerScene: 1
  });
  
  assert.ok(mediaAssets.length > 0);
  assert.ok(mediaAssets.every(a => a.asset_uri.startsWith('asset://')));
  assert.ok(mediaAssets.every(a => a.sha256.length === 64));
  assert.ok(mediaAssets.every(a => a.source && a.source.terms_url));
  
  // Step 4: TTS Voiceover
  const narrationScript = ideationResult.ideation.scenes.map(s => s.narration).join(' ');
  const voiceoverResult = await ttsService.generateVoiceover({
    jobId,
    contentPackageId,
    userId,
    narrationScript,
    language: 'id-ID',
    voiceProfile: 'id-ID-mock-voice',
    contentProfile
  });
  
  assert.ok(voiceoverResult.artifact_uri.startsWith('artifact://'));
  assert.equal(voiceoverResult.engine, 'other');
  assert.ok(voiceoverResult.duration_sec > 0);
  assert.ok(voiceoverResult.sha256.length === 64);
  
  // Step 5: Video Composition
  const videoResult = await videoComposer.composeVideo({
    jobId,
    contentPackageId,
    userId,
    contentPackage: {
      ideation: ideationResult.ideation,
      caption: captionResult.caption,
      media_assets: mediaAssets
    },
    mediaAssets,
    voiceoverArtifact: voiceoverResult,
    contentProfile
  });
  
  assert.ok(videoResult.artifact_uri.startsWith('artifact://'));
  assert.equal(videoResult.artifact_type, 'video');
  assert.equal(videoResult.mime_type, 'video/mp4');
  assert.equal(videoResult.width, 1080);
  assert.equal(videoResult.height, 1920);
  assert.ok(videoResult.duration_sec > 0);
  assert.ok(videoResult.sha256.length === 64);
  
  // Step 6: Content QC
  const contentPackage = {
    content_package_id: contentPackageId,
    job_id: jobId,
    schema_version: '1.0.0',
    language: 'id-ID',
    content_status: 'QC_PASSED',
    content_profile_snapshot: contentProfile,
    ideation: ideationResult.ideation,
    caption: captionResult.caption,
    media_assets: mediaAssets,
    voiceover: voiceoverResult,
    artifacts: [
      { artifact_uri: videoResult.artifact_uri, artifact_type: 'video', mime_type: 'video/mp4', sha256: videoResult.sha256, size_bytes: videoResult.size_bytes }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const qcResult = await qcService.runQC(contentPackage, { contentProfile, userId });
  
  console.log('QC Result:', JSON.stringify(qcResult, null, 2));
  
  assert.ok(['PASSED', 'WARNING'].includes(qcResult.status), `QC status: ${qcResult.status}, checks: ${JSON.stringify(qcResult.checks)}`);
  assert.ok(qcResult.checks.length > 0);
  assert.ok(qcResult.checks.some(c => c.check_id === 'SCHEMA' && c.status === 'PASSED'));
  assert.ok(qcResult.checks.some(c => c.check_id === 'VIDEO_PLAYABLE' && c.status === 'PASSED'));
  assert.ok(qcResult.checks.some(c => c.check_id === 'AUDIO_VALID' && c.status === 'PASSED'));
  assert.ok(qcResult.checks.some(c => c.check_id === 'ARTIFACT_INTEGRITY' && c.status === 'PASSED'));
  
  // Verify no hard failures for valid package
  const failedChecks = qcResult.checks.filter(c => c.status === 'FAILED');
  assert.equal(failedChecks.length, 0, `Should have no failed checks: ${JSON.stringify(failedChecks)}`);
});

test('QC rejects package with missing artifact', async () => {
  const validator = createValidators();
  const storage = new MockStorage();
  const artifactRegistry = new ArtifactRegistry({ storage });
  const qcService = new ContentQCService({ artifactRegistry, validator });
  
  const contentPackage = {
    content_package_id: 'test-package',
    job_id: 'test-job',
    schema_version: '1.0.0',
    language: 'id-ID',
    content_status: 'QC_PASSED',
    ideation: { title: 'Test', hook: 'Test', scenes: [{ sequence: 1, narration: 'Test', visual_prompt: 'Test' }], cta: 'Test', keywords: ['test'], is_fact_checked: false, sources: [] },
    caption: { body: 'Test caption', hashtags: ['#test'], profile_id: 'test' },
    media_assets: [],
    voiceover: { artifact_uri: 'artifact://voiceover/missing', engine: 'mock', voice_id: 'test', duration_sec: 10, language: 'id-ID', sha256: 'a'.repeat(64) },
    artifacts: [{ artifact_uri: 'artifact://video/missing', artifact_type: 'video', mime_type: 'video/mp4', sha256: 'b'.repeat(64), size_bytes: 1000 }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const result = await qcService.runQC(contentPackage, { userId: 123 });
  
  assert.equal(result.status, 'FAILED');
  assert.ok(result.blocking_reasons.length > 0);
  assert.ok(result.blocking_reasons.some(r => r.includes('not found')));
});

test('QC detects hash mismatch', async () => {
  const validator = createValidators();
  const storage = new MockStorage();
  const artifactRegistry = new ArtifactRegistry({ storage });
  const qcService = new ContentQCService({ artifactRegistry, validator });
  
  // Register an artifact first
  const registered = await artifactRegistry.registerArtifact({
    jobId: 'test-job',
    contentPackageId: 'test-package',
    userId: 123,
    bytes: Buffer.from('original content'),
    artifactType: 'video',
    mimeType: 'video/mp4',
    width: 1080,
    height: 1920,
    durationSec: 10,
    retentionClass: 'TEMPORARY'
  });
  
  const contentPackage = {
    content_package_id: 'test-package',
    job_id: 'test-job',
    schema_version: '1.0.0',
    language: 'id-ID',
    content_status: 'QC_PASSED',
    ideation: { title: 'Test', hook: 'Test', scenes: [{ sequence: 1, narration: 'Test', visual_prompt: 'Test' }], cta: 'Test', keywords: ['test'], is_fact_checked: false, sources: [] },
    caption: { body: 'Test caption', hashtags: ['#test'], profile_id: 'test' },
    media_assets: [],
    voiceover: { artifact_uri: 'artifact://voiceover/test', engine: 'mock', voice_id: 'test', duration_sec: 10, language: 'id-ID', sha256: 'a'.repeat(64) },
    artifacts: [{ artifact_uri: registered.artifact_uri, artifact_type: 'video', mime_type: 'video/mp4', sha256: 'wrong_hash'.padEnd(64, '0'), size_bytes: 1000 }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const result = await qcService.runQC(contentPackage, { userId: 123 });
  
  assert.equal(result.status, 'FAILED');
  assert.ok(result.blocking_reasons.some(r => r.includes('Hash mismatch')));
});

test('QC detects secret leakage', async () => {
  const validator = createValidators();
  const storage = new MockStorage();
  const artifactRegistry = new ArtifactRegistry({ storage });
  const qcService = new ContentQCService({ artifactRegistry, validator });
  
  // Test with real secret pattern (sk- prefix) - should be FAILED
  const contentPackageWithRealSecret = {
    content_package_id: 'test-package',
    job_id: 'test-job',
    schema_version: '1.0.0',
    language: 'id-ID',
    content_status: 'QC_PASSED',
    ideation: { title: 'Test', hook: 'Test', scenes: [{ sequence: 1, narration: 'Test', visual_prompt: 'Test' }], cta: 'Test', keywords: ['test'], is_fact_checked: false, sources: [] },
    caption: { body: 'Test with sk-1234567890abcdef1234567890abcdef secret', hashtags: ['#test'], profile_id: 'test' },
    media_assets: [],
    voiceover: null,
    artifacts: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const result = await qcService.runQC(contentPackageWithRealSecret, { userId: 123 });
  
  assert.equal(result.status, 'FAILED');
  assert.ok(result.blocking_reasons.some(r => r.includes('secret')));
  
  // Test with generic pattern (token in field name) - should be WARNING
  const contentPackageWithGeneric = {
    content_package_id: 'test-package-2',
    job_id: 'test-job-2',
    schema_version: '1.0.0',
    language: 'id-ID',
    content_status: 'QC_PASSED',
    ideation: { title: 'Test', hook: 'Test', scenes: [{ sequence: 1, narration: 'Test', visual_prompt: 'Test' }], cta: 'Test', keywords: ['test'], is_fact_checked: false, sources: [] },
    caption: { body: 'Test with token field', hashtags: ['#test'], profile_id: 'test' },
    media_assets: [],
    voiceover: null,
    artifacts: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  const result2 = await qcService.runQC(contentPackageWithGeneric, { userId: 123 });
  
  assert.equal(result2.status, 'WARNING');
  assert.ok(result2.warnings.some(w => w.includes('generic pattern')));
});

test('Content ideation throws for empty theme', async () => {
  const mockAdapter = createMockNemotronAdapter();
  const validator = createValidators();
  const ideationService = new ContentIdeationService({ nemotronAdapter: mockAdapter, validator });
  
  await assert.rejects(
    ideationService.generate({
      jobId: 'test-job',
      themeNormalized: '',
      contentProfile: { target_format: 'video_9_16', target_duration_sec: 60, tone: 'informative' }
    }),
    (error) => error.code === 'ERR_THEME_EMPTY'
  );
});

test('Caption writer normalizes hashtags', async () => {
  const mockAdapter = createMockNemotronAdapter();
  const validator = createValidators();
  const captionService = new CaptionWriterService({ nemotronAdapter: mockAdapter, validator });
  
  const ideation = {
    title: 'Test',
    hook: 'Test hook',
    cta: 'Test CTA',
    keywords: ['productivity', 'developer', 'coding'],
    scenes: [{ sequence: 1, narration: 'Scene 1', visual_prompt: 'Visual 1' }]
  };
  
  const result = await captionService.generate({
    jobId: 'test-job',
    ideation,
    contentProfile: { profile_id: 'test', tone: 'informative' }
  });
  
  // All hashtags should be lowercase, start with #, no spaces
  for (const tag of result.caption.hashtags) {
    assert.ok(tag.startsWith('#'));
    assert.ok(!tag.includes(' '));
    assert.ok(tag === tag.toLowerCase());
  }
  
  // Should include keywords as hashtags
  const tagSet = new Set(result.caption.hashtags);
  assert.ok(tagSet.has('#productivity') || tagSet.has('#developer') || tagSet.has('#coding'));
});