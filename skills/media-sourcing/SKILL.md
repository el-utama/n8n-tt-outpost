---
name: media-sourcing
description: Source images or media for n8n-tt-outpost content packages with deterministic provider handling, terms/license metadata, hashes, artifact ownership, and safe cleanup. Use after content ideation and before video composition.
---

# Skill — Media Sourcing

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Mengambil media berdasarkan visual keywords, menyimpan asset sebagai logical URI, dan mencatat metadata source/terms/license agar asset dapat diaudit sebelum digunakan.

## Inputs

- `job_id`, `content_package_id`, `user_id`;
- visual keywords dan scene sequence;
- target media type, quantity, orientation, dan resolution profile;
- approved provider configuration;
- provider credential reference yang tidak pernah diberikan ke LLM.

User tidak boleh memasukkan arbitrary download URL, shell command, atau physical destination path.

## Outputs

Setiap media asset menghasilkan:

```json
{
  "asset_id": "uuid",
  "asset_uri": "asset://uuid",
  "media_type": "image",
  "width": 1080,
  "height": 1920,
  "sha256": "64-hex",
  "source": {
    "provider": "provider-name",
    "provider_asset_id": "provider-id",
    "source_url": "https://provider.example/asset",
    "author": "author-name",
    "terms_url": "https://provider.example/terms",
    "attribution_required": false,
    "retrieved_at": "2026-11-08T03:00:00Z"
  }
}
```

## Procedure

1. Validate keywords dan scene count.
2. Pilih provider dari allowlisted configuration.
3. Request media memakai provider client yang terkontrol.
4. Validate response content type dan size.
5. Simpan asset melalui Artifact Manager, bukan arbitrary path.
6. Hitung SHA-256 dan metadata dimensions/duration.
7. Collect source URL, provider asset ID, author, terms URL, attribution, retrieved time.
8. Deduplicate berdasarkan hash dan optional provider ID.
9. Associate asset dengan scene dan content package.
10. Return structured assets untuk QC.

## Rules

- Jangan menyebut asset “bebas hak cipta” tanpa terms/license evidence.
- Jangan menggunakan URL placeholder, URL yang tidak terverifikasi, atau source yang tidak diketahui.
- Jangan mengunduh dari arbitrary user URL tanpa policy dan sandbox terpisah.
- Jangan menimpa asset user lain.
- Jangan menghapus source metadata setelah asset dipakai.
- Jangan mengirim provider credential ke prompt atau output.
- Jika terms/license tidak tersedia, asset berstatus `REJECTED` atau `HOLD`.
- Gunakan retention dan cleanup setelah job selesai; jangan menghapus asset yang masih direferensikan.

## Provider behavior

Provider client wajib memiliki timeout, bounded retry untuk transient error, rate-limit handling, content-type validation, dan audit event. API key hanya dibaca dari secret reference di runtime.

## Failure modes

| Code | Action |
|---|---|
| `ERR_PROVIDER_UNAVAILABLE` | Retry bounded dengan backoff. |
| `ERR_PROVIDER_RATE_LIMIT` | Respect retry-after; jangan spam retry. |
| `ERR_LICENSE_METADATA` | Reject/hold asset; jangan lanjut QC pass. |
| `ERR_MEDIA_INVALID` | Reject response dan coba kandidat lain. |
| `ERR_MEDIA_QUOTA` | Hold dan notify user/operator. |
| `ERR_DUPLICATE_ASSET` | Reuse existing owned asset bila metadata cocok. |
| `ERR_HASH_MISMATCH` | Security failure; jangan gunakan asset. |

## Side effects

- Provider API read/download melalui client terkontrol.
- Write artifact/media metadata dan hash.
- Write source/license record dan audit event.
- Tidak publish ke platform.

## Quality checks

- Semua asset resolve ke `asset://`.
- Hash valid dan content dapat dibuka.
- Dimension/orientation cocok profile.
- Source/terms metadata lengkap.
- Ownership dan retention benar.
- Tidak ada secret atau physical path pada package.
