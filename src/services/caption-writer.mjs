import { SchemaValidator, SchemaValidationError } from '../core/schema-validator.mjs';
import { NemotronAdapter, NemotronAdapterError } from '../adapters/nemotron.mjs';

export class CaptionWriterError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'CaptionWriterError';
    this.code = code;
  }
}

const CAPTION_SCHEMA = {
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

const PROMPT_TEMPLATE = `Anda adalah caption writer Bahasa Indonesia untuk konten video pendek.
Ideasi konten:
- Title: {title}
- Hook: {hook}
- CTA ideasi: {cta}
- Keywords: {keywords}
- Scenes summary: {scenes_summary}

Profil: {profile}
Bahasa: {language}
Tone: {tone}

Hasilkan JSON caption platform-neutral:
{
  "body": "Caption lengkap Bahasa Indonesia (≤5000 char). Struktur: hook, value, context, CTA.",
  "hashtags": ["#hashtag1", "#hashtag2"],
  "profile_id": "{profile_id}",
  "call_to_action": "CTA singkat"
}

Aturan:
- JANGAN menyebut posting sudah terjadi
- JANGAN klaim "viral", "pasti", "terbukti", "aman" tanpa evidence
- Hashtag dari keywords, unique, format #tag (no space)
- CTA konsisten dengan ideasi, tidak platform-specific
- Hindai klaim faktual lebih kuat dari ideasi
- Jika ada klaim faktual tanpa sumber, sertakan qualifier (mis. "menurut ideasi...")`;

export class CaptionWriterService {
  constructor({
    nemotronAdapter,
    validator,
    clock = () => new Date()
  } = {}) {
    this.nemotronAdapter = nemotronAdapter;
    this.validator = validator ?? new SchemaValidator({ schemas: [CAPTION_SCHEMA] });
    this.clock = clock;
  }

  async generate({ jobId, ideation, contentProfile, language = 'id-ID', maxRetries = 2 }) {
    if (!ideation) {
      throw new CaptionWriterError('Ideation is required', { code: 'ERR_IDEATION_MISSING' });
    }

    const profile = {
      ...contentProfile,
      language: contentProfile.language ?? language,
      tone: contentProfile.tone ?? 'informative'
    };

    const scenesSummary = ideation.scenes
      .map(s => `${s.sequence}. ${s.narration.substring(0, 100)}`)
      .join('; ');

    const prompt = PROMPT_TEMPLATE
      .replace('{title}', ideation.title)
      .replace('{hook}', ideation.hook)
      .replace('{cta}', ideation.cta)
      .replace('{keywords}', ideation.keywords.join(', '))
      .replace('{scenes_summary}', scenesSummary)
      .replace('{profile}', JSON.stringify(profile))
      .replace('{language}', profile.language)
      .replace('{tone}', profile.tone)
      .replace('{profile_id}', profile.profile_id ?? 'default');

    let lastError;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await this.nemotronAdapter.complete({
          messages: [
            { role: 'system', content: 'You output valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          tools: [],
          responseSchema: CAPTION_SCHEMA,
          temperature: 0.3,
          topP: 0.9
        });

        let caption;
        try {
          caption = JSON.parse(result.content);
        } catch (parseError) {
          throw new CaptionWriterError('Model output is not valid JSON', { code: 'ERR_CAPTION_SCHEMA', cause: parseError });
        }

        this.validator.validate(CAPTION_SCHEMA.$id, caption);

        // Normalize hashtags
        caption.hashtags = this.normalizeHashtags(caption.hashtags, ideation.keywords);

        // Check for unverified claims
        const warning = this.detectUnverifiedClaims(caption, ideation);

        return {
          caption,
          warning,
          generated_at: this.clock().toISOString(),
          model: result.model,
          usage: result.usage
        };

      } catch (error) {
        lastError = error;
        if (error instanceof CaptionWriterError || error instanceof SchemaValidationError) {
          if (attempt > maxRetries) throw error;
          await new Promise(r => setTimeout(r, 500 * attempt));
        } else if (error instanceof NemotronAdapterError) {
          if (error.retryable && attempt <= maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
          }
          throw new CaptionWriterError(`Nemotron error: ${error.message}`, { code: 'ERR_NEMOTRON', cause: error });
        } else {
          throw new CaptionWriterError(`Unexpected error: ${error.message}`, { cause: error });
        }
      }
    }

    throw lastError;
  }

  normalizeHashtags(hashtags, keywords) {
    const normalized = new Set();
    
    // Add from model output
    for (const tag of hashtags ?? []) {
      const clean = tag.trim().toLowerCase();
      if (clean.startsWith('#') && clean.length > 1 && !clean.includes(' ')) {
        normalized.add(clean);
      }
    }
    
    // Add from keywords as fallback
    for (const kw of keywords ?? []) {
      const clean = '#' + kw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_#]/g, '');
      if (clean.length > 1 && clean.length <= 101) {
        normalized.add(clean);
      }
    }
    
    return Array.from(normalized).slice(0, 100);
  }

  detectUnverifiedClaims(caption, ideation) {
    const strongClaims = ['terbukti', 'pasti', 'jaminan', 'wajib', 'harus', 'fakta', 'data menunjukkan'];
    const text = `${caption.body} ${caption.call_to_action ?? ''}`.toLowerCase();
    const hasStrong = strongClaims.some(c => text.includes(c));
    
    if (hasStrong && !ideation.is_fact_checked && ideation.sources.length === 0) {
      return 'Caption mengandung klaim kuat tanpa verifikasi faktual. Gunakan qualifier seperti "menurut ideasi..." atau "berdasarkan pendapat..."';
    }
    return null;
  }
}