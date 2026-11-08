import { SchemaValidator, SchemaValidationError } from '../core/schema-validator.mjs';
import { NemotronAdapter, NemotronAdapterError } from '../adapters/nemotron.mjs';

export class ContentIdeationError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'ContentIdeationError';
    this.code = code;
  }
}

const IDEATION_SCHEMA = {
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

const PROMPT_TEMPLATE = `Anda adalah content strategist untuk platform video pendek Bahasa Indonesia.
Tema: "{theme}"
Profil konten: {profile}
Bahasa: {language}
Target durasi: {target_duration_sec} detik
Format target: {target_format}
Tone: {tone}

Tugas: Hasilkan ideasi konten terstruktur (JSON) sesuai skema:
{
  "title": "Judul menarik ≤200 char",
  "hook": "Hook pembuka ≤300 char, tidak menjanjikan fakta tidak terverifikasi",
  "scenes": [
    {"sequence": 1, "narration": "Narasi scene 1", "visual_prompt": "Prompt visual untuk media sourcing", "overlay_text": "opsional"}
  ],
  "cta": "Call to action ≤300 char",
  "keywords": ["keyword1", "keyword2"],
  "is_fact_checked": false,
  "sources": []
}

Aturan ketat:
- JANGAN menyebut "riset", "fakta", "terbukti", "verified" tanpa sumber eksternal
- is_fact_checked HARUS false kecuali Anda memiliki sumber terverifikasi
- Hook tidak clickbait menyesatkan
- CTA tidak menyiratkan publish sudah terjadi
- Keywords unik, relevan, untuk media sourcing
- Scene sequence berurutan dari 1
- Narration masuk akal untuk durasi target
- Jika tema butuh fakta real-time, sertakan warning di narration`;

export class ContentIdeationService {
  constructor({
    nemotronAdapter,
    validator,
    clock = () => new Date()
  } = {}) {
    this.nemotronAdapter = nemotronAdapter;
    this.validator = validator ?? new SchemaValidator({ schemas: [IDEATION_SCHEMA] });
    this.clock = clock;
  }

  async generate({ jobId, themeNormalized, contentProfile, language = 'id-ID', maxRetries = 2 }) {
    if (!themeNormalized || themeNormalized.trim().length === 0) {
      throw new ContentIdeationError('Theme is empty', { code: 'ERR_THEME_EMPTY' });
    }

    const profile = {
      ...contentProfile,
      target_format: contentProfile.target_format ?? 'video_9_16',
      target_duration_sec: contentProfile.target_duration_sec ?? 60,
      tone: contentProfile.tone ?? 'informative',
      language: contentProfile.language ?? language
    };

    const prompt = PROMPT_TEMPLATE
      .replace('{theme}', themeNormalized)
      .replace('{profile}', JSON.stringify(profile))
      .replace('{language}', profile.language)
      .replace('{target_duration_sec}', String(profile.target_duration_sec))
      .replace('{target_format}', profile.target_format)
      .replace('{tone}', profile.tone);

    let lastError;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await this.nemotronAdapter.complete({
          messages: [
            { role: 'system', content: 'You output valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          tools: [],
          responseSchema: IDEATION_SCHEMA,
          temperature: 0.3,
          topP: 0.9
        });

        let ideation;
        try {
          ideation = JSON.parse(result.content);
        } catch (parseError) {
          throw new ContentIdeationError('Model output is not valid JSON', { code: 'ERR_IDEATION_SCHEMA', cause: parseError });
        }

        this.validator.validate(IDEATION_SCHEMA.$id, ideation);

        // Validate sequence uniqueness
        const sequences = ideation.scenes.map(s => s.sequence);
        if (new Set(sequences).size !== sequences.length) {
          throw new ContentIdeationError('Duplicate scene sequence numbers', { code: 'ERR_IDEATION_SCHEMA' });
        }
        if (!sequences.every((v, i) => v === i + 1)) {
          throw new ContentIdeationError('Scene sequences must be consecutive starting from 1', { code: 'ERR_IDEATION_SCHEMA' });
        }

        // Check for unverified factual claims
        const unverifiedNotice = this.detectUnverifiedClaims(ideation, themeNormalized);

        return {
          ideation,
          unverified_notice: unverifiedNotice,
          generated_at: this.clock().toISOString(),
          model: result.model,
          usage: result.usage
        };

      } catch (error) {
        lastError = error;
        if (error instanceof ContentIdeationError || error instanceof SchemaValidationError) {
          if (attempt > maxRetries) throw error;
          // Wait before retry
          await new Promise(r => setTimeout(r, 500 * attempt));
        } else if (error instanceof NemotronAdapterError) {
          if (error.retryable && attempt <= maxRetries) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
          }
          throw new ContentIdeationError(`Nemotron error: ${error.message}`, { code: 'ERR_NEMOTRON', cause: error });
        } else {
          throw new ContentIdeationError(`Unexpected error: ${error.message}`, { cause: error });
        }
      }
    }

    throw lastError;
  }

  detectUnverifiedClaims(ideation, theme) {
    const riskKeywords = ['angka', 'persen', 'persentase', 'statistik', 'data menunjukkan', 'studi', 'penelitian', 'bukti', 'terbukti'];
    const text = `${ideation.hook} ${ideation.scenes.map(s => s.narration).join(' ')} ${ideation.cta}`.toLowerCase();
    const hasRisk = riskKeywords.some(k => text.includes(k));
    
    if (hasRisk && !ideation.is_fact_checked && ideation.sources.length === 0) {
      return `Konten ini mengandung klaim yang mungkin memerlukan verifikasi faktual. Tema: "${theme}". Output ideation tidak melakukan web research atau fact-checking real-time.`;
    }
    return null;
  }
}