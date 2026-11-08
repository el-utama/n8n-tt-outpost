# n8n-tt-outpost

Project ini sedang dibangun sebagai sistem agentik content engine dan cross-post adapter berbasis n8n, PostgreSQL, Telegram, dan Nemotron-compatible model endpoint.

## Status

Saat ini berada pada **Controlled Implementation / Gate 0**. Dokumen desain, contract schema, skill contracts, dan production-readiness plan tersedia. Runtime publisher belum aktif.

## Wajib dibaca oleh AI builder

1. `00_AI_SOURCE_OF_TRUTH.md`
2. `docs/design.md`
3. `docs/rules.md`
4. `docs/NEMOTRON_OPERATOR_GUIDE.md`
5. `docs/PRODUCTION_READINESS_EXECUTION_PLAN.md`
6. Contract JSON Schema yang relevan
7. Skill `SKILL.md` yang relevan

## Safety defaults

- `FEATURE_STAGE=MVP_MANUAL`
- `ENABLE_F5_PUBLISHER=false`
- `ENABLE_REAL_PROVIDER_CALLS=false`
- Tidak ada secret di repository.
- Tidak ada platform login atau external publish dalam local/mock test.

## Model profile

Nemotron dipilih melalui `contracts/model-profile.schema.json` dan capability probe. Jangan hard-code varian model hanya karena nama keluarga. Endpoint/model reference diambil dari environment atau secret manager.

Jika OpenCode Desktop Anda sudah memiliki provider NVIDIA dan koneksi NVIDIA API key, gunakan provider bawaan tersebut terlebih dahulu. `opencode.example.jsonc` hanya diperlukan jika provider NVIDIA tidak otomatis tersedia. Ikuti `docs/OPENCODE_DESKTOP_NEMOTRON_SETUP.md` untuk membedakan koneksi OpenCode Desktop dari credential runtime aplikasi.

## Production readiness

Ikuti `docs/PRODUCTION_READINESS_EXECUTION_PLAN.md`. Jangan mengklaim production-ready sebelum seluruh gate dan evidence terpenuhi.
