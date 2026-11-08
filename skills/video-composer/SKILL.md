---
name: video-composer
description: Compose validated vertical videos and carousel artifacts for n8n-tt-outpost from sourced media and Indonesian voiceover. Use for FFmpeg planning, 9:16 layout, encoder fallback, safe overlays, manifests, hashes, and output validation.
---

# Skill — Video Composer

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Menyusun video vertikal 9:16 atau carousel dari media assets, narration/voiceover, dan overlay text. Skill ini merencanakan atau menjalankan composition hanya melalui managed media service pada tahap implementasi; saat ini dokumen ini belum mengaktifkan FFmpeg.

## Inputs

- ContentPackage partial yang valid;
- ordered media assets dengan dimensions dan hashes;
- voiceover artifact yang sudah lolos TTS validation;
- overlay text/scene timing;
- target resolution, duration, frame rate, audio format;
- encoder capability result;
- managed artifact output reference;
- cancellation and timeout budget.

Tidak menerima arbitrary shell command atau physical output path dari user/LLM.

## Outputs

Video artifact minimal memiliki:

```json
{
  "artifact_uri": "artifact://video/uuid",
  "artifact_type": "video",
  "mime_type": "video/mp4",
  "sha256": "64-hex",
  "size_bytes": 12345678,
  "width": 1080,
  "height": 1920,
  "duration_sec": 42.5
}
```

Carousel menghasilkan ordered image artifacts dan manifest yang dapat direferensikan package.

## Procedure

1. Validate media sequence, dimensions, source metadata, dan voiceover.
2. Resolve logical URIs melalui Artifact Manager.
3. Create deterministic composition plan: aspect ratio, crop/pad, scene timing, overlay, audio mix.
4. Select encoder berdasarkan capability probe: hardware encoder bila lulus, CPU fallback bila tidak.
5. Generate managed temporary output dengan timeout dan cancellation checkpoints.
6. Probe output dengan media validator.
7. Compute SHA-256 dan persist final artifact metadata.
8. Update ContentPackage artifacts dan quality checks.
9. Handoff ke Content QC.

## Target defaults

- format: MP4;
- video codec: H.264;
- audio codec: AAC;
- aspect ratio: 9:16;
- preferred resolution: 1080×1920 bila resource memungkinkan;
- fallback resolution/profile hanya jika content policy mengizinkan;
- duration mengikuti voiceover dan content profile.

Encoder `h264_nvenc` hanya digunakan jika capability probe dan runtime health menyatakan siap. `libx264` adalah fallback CPU, bukan kegagalan desain.

## Rules

- Jangan mengubah media source tanpa membuat artifact/version baru.
- Jangan crop wajah/teks penting secara buta; gunakan safe-area policy.
- Jangan memotong voiceover diam-diam untuk memenuhi duration.
- Jangan menandai artifact valid sebelum probe dapat memutar file.
- Jangan menyimpan output pada arbitrary user path.
- Jangan menyisipkan watermark/platform-specific metadata pada shared asset kecuali profile memintanya.
- Jangan mengunci composition pada satu platform jika package akan cross-post.
- Overlay harus berasal dari approved content fields, bukan secret atau raw provider response.

## Fallback behavior

- GPU unavailable → CPU encoder.
- NVENC error → retry bounded lalu CPU fallback.
- Missing media → fail/return to media-sourcing; jangan membuat video dengan placeholder tanpa status.
- Missing audio → retry TTS atau final failure jika voiceover wajib.
- Text overflow → adjust layout deterministically atau QC failure.
- Disk low/queue full → hold dan operator notification.

## Failure modes

| Code | Action |
|---|---|
| `ERR_COMPOSITION_INPUT` | Final failure atau return ke upstream skill. |
| `ERR_ENCODER_UNAVAILABLE` | Fallback yang approved. |
| `ERR_VIDEO_RENDER_TIMEOUT` | Retry bounded; cleanup temporary output. |
| `ERR_VIDEO_UNPLAYABLE` | Reject artifact dan regenerate. |
| `ERR_VIDEO_DIMENSIONS` | Recompose dengan profile benar. |
| `ERR_OVERLAY_OVERFLOW` | Fix layout atau QC failure. |
| `ERR_DISK_LOW` | Hold, cleanup safe artifacts, notify. |
| `ERR_COMPOSITION_CANCELLED` | Stop dan cleanup temporary outputs. |

## Side effects

- Read managed source artifacts.
- Create temporary/final media artifacts via media service.
- Write hashes, metadata, manifest, and audit events.
- Tidak publish platform.
- Tidak menulis ke arbitrary local path.

## Quality checks

- MP4 readable dan playable.
- Width/height sesuai 9:16 profile.
- Audio track ada dan duration masuk bounds.
- Codec/MIME sesuai output contract.
- Text safe area dan no overflow.
- Hash dan size tersimpan.
- Temporary artifacts cleanup sesuai retention.
- Package version dan artifact ownership konsisten.
