---
name: content-ideation
description: Indonesian content ideation for n8n-tt-outpost. Use for converting a validated theme into hooks, angles, scene outlines, CTA, and media keywords that conform to the ContentPackage schema without claiming web research or fact-checking.
---

# Content Ideation

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Mengubah tema ternormalisasi menjadi ide konten terstruktur untuk video 9:16 atau carousel. Output adalah ideation, bukan riset web, fact-checking, atau bukti kebenaran.

## Inputs

- `job_id` dan correlation ID;
- `theme_normalized`;
- language, tone, target duration, dan content profile;
- optional user constraints;
- safety classification dan prohibited-topic result.

Jangan menerima credential, arbitrary URL fetch command, atau physical path.

## Output contract

Mengisi bagian `ideation` pada ContentPackage:

- `title`;
- `hook`;
- ordered `scenes` dengan `sequence`, `narration`, `visual_prompt`, dan optional `overlay_text`;
- `cta`;
- unique `keywords`;
- `is_fact_checked: false` kecuali ada verifier eksternal yang secara eksplisit menyerahkan status;
- `sources` hanya bila sumber benar-benar tersedia dan metadata valid.

Tambahkan `unverified_notice` untuk klaim yang memerlukan verifikasi.

## Procedure

1. Baca theme dan content profile.
2. Identifikasi intent: edukasi, hiburan, listicle, review, tutorial, atau storytelling.
3. Pilih satu angle yang sesuai tone dan durasi.
4. Tulis hook singkat yang tidak menjanjikan fakta yang belum diverifikasi.
5. Susun scene dari pembuka, isi, bukti/qualifier, dan CTA.
6. Buat visual keywords yang dapat dipakai Media Sourcing.
7. Tandai klaim faktual sebagai `unverified` jika tidak ada source.
8. Validasi panjang, sequence unik, dan schema.
9. Kembalikan structured output; jangan mengirim Telegram atau publish.

## Content rules

- Jangan menyebut output sebagai “hasil riset”, “terbukti”, atau “fact-checked” tanpa evidence.
- Hindari angka, klaim kesehatan, finansial, hukum, atau keselamatan yang tidak memiliki sumber.
- Jika user meminta fakta real-time, kembalikan warning/hold dan jelaskan bahwa MVP tidak melakukan web research real-time.
- Gunakan Bahasa Indonesia sesuai `language`.
- Hook harus konsisten dengan isi; jangan clickbait yang menyesatkan.
- CTA tidak boleh menyiratkan bahwa platform publish sudah terjadi.
- Jangan memasukkan hashtag di scene narration kecuali diminta content profile.

## LLM boundary

LLM boleh memilih angle, wording, scene order, dan keyword. LLM tidak boleh:

- memverifikasi source/license;
- menentukan age gate atau publishing mode;
- mengakses secret;
- mengarang source URL;
- mengubah schema secara informal;
- menyatakan platform rule atau trend terkini sebagai fakta tanpa sumber.

## Failure modes

| Code | Tindakan |
|---|---|
| `ERR_THEME_EMPTY` | Final failure; minta tema baru. |
| `ERR_THEME_UNSAFE` | Hold/deny sesuai safety policy. |
| `ERR_IDEATION_SCHEMA` | Structured retry terbatas, lalu final failure. |
| `ERR_FACT_UNVERIFIED` | Boleh lanjut dengan warning untuk tema non-sensitive; hold untuk tema berisiko. |
| `ERR_CONTEXT_TOO_LONG` | Ringkas input secara deterministik lalu retry. |

## Quality checks

- Output valid terhadap bagian `ideation` schema.
- Setiap scene memiliki sequence unik dan berurutan.
- Keyword tidak duplikat dan relevan dengan tema.
- `is_fact_checked` tidak true tanpa verifier.
- Tidak ada credential, physical path, atau invented source.
- Durasi narration masuk akal terhadap target duration.

## Side effects

- Write ideation result dan audit event.
- Tidak mengambil media.
- Tidak memanggil platform.
- Tidak mempublikasikan.
