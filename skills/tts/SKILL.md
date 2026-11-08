---
name: tts
description: Generate Indonesian voiceover artifacts for n8n-tt-outpost using approved TTS engines with fallback, duration checks, safe filenames, hashes, and ContentPackage integration.
---

# Skill — TTS / Voiceover

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Mengubah narration script menjadi artifact voiceover Bahasa Indonesia yang dapat digunakan Video Composer. Kandidat engine adalah Edge-TTS dan Piper; engine final dipilih oleh configuration/health check.

## Inputs

- `job_id`, `content_package_id`;
- ordered narration script dari ideation;
- language/voice profile;
- target duration dan output format;
- approved engine configuration;
- cancellation signal dan timeout.

Jangan memasukkan secret, arbitrary output path, atau raw provider token ke prompt.

## Outputs

```json
{
  "artifact_uri": "artifact://voiceover/uuid",
  "engine": "edge_tts",
  "voice_id": "id-ID-voice",
  "duration_sec": 42.5,
  "language": "id-ID",
  "sample_rate_hz": 48000,
  "sha256": "64-hex"
}
```

Output harus direferensikan pada `ContentPackage.voiceover` dan Artifact Manager.

## Procedure

1. Validate narration non-empty, language, and length.
2. Select voice profile dari approved configuration.
3. Check engine health dan timeout budget.
4. Generate audio ke managed temporary artifact, bukan user-supplied path.
5. Probe MIME, sample rate, channels, duration, dan readability.
6. Compute SHA-256 dan persist artifact metadata.
7. Jika engine gagal secara retryable, gunakan fallback yang diizinkan.
8. Attach voiceover reference ke ContentPackage.
9. Handoff ke Video Composer dan Content QC.

## Rules

- Default language `id-ID` kecuali content profile menetapkan lain.
- Jangan mengklaim voiceover sukses sebelum audio probe lulus.
- Jangan memutar script yang mengandung secret atau private data yang tidak diperlukan.
- Jangan mengubah narration semantik secara diam-diam saat fallback.
- Fallback wajib dicatat pada audit event.
- Temporary artifact wajib dibersihkan sesuai retention dan cancellation policy.
- Duration harus masuk target atau diberi warning yang dapat ditangani composer.

## Engine policy

Edge-TTS dapat dianggap provider/network-dependent dan memiliki transient failures. Piper dapat menjadi fallback offline jika model/voice tersedia. Tidak boleh mengasumsikan engine atau voice tersedia tanpa health check.

## Failure modes

| Code | Action |
|---|---|
| `ERR_TTS_EMPTY_SCRIPT` | Final failure; minta narration valid. |
| `ERR_TTS_TIMEOUT` | Retry bounded, lalu fallback. |
| `ERR_TTS_PROVIDER` | Retry/fallback sesuai policy. |
| `ERR_TTS_VOICE_UNAVAILABLE` | Fallback approved atau hold. |
| `ERR_AUDIO_INVALID` | Reject artifact dan regenerate. |
| `ERR_AUDIO_DURATION` | Recompose/regenerate; jangan silent truncate. |
| `ERR_TTS_CANCELLED` | Stop cleanly dan return cancelled. |

## Side effects

- Call approved TTS engine.
- Write managed audio artifact, hash, metadata, dan audit event.
- Tidak publish platform.
- Tidak mengubah user files di luar Artifact Manager.

## Quality checks

- Artifact readable dan MIME benar.
- Duration >0 dan berada dalam bound schema.
- Language/voice sesuai profile.
- SHA-256 tersimpan.
- No secret leakage.
- Fallback reason tercatat.
