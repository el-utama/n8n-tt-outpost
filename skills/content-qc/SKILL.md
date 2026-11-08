---
name: content-qc
description: Deterministic content quality control for n8n-tt-outpost. Use for validating ContentPackage schema, media/audio/video metadata, artifact hashes, source/license metadata, text safety checks, and readiness before Telegram delivery or future publishing.
---

# Content Quality Control

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Memeriksa apakah ContentPackage dan artifacts cukup lengkap, aman, valid, dan dapat diputar sebelum delivery. QC adalah deterministic gate; LLM hanya boleh membantu review teks dengan hasil yang tetap harus diklasifikasikan.

## Inputs

- ContentPackage candidate;
- referenced `artifact://` dan `asset://` URIs;
- file metadata dan SHA-256;
- media provider/license metadata;
- target content profile;
- optional platform capability summary untuk preflight masa depan.

Tidak menerima physical path arbitrary dari user.

## Output

```json
{
  "status": "PASSED",
  "checks": [
    {"check_id": "SCHEMA", "status": "PASSED", "message": null},
    {"check_id": "VIDEO_PLAYABLE", "status": "PASSED", "message": null}
  ],
  "blocking_reasons": [],
  "warnings": [],
  "checked_at": "2026-11-08T02:00:00Z",
  "package_version": "1.0.0"
}
```

Status:

- `PASSED`: dapat lanjut ke delivery/policy sesuai mode.
- `WARNING`: dapat lanjut hanya jika tidak ada hard rule dan warning diterima policy.
- `FAILED`: tidak boleh delivery/publish sebagai package final.

## Required checks

### Schema and identity

- valid terhadap `content-package.schema.json`;
- `content_package_id` dan `job_id` valid serta terhubung;
- schema version didukung;
- status dan timestamps valid;
- no unexpected secret fields.

### Artifact integrity

- setiap artifact URI resolve ke artifact milik user/job;
- SHA-256 cocok;
- MIME type sesuai extension/contents;
- size tidak nol dan berada dalam configured quota;
- retention tersedia;
- no arbitrary local path exposure.

### Video/image/audio

- video dapat di-probe dan diputar;
- rasio target 9:16 untuk video;
- width/height dan duration valid;
- audio track ada bila voiceover diwajibkan;
- audio duration tidak kosong dan tidak mismatch fatal;
- image assets dapat dibuka;
- carousel sequence lengkap dan urut;
- overlay text tidak melebihi batas content profile bila ada validator.

### Source and license

- external media memiliki provider, source URL, terms URL, retrieved timestamp;
- attribution requirement disimpan;
- jangan memberi label “bebas hak cipta” tanpa terms/license evidence;
- source URL tidak boleh berupa invented placeholder.

### Text and content

- language sesuai profile;
- caption tidak kosong;
- hashtags valid dan unique;
- scene narration sesuai target duration;
- unverified claims diberi notice;
- no secret, token, cookie, or private path;
- prohibited/safety classification tidak memblokir.

## Readiness decisions

- `READY_FOR_DELIVERY` jika artifact dan package valid.
- `READY_FOR_PUBLISH` hanya jika QC pass dan deterministic policy/adapter gate berikutnya lulus; QC sendiri tidak memberi izin publish.
- `REJECTED` jika hard check gagal.

## Failure modes

| Code | Severity | Action |
|---|---|---|
| `ERR_PACKAGE_SCHEMA` | Hard | Reject; structured fix/retry. |
| `ERR_ARTIFACT_NOT_FOUND` | Hard | Hold; resolve artifact reference. |
| `ERR_HASH_MISMATCH` | Hard | Reject dan audit security event. |
| `ERR_VIDEO_UNPLAYABLE` | Hard | Recompose atau final failure. |
| `ERR_AUDIO_MISSING` | Hard bila voiceover wajib | Re-run TTS/composer. |
| `ERR_LICENSE_METADATA` | Hard untuk external asset | Replace asset atau collect metadata. |
| `WARN_UNVERIFIED_FACT` | Warning | Keep notice; hold bila topic high-risk. |
| `ERR_TEXT_LIMIT` | Hard/profile | Regenerate or revise deterministically. |

## LLM boundary

LLM boleh membantu menemukan awkward wording, unsafe claim, atau language mismatch. LLM tidak boleh menjadi satu-satunya validator file, hash, MIME, duration, license, quota, atau schema.

## Side effects

- Read artifact and metadata.
- Write quality check records dan audit event.
- Set ContentPackage status.
- Tidak publish, tidak login platform, dan tidak mengubah source asset.

## Quality tests

- valid/invalid schema fixtures;
- missing artifact;
- hash mismatch;
- corrupt video/audio;
- wrong aspect ratio;
- missing license terms;
- empty caption/hashtags;
- duration mismatch;
- secret redaction;
- ownership mismatch;
- package mutation after approval.
