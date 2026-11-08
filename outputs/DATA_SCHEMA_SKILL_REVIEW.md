# DATA SCHEMA ↔ SKILL REVIEW — n8n-tt-outpost

**Tanggal:** 2026-11-08  
**Scope:** JobRecord, ContentPackage, policy, approval, storage, workflow, dan 15 skill saat ini.  
**Status:** Draft review desain; belum ada runtime implementation.

## 1. Kesimpulan

Dua schema awal sudah menjadi fondasi yang benar, tetapi belum cukup untuk seluruh lifecycle 15 skill. Gap utama ada pada publishing dan operasional:

1. JobRecord membutuhkan `correlation_id`, `feature_stage`, dan `cancel_requested_at`.
2. ContentPackage membutuhkan immutable `content_profile_snapshot` agar caption writer, TTS, video composer, QC, dan adapter memakai profile yang sama.
3. Policy Engine membutuhkan kontrak `policy-profile.schema.json`.
4. Cross-post adapter membutuhkan `platform-payload.schema.json`.
5. Publisher membutuhkan `publish-intent.schema.json` dan `publish-result.schema.json`.
6. Batch approval, storage-retention, queue, dan audit harus memiliki persistence model di database.

Perubahan tersebut sudah ditulis sebagai draft schema dan desain database.

## 2. Compatibility matrix

| Skill | Kontrak utama | Status |
|---|---|---|
| `job-state` | `job.schema.json` | Cocok; ditambah correlation/stage/cancellation |
| `orchestrator` | `job.schema.json`, all contracts | Cocok setelah routing memakai intent/policy result |
| `policy-engine` | `policy-profile.schema.json` | Ditambahkan |
| `content-ideation` | `content-package.schema.json` | Cocok; menulis ideation dan unverified status |
| `content-qc` | `content-package.schema.json` | Cocok; quality checks dan artifact integrity |
| `telegram` | Job, artifact, approval/result refs | Cocok; persistence dijelaskan di DB design |
| `caption-writer` | `content-package.schema.json` | Cocok; caption dasar platform-neutral |
| `media-sourcing` | Content package media/source defs | Cocok; terms/license dan hash required |
| `tts` | Content package voiceover + artifact | Cocok |
| `video-composer` | Content package artifact + profile snapshot | Cocok setelah profile snapshot ditambahkan |
| `batch-approval` | `publish-intent`, `policy-profile` | Cocok setelah schemas baru |
| `storage-retention` | Content package artifact + DB artifact model | Cocok; physical path tetap internal |
| `tiktok-adapter` | payload/intent/result schemas | Ditambahkan |
| `instagram-adapter` | payload/intent/result schemas | Ditambahkan |
| `facebook-adapter` | payload/intent/result schemas | Ditambahkan |

## 3. JobRecord review

### Corrected

- `correlation_id` menghubungkan Telegram, n8n execution, skill calls, dan audit events.
- `feature_stage` mencegah workflow MVP membuka route F5 secara implisit.
- `cancel_requested_at` membuat cancellation dapat diaudit.
- Existing state, attempt, max attempts, idempotency, error, and retention tetap dipertahankan.

### Remaining design note

Publish lifecycle tidak dipaksa masuk ke `JobRecord.status` creation state machine. Publishing dikelola oleh `PublishIntent` dan `PublishResult`, lalu dirujuk dari job. Ini mencegah state creation bercampur dengan state per-platform.

## 4. ContentPackage review

### Corrected

`content_profile_snapshot` sekarang wajib. Snapshot ini immutable dan memuat profile ID, language, target format, target duration, dan tone. Dengan demikian, package tidak berubah hasilnya hanya karena profile user berubah setelah job dibuat.

### Existing compatible areas

- Ideation mendukung hook, scenes, CTA, keywords, dan unverified status.
- Caption mendukung body, CTA, profile ID, dan hashtags dasar.
- Media asset mendukung URI, media type, hash, dan source/license metadata.
- Voiceover mendukung artifact URI, engine, voice ID, duration, dan language.
- Artifact mendukung type, MIME, hash, size, dimensions, dan duration.
- Platform profiles tetap opsional dan tidak menjadi payload final adapter.
- Quality checks dapat menyimpan result QC.

## 5. New contracts

### `policy-profile.schema.json`

Dipakai oleh Policy Engine, Scheduler, Full-Auto preflight, dan database policy profile. Memuat mode, timezone, start date, duration, quota, interval, time window, active days/platforms, batch limit, retry limit, duplicate prevention, emergency stop, confirmation, dan version.

### `platform-payload.schema.json`

Dipakai oleh tiga adapter. Memisahkan shared ContentPackage dari payload platform-specific. Field `title`, caption, hashtags, mentions, privacy, schedule, platform options, artifact URI, adapter version, dan idempotency key dapat divalidasi sebelum upload.

### `publish-intent.schema.json`

Satu intent menghubungkan job, package version/hash, user, account, mode, policy, batch/approval, platform list, intended schedule, dan per-platform status.

### `publish-result.schema.json`

Menyimpan result per platform, remote post ID/URL, status, idempotency key, adapter version, attempt, normalized error, verification time, dan partial failure.

## 6. Cross-post adapter rules

- Visual/audio source dapat shared.
- Payload selalu dibangun ulang per adapter.
- Title tidak diasumsikan ada di Instagram.
- Hashtag/tag, mention, caption, privacy, schedule, media type, duration, size, thumbnail, dan error taxonomy platform-specific.
- Unknown capability menghasilkan `HOLD`, bukan hard-coded assumption.
- Remote request acceptance bukan bukti publish sukses; result verification wajib.
- Partial platform success disimpan per platform, tidak ditimpa menjadi satu status global.

## 7. Workflow/database alignment

`docs/n8n-workflow-design.md` memetakan skill ke sub-workflow WF-00 sampai WF-60. `docs/database-design.md` menyediakan persistence untuk semua kontrak baru, termasuk queue leases, idempotency, batch approvals, payloads, results, artifacts, dan audit events.

Tidak ada schema atau workflow yang mengaktifkan F5 secara default.

## 8. Open decisions before implementation

- API/integration method resmi per platform.
- Capability/limit configuration per adapter dan versi API.
- Exact retention duration dan storage quota.
- Secret/session provider.
- JSON Schema validator runtime.
- PostgreSQL migration tool.
- n8n execution-data redaction policy.

## 9. Verdict

Kontrak data sekarang mencakup content creation, Manual delivery, scheduler, approval, storage, dan publisher result lifecycle secara terpisah. Paket desain siap digunakan sebagai dasar review berikutnya sebelum implementasi workflow n8n atau integrasi platform dimulai.
