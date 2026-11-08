---
name: caption-writer
description: Generate Indonesian captions, CTAs, and base hashtags for n8n-tt-outpost content packages. Use after content ideation and before QC, while keeping the output platform-neutral and leaving platform-specific payload limits to adapters.
---

# Skill — Caption Writer

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Menghasilkan caption dasar Bahasa Indonesia, CTA, dan hashtag untuk shared ContentPackage. Skill ini tidak membuat payload final TikTok, Instagram, atau Facebook dan tidak menentukan aturan platform.

## Inputs

- `content_package_id` dan `job_id`;
- ideation: title, hook, scenes, CTA, keywords;
- language dan tone dari content profile;
- optional brand voice;
- optional user constraints yang sudah divalidasi.

Jangan menerima secret, physical path, credential, atau platform limit sebagai instruksi bebas dari LLM.

## Outputs

Mengisi object `caption`:

```json
{
  "body": "Caption Bahasa Indonesia.",
  "hashtags": ["#contoh", "#konten"],
  "profile_id": "informative_engaging",
  "call_to_action": "Simpan untuk referensi."
}
```

Caption dasar boleh menjadi input adapter, tetapi adapter dapat membuat `caption_override` sesuai aturan platform.

## Procedure

1. Baca ideation dan content profile.
2. Tentukan struktur: hook, value, context/qualifier, CTA.
3. Tulis Bahasa Indonesia yang natural dan sesuai tone.
4. Buat hashtag relevan dari keyword; hilangkan duplicate dan tag kosong.
5. Hindari klaim yang lebih kuat daripada ideation evidence.
6. Tandai `unverified` bila caption memuat klaim faktual tanpa sumber.
7. Validasi panjang schema dan karakter.
8. Simpan caption draft pada ContentPackage dan kirim ke Content QC.

## Rules

- Jangan menyebut posting sudah terjadi.
- Jangan mengklaim “viral”, “pasti”, “terbukti”, atau “aman” tanpa evidence.
- Jangan mengunci caption pada “panjang optimal TikTok”.
- Jangan menganggap jumlah hashtag dasar sebagai limit platform.
- Hashtag harus diawali `#`, tidak mengandung whitespace, dan unique.
- Jangan menaruh token, URL credential, physical path, atau internal error.
- Jika tema berisiko/ambigu, pertahankan qualifier dan minta review sesuai policy.

## LLM boundary

LLM boleh menyusun wording, tone, CTA, dan kandidat hashtag. Deterministic validation tetap memeriksa schema, panjang, karakter, duplicate, prohibited terms, dan platform-specific constraints pada adapter.

## Failure modes

| Code | Action |
|---|---|
| `ERR_IDEATION_MISSING` | Hold sampai ideation tersedia. |
| `ERR_CAPTION_SCHEMA` | Structured retry terbatas, lalu final failure. |
| `ERR_CAPTION_TOO_LONG` | Ringkas sesuai content profile, bukan platform assumption. |
| `ERR_HASHTAG_INVALID` | Normalize/reject invalid tags. |
| `WARN_UNVERIFIED_CLAIM` | Simpan warning; hold untuk topic high-risk. |

## Side effects

- Write caption object dan audit event.
- Tidak memanggil platform.
- Tidak membuat upload payload.
- Tidak memodifikasi source media.

## Quality checks

- Caption non-empty dan valid schema.
- CTA konsisten dengan content ideation.
- Hashtags unique dan valid syntax.
- No unsupported factual certainty.
- Language/tone sesuai content profile.
- Tidak ada secret atau physical path.
