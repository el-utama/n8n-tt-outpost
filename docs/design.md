# DESIGN — n8n-tt-outpost

**Status:** Draft desain disetujui untuk diskusi dan pematangan; belum diimplementasikan  
**Versi:** 1.0.0-draft  
**Tanggal:** 2026-11-08  
**Bahasa produk:** Bahasa Indonesia  
**Timezone baseline:** `Asia/Jakarta`

## 1. Tujuan dan batas desain

n8n-tt-outpost adalah sistem lokal berbasis n8n yang menerima tema konten dari Telegram, menghasilkan content package dengan bantuan AI lokal dan media tools, lalu pada produk final dapat mengirimkan package tersebut ke TikTok, Instagram, dan Facebook melalui agentic cross-post publisher.

Desain ini membedakan dua target:

1. **MVP F1–F3:** content generation dan Telegram delivery, Manual-only.
2. **Produk final F4–F5:** scheduler, policy engine, tiga mode publishing, dan adapter TikTok/Instagram/Facebook.

Desain ini tidak mengaktifkan bot, API platform, database runtime, login platform, atau workflow n8n. Ia menetapkan struktur agar implementasi selanjutnya tidak menyimpang dari keputusan produk.

## 2. Visi produk

```text
Tema dari Telegram
    ↓
Validasi user, ownership, dan content profile
    ↓
Content Ideation
    ↓
Media sourcing + license metadata
    ↓
Caption, hashtag, voiceover
    ↓
Video/carousel composition
    ↓
Content Quality Control
    ↓
TikTok age gate + publishing mode
    ├── Manual → kirim package ke Telegram
    ├── Semi-Auto → batch approval → adapter publish
    └── Full-Auto → policy preflight → adapter publish
    ↓
Verifikasi hasil dan audit per platform
```

Produk final mengutamakan shared visual/audio asset. Metadata dan delivery payload tidak dibagi mentah karena setiap platform memiliki aturan sendiri.

## 3. Sasaran mode publishing

| Mode | Gate umur TikTok | Approval | Perilaku |
|---|---:|---|---|
| Manual | Semua umur | Tidak diperlukan untuk generation | User menerima package dan posting sendiri. |
| Semi-Auto | ≥31 hari | Satu approval per batch | Agent upload item dalam batch yang disetujui. |
| Full-Auto | ≥90 hari | Tidak per posting, tetapi policy profile wajib dikonfirmasi | Agent publish berdasarkan batas, jadwal, quota, dan emergency stop user. |

Umur akun TikTok adalah gate eligibility, bukan jaminan keamanan atau kepatuhan platform. Jika tanggal umur tidak terverifikasi, sistem menyimpan status `unverified` dan menggunakan policy konservatif atau menolak mode otomatis.

## 4. Prinsip arsitektur

### 4.1 Orchestrator terkontrol

Satu Orchestrator Agent membaca job state, memilih skill, memanggil sub-workflow, mengevaluasi output, dan meminta approval. Orchestrator tidak boleh melewati deterministic policy gate.

### 4.2 AI untuk reasoning, kode untuk enforcement

AI cocok untuk ideation, caption, pemilihan angle, penjelasan error, dan penyusunan batch. Enforcement harus deterministik: ownership, age gate, quota, interval, date window, idempotency, secret handling, path validation, state transition, emergency stop, dan media validation.

### 4.3 Modular dan pluggable

Setiap modul memiliki input/output contract. Platform publishing diisolasi melalui adapter. Perubahan aturan Instagram tidak boleh merusak schema inti atau adapter TikTok.

### 4.4 PostgreSQL sebagai sumber state

PostgreSQL adalah database target sejak F1 untuk job, ownership, queue, idempotency, artifacts, policy profile, publish intent, dan audit event. SQLite bukan fallback runtime setara.

### 4.5 Logical artifact URI

Dokumen dan API internal menggunakan `artifact://<id>` dan `asset://<id>`. Physical path deployment tidak pernah diterima langsung dari user dan tidak masuk ke prompt agent.

### 4.6 Fail closed pada publishing

Jika policy, session, adapter, quota, ownership, approval, atau artifact validation tidak jelas, keputusan default adalah `DENY`, `HOLD`, atau `WAIT`, bukan publish.

## 5. Komponen sistem

### 5.1 Interface dan orchestration

- **Telegram Update Consumer:** mengambil update dengan satu consumer aktif atau distributed lock.
- **Telegram Command Router:** memetakan `/post`, `/status`, `/download`, `/batal`, `/mode`, `/account`, dan approval batch.
- **Agent Orchestrator:** mengatur skill berdasarkan state job.
- **Job State Manager:** melakukan transition yang valid, checkpoint, retry, dan cancellation.
- **Notification Service:** mengirim status yang aman dan tidak membocorkan secret.

### 5.2 Content engine

- **Theme Processor:** normalisasi input dan safety classification.
- **Content Ideation:** hook, angle, scene outline, CTA, keyword; bukan fact-checking web.
- **Media Sourcing:** mengambil media dengan source/license metadata.
- **Caption Writer:** caption, CTA, hashtag dengan content profile.
- **TTS Engine:** Edge-TTS atau Piper dengan fallback.
- **Video Composer:** FFmpeg, output 9:16, GPU encoder bila probe berhasil.
- **Carousel Composer:** fallback atau format alternatif lima gambar.
- **Content QC:** validasi media, audio, teks, rasio, duration, license metadata, dan completeness.

### 5.3 Policy dan publishing

- **Account Metadata Manager:** menyimpan platform-neutral account metadata.
- **Account Age Gate:** menghitung eligibility berdasarkan TikTok age.
- **Policy Engine:** memutuskan `ALLOW`, `DENY`, `HOLD`, atau `NEED_APPROVAL`.
- **Batch Builder:** membentuk batch untuk Semi-Auto atau Full-Auto.
- **Approval Gate:** approval per batch untuk Semi-Auto.
- **Policy Preflight:** memeriksa Full-Auto sebelum setiap batch dan publish.
- **TikTok Adapter:** payload, limits, auth/session, scheduling, dan result verification TikTok.
- **Instagram Adapter:** payload Instagram yang berbeda dari TikTok.
- **Facebook Adapter:** payload Facebook yang berbeda dari TikTok.
- **Publish Result Verifier:** memeriksa response, remote ID, status, dan error taxonomy.
- **Emergency Stop:** menghentikan batch berikutnya dan pekerjaan yang masih dapat dihentikan.

### 5.4 Operasional

- **Scheduler:** jadwal produksi dan publish menggunakan `Asia/Jakarta`.
- **Queue Manager:** lease, concurrency, backpressure, retry, dead-letter.
- **Artifact Manager:** hash, ownership, retention, expiring link, cleanup.
- **Secret/Session Manager:** secret reference, encryption, rotation, revoke, expiry.
- **Observability:** metrics, structured logs, audit events, alerts.
- **Backup/Restore:** PostgreSQL backup dan artifact recovery.
- **Hardware Capability Detector:** probe model, GPU, encoder, disk, dan concurrency.

## 6. Alur lifecycle job

### 6.1 State machine creation

```text
RECEIVED
  → VALIDATING
  → GENERATING_IDEATION
  → SOURCING_MEDIA
  → GENERATING_CAPTION
  → GENERATING_TTS
  → COMPOSING_VIDEO
  → VALIDATING_ARTIFACT
  → DELIVERING
  → COMPLETED
```

Failure dan cancellation:

```text
ANY_STATE → FAILED_RETRYABLE
ANY_STATE → FAILED_FINAL
ANY_STATE → CANCEL_REQUESTED → CANCELLED
```

State transition wajib transaksional, menyimpan `job_id`, `user_id`, `step`, `attempt`, `timestamp`, dan structured error bila ada. Tidak boleh ada transition langsung dari input user ke publishing.

### 6.2 Creation flow

1. Telegram consumer menerima update.
2. Allowlist dan ownership diperiksa.
3. Idempotency key dicari; duplicate update tidak membuat job baru.
4. `JobRecord` dibuat sesuai `contracts/job.schema.json`.
5. Theme Processor membersihkan dan mengklasifikasikan tema.
6. Content Ideation menghasilkan `ideation` dengan status fakta yang sesuai.
7. Media Sourcing menghasilkan media assets dan source/license metadata.
8. Caption Writer membuat caption dasar dan hashtags.
9. TTS menghasilkan voiceover artifact.
10. Video/Carousel Composer menghasilkan artifact.
11. Content QC mengisi quality checks.
12. Content package diberi status `READY_FOR_DELIVERY` atau `READY_FOR_PUBLISH`.
13. Manual delivery mengirim package ke Telegram.

### 6.3 Publishing flow produk final

```text
READY_FOR_PUBLISH
    ↓
RESOLVE_ACCOUNT
    ↓
CHECK_TIKTOK_AGE_GATE
    ↓
CHECK_MODE
    ├── MANUAL → DELIVER_PACKAGE
    ├── SEMI_AUTO → BUILD_BATCH → USER_APPROVAL → PREFLIGHT
    └── FULL_AUTO → LOAD_POLICY → PREFLIGHT
    ↓
BUILD_PLATFORM_PAYLOADS
    ↓
PUBLISH_PER_PLATFORM
    ↓
VERIFY_REMOTE_RESULT
    ↓
PUBLISHED / PARTIAL_FAILURE / FAILED_RETRYABLE / STOPPED
```

Publish tidak boleh terjadi sebelum `ContentPackage` valid dan semua deterministic checks pass.

## 7. Data contracts

### 7.1 JobRecord

`contracts/job.schema.json` adalah schema utama lifecycle job. Minimum konsepnya:

- identity: `job_id`, `user_id`, `account_id`;
- input: `theme_raw`, `theme_normalized`, `content_profile`;
- state: `status`, `current_step`, `attempt`, `max_attempts`;
- safety: `idempotency_key`, `policy_decision`, `timezone`;
- outputs: `content_package_id`, `publish_intent_id`;
- error/recovery: structured `error`, timestamps, retention.

### 7.2 ContentPackage

`contracts/content-package.schema.json` adalah shared package antara content engine, Telegram delivery, QC, dan adapter. Minimum konsepnya:

- identity: package ID, job ID, schema version;
- ideation: title, hook, scenes, CTA, keywords, source status;
- caption: body, hashtags, profile;
- media: asset URI, hash, dimensions, source/license;
- voiceover dan artifacts;
- optional platform profiles tanpa mengunci payload adapter;
- quality checks dan retention.

Adapter boleh menghasilkan payload turunan, tetapi tidak boleh mengubah source package secara tidak terkontrol.

### 7.3 Policy profile

`contracts/policy-profile.schema.json` adalah kontrak untuk mode Semi-Auto dan Full-Auto. Policy profile menyimpan age-gate outcome secara terpisah dari konfigurasi quota, interval, time window, active platforms, retry limit, duplicate prevention, dan emergency stop. Policy Engine adalah pemilik keputusan `ALLOW`, `DENY`, `HOLD`, atau `NEED_APPROVAL`.

### 7.4 Platform payload

`contracts/platform-payload.schema.json` adalah payload turunan yang dibuat oleh adapter per platform. Payload ini tidak menggantikan shared ContentPackage dan tidak boleh dikirim lintas platform tanpa transformasi.

### 7.5 Publish intent dan result

`contracts/publish-intent.schema.json` dan `contracts/publish-result.schema.json` menjadi kontrak record terpisah yang sekurang-kurangnya memiliki:

- `publish_intent_id`;
- `content_package_id`;
- `user_id` dan `account_id`;
- `mode`;
- `policy_profile_id`;
- platform target;
- unique idempotency key per platform;
- approval state;
- intended schedule;
- status per platform;
- created/updated timestamps.

Publish result menyimpan remote post ID jika tersedia, adapter version, response classification, published timestamp, retry count, dan error aman.

## 8. Policy profile dan preflight

Full-Auto tidak boleh diaktifkan tanpa policy profile lengkap:

```json
{
  "policy_profile_id": "uuid",
  "start_at": "Asia/Jakarta datetime",
  "duration_days": 14,
  "max_posts_per_day": 3,
  "max_posts_per_platform_per_day": 1,
  "minimum_interval_minutes": 120,
  "daily_time_window": {"start": "09:00", "end": "21:00"},
  "active_days": ["MON", "WED", "FRI"],
  "active_platforms": ["tiktok", "instagram", "facebook"],
  "max_batch_items": 3,
  "retry_limit": 2,
  "emergency_stop": false
}
```

Preflight memeriksa:

1. umur TikTok dan status verifikasi;
2. mode user dan eligibility;
3. policy aktif dan belum expired;
4. daily quota dan total quota;
5. minimum interval dan time window;
6. platform aktif dan adapter health;
7. session validity dan permission;
8. content package QC;
9. duplicate prevention;
10. emergency stop;
11. approval state untuk Semi-Auto;
12. retention dan artifact availability.

## 9. Cross-post adapter design

### 9.1 Shared versus platform-specific

Shared:

- video/image/audio asset;
- source media hash;
- content concept;
- base narration;
- core CTA intent.

Platform-specific:

- title availability;
- caption/description formatting;
- hashtag/tag count and syntax;
- mentions;
- privacy/visibility;
- thumbnail/cover;
- duration/size/media format;
- scheduling capability;
- response and retry semantics.

### 9.2 Adapter interface konseptual

```text
validate_capabilities(account, content_package, policy) -> AdapterValidation
build_payload(content_package, platform_profile) -> PlatformPayload
preflight(payload, session, policy) -> PreflightResult
publish(payload, session, idempotency_key) -> PublishResult
verify(result) -> VerificationResult
normalize_error(provider_error) -> NormalizedError
```

Adapter tidak boleh membaca physical path user dari payload. Ia hanya menerima artifact URI yang sudah diotorisasi oleh Artifact Manager.

## 10. Approval dan emergency stop

### 10.1 Semi-Auto batch approval

Approval diberikan untuk satu batch, bukan satu posting. Preview harus menunjukkan item, platform, jadwal, caption/metadata per platform, asset preview, quota impact, dan warning. Approval memiliki expiry dan terikat pada hash batch. Perubahan package setelah approval membatalkan approval lama.

### 10.2 Full-Auto emergency stop

Emergency stop tersedia dari Telegram dan jalur operasional admin. Saat aktif:

- batch baru tidak dibuat;
- item queued tidak diupload;
- upload yang sedang berlangsung dihentikan bila provider dan adapter mendukung;
- session tidak dihapus otomatis tanpa keputusan recovery;
- event stop dicatat;
- user menerima status.

Resume memerlukan policy preflight ulang.

## 11. Security dan privacy

- Allowlist dan ownership wajib di layer Telegram dan database.
- Secret hanya direferensikan melalui secret manager atau environment secure.
- Secret tidak boleh berada di prompt, log, workflow export, schema instance, atau Telegram message.
- Session/auth material dienkripsi, memiliki TTL, rotation, revoke, dan access control.
- User tidak pernah mengirim physical path arbitrary untuk dibaca worker.
- Artifact download memakai ownership check, expiry, dan retention.
- Structured logs wajib meredaksi token, cookie, authorization header, dan private content.
- Platform account metadata bersifat platform-neutral; username input user tidak dianggap bukti ownership.

## 12. Error, retry, dan recovery

Error dibagi menjadi:

- **retryable:** timeout sementara, provider 5xx, network interruption;
- **final:** schema invalid, policy denied, ownership failure, unsupported media;
- **approval required:** batch belum disetujui atau policy berubah;
- **session action required:** login/2FA/CAPTCHA/session expiry membutuhkan tindakan user;
- **operator action:** queue/database/storage/secret health bermasalah.

Retry wajib bounded, memakai backoff, idempotency, dan mencatat attempt. Retry tidak boleh menghasilkan duplicate publishing. Setelah batas tercapai, job menjadi `FAILED_FINAL` atau `HOLD` sesuai error.

## 13. Observability dan audit

Minimum metrics:

- job created/completed/failed per step;
- queue depth dan stale jobs;
- processing duration per skill;
- TTS/video error rate;
- artifact size dan cleanup age;
- approval latency;
- publish success/failure per platform;
- retry count dan duplicate prevention count;
- policy denial dan emergency stop events.

Audit event minimum:

- siapa membuat job;
- perubahan state;
- perubahan policy;
- approval/rejection batch;
- preflight decision dan reason;
- publish intent dan adapter version;
- remote result ID;
- emergency stop/resume;
- session/auth action tanpa menyimpan secret.

## 14. Deployment boundary

### MVP lokal

- Windows user desktop;
- Docker Desktop/WSL2 untuk n8n;
- Ollama lokal;
- FFmpeg;
- PostgreSQL;
- Telegram Bot API;
- local artifact storage dengan retention.

### Produk final

Publisher dapat tetap berjalan lokal atau dipindahkan ke environment always-on setelah F6 dievaluasi. VPS bukan prasyarat MVP dan bukan solusi otomatis untuk compliance, session, atau rate limits.

## 15. Tahapan implementasi yang disarankan

1. Freeze source-of-truth, design, rules, dan schemas.
2. Validasi schema dengan contoh valid/invalid.
3. Implement deterministic job state dan PostgreSQL persistence.
4. Implement content-only dry-run tanpa Telegram publisher.
5. Implement Telegram Manual MVP.
6. Implement scheduler, queue, policy engine, dan account-age gate tanpa publish.
7. Siapkan adapter contract dan test fixtures platform.
8. Implement Semi-Auto batch approval pada environment test setelah review.
9. Implement Full-Auto policy preflight, quotas, intervals, dan emergency stop.
10. Aktivasi adapter per platform secara terpisah setelah go/no-go.

Setiap tahap harus memiliki acceptance criteria, rollback, dan tidak boleh membuka fitur tahap berikutnya secara implisit.

## 16. Keputusan yang belum boleh diasumsikan

- API resmi atau jalur teknis final tiap platform belum dikunci.
- Ketersediaan scheduling dan upload capability tiap platform harus diverifikasi pada fase adapter.
- Umur akun yang user-input belum otomatis verified.
- Content Ideation bukan riset web atau fact-checking.
- Randomisasi bukan jaminan keamanan atau cara menghindari deteksi.
- Full-Auto tidak boleh aktif tanpa policy profile, preflight, observability, dan emergency stop.
