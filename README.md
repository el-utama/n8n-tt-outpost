# n8n-tt-outpost

## Tujuan proyek

`n8n-tt-outpost` adalah sistem agentik content engine dan cross-post adapter berbasis n8n, PostgreSQL, Telegram, dan model Nemotron-compatible. Nemotron berperan sebagai builder/orchestrator yang mengubah requirement menjadi source code, schema, migration, workflow, test, dan dokumentasi yang dapat diverifikasi.

---

## Visi Produk Akhir (End Goal)

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

Produk final mengutamakan **shared visual/audio asset**. Metadata dan delivery payload **tidak dibagi mentah** karena setiap platform memiliki aturan sendiri.

### Tiga Mode Publishing

| Mode | Gate umur TikTok | Approval | Perilaku |
|---|---:|---|---|
| **Manual** | Semua umur | Tidak diperlukan untuk generation | AI membuat paket konten; user publish sendiri. |
| **Semi-Auto** | ≥31 hari | Satu approval per batch | Agent upload item dalam batch yang disetujui. |
| **Full-Auto** | ≥90 hari | Tidak per posting, tetapi policy profile wajib dikonfirmasi | Agent publish berdasarkan batas, jadwal, quota, dan emergency stop user. |

> **Catatan:** Umur akun TikTok adalah gate eligibility, **bukan** jaminan keamanan atau kepatuhan platform. Jika tanggal umur tidak terverifikasi, sistem menyimpan status `unverified` dan menggunakan policy konservatif atau menolak mode otomatis.

### Arsitektur Cross-Post Adapter

**Shared (dipakai bersama 3 platform):**
- video/image/audio asset
- source media hash
- content concept
- base narration
- core CTA intent

**Platform-specific (per adapter):**
- title availability
- caption/description formatting
- hashtag/tag count and syntax
- mentions
- privacy/visibility
- thumbnail/cover
- duration/size/media format
- scheduling capability
- response and retry semantics

> Adapter **tidak boleh** mengirim payload TikTok mentah ke Instagram atau Facebook. Setiap adapter memproses metadata dan delivery contract sendiri.

---

## Roadmap Fasa (F1–F6)

| Fase | Nama | Status Baseline |
|---|---|---|
| **F1** | Foundation | Direncanakan, belum diimplementasikan |
| **F2** | Content Engine | Direncanakan, belum diimplementasikan |
| **F3** | Telegram Manual Interface | Direncanakan, belum diimplementasikan |
| **F4** | Internal scheduler/queue | Direncanakan setelah F1–F3, belum diimplementasikan |
| **F5** | Agentic publisher/cross-post | Roadmap produk final; perlu review & acceptance criteria per platform; belum diimplementasikan |
| **F6** | VPS migration | Ditunda sampai kebutuhan 24/7 terbukti |

> MVP hanya mencakup **F1–F3** (Manual-only). F4–F5 adalah produk final yang diaktifkan bertahap setelah gate, review, dan acceptance criteria terpenuhi.

---

## Prinsip Arsitektur Kunci

1. **Orchestrator terkontrol** — Satu Agent Orchestrator membaca job state, memilih skill, memanggil sub-workflow, mengevaluasi output, dan meminta approval. Tidak boleh melewati deterministic policy gate.
2. **AI untuk reasoning, kode untuk enforcement** — AI cocok untuk ideation, caption, pemilihan angle, penjelasan error. Enforcement (ownership, age gate, quota, interval, idempotency, secret handling, path validation, state transition, emergency stop) harus deterministik.
3. **Modular dan pluggable** — Setiap modul punya input/output contract. Platform publishing diisolasi melalui adapter. Perubahan aturan Instagram tidak merusak schema inti atau adapter TikTok.
4. **PostgreSQL sebagai sumber state** — Sejak F1 untuk job, ownership, queue, idempotency, artifacts, policy profile, publish intent, audit event. SQLite **bukan** fallback runtime setara.
5. **Logical artifact URI** — Internal pakai `artifact://<id>` dan `asset://<id>`. Physical path deployment tidak pernah diterima langsung dari user dan tidak masuk ke prompt agent.
6. **Fail closed pada publishing** — Jika policy, session, adapter, quota, ownership, approval, atau artifact validation tidak jelas, default adalah `DENY`, `HOLD`, atau `WAIT`, bukan publish.

---

## Batasan MVP vs Produk Final

| Aspek | MVP (F1–F3) | Produk Final (F4–F5) |
|---|---|---|
| Publishing | Manual only | Manual, Semi-Auto, Full-Auto |
| Scheduler/Queue | Tidak ada | Ya (F4) |
| Policy Engine | Tidak ada | Ya (F4–F5) |
| TikTok/IG/FB Adapter | Tidak ada | Ya (F5, per platform) |
| Account Age Gate | Tidak ada | Ya (F4) |
| Emergency Stop | Tidak ada | Ya (F5) |
| Login Platform | Tidak ada | Ya (F5, via adapter) |
| Dashboard Web | Tidak wajib | Opsional |

---

## Status saat ini

Project berada pada **Controlled Implementation / Gate 0**. Repository sudah siap digunakan sebagai handoff engineering ke OpenCode Desktop, tetapi produk final belum production-ready. Runtime PostgreSQL, workflow n8n, Telegram consumer, scheduler, dan publisher nyata masih harus dibangun dan diverifikasi sesuai execution plan.

Jangan mengartikan "siap untuk Nemotron" sebagai "sudah siap publish ke platform". F5 publisher tetap nonaktif.

## Mulai di OpenCode Desktop

### Jalur provider

Jika OpenCode Desktop Anda sudah memiliki provider NVIDIA, hubungkan NVIDIA API key melalui mekanisme OpenCode Desktop lalu pilih model Nemotron dari catalog. Anda tidak perlu memasang Nemotron lokal atau vLLM untuk pekerjaan coding-agent.

Konfigurasi custom `opencode.example.jsonc` hanya diperlukan jika provider NVIDIA tidak otomatis tersedia. Panduan detail ada di `docs/OPENCODE_DESKTOP_NEMOTRON_SETUP.md`.

Pola dual-model yang direkomendasikan adalah **Super 120B sebagai default `build` dan `plan`**, lalu **Ultra 550B sebagai agent `ultra-review` read-only** untuk audit arsitektur, security, migration, dan production readiness. OpenCode tidak menjamin automatic complexity routing; gunakan agent atau command `ultra-review` sebagai escalation yang dapat diaudit.

### Prompt pembuka yang disarankan

Gunakan prompt pembuka berikut setelah OpenCode Desktop membuka repository ini:

```text
Baca README.md, 00_AI_SOURCE_OF_TRUTH.md, docs/design.md,
docs/rules.md, docs/NEMOTRON_OPERATOR_GUIDE.md, dan
docs/PRODUCTION_READINESS_EXECUTION_PLAN.md.

Jalankan boot sequence wajib. Audit status repository dan
identifikasi Gate 0 yang sudah lulus serta Gate 1 yang belum dibuat.
Jangan memakai credential, jangan melakukan external provider call,
dan jangan mengaktifkan F5. Buat rencana implementasi Gate 1
beserta file yang akan disentuh, acceptance criteria, dan test plan.
Berhenti di mode PLAN dan tunggu instruksi implementasi.
```

Prompt pembuka ini sengaja berhenti di **Plan mode**. Untuk mengizinkan implementasi, berikan instruksi eksplisit seperti:

```text
Implementasikan task yang sudah direncanakan. Gunakan Build mode.
Kerjakan hanya file yang disetujui, jalankan test dan validator,
lalu laporkan diff, hasil test, side effect, risiko, dan next safe step.
```

## Urutan file yang wajib dibaca Nemotron

Nemotron wajib membaca file berikut sebelum task yang menyentuh repository:

1. `00_AI_SOURCE_OF_TRUTH.md` — prioritas keputusan dan batas global.
2. `docs/design.md` — arsitektur, lifecycle, komponen, dan kontrak sistem.
3. `docs/rules.md` — hard rules, security, approval, dan enforcement.
4. `docs/NEMOTRON_OPERATOR_GUIDE.md` — boot sequence, tool boundary, review loop, dan stop conditions.
5. `docs/PRODUCTION_READINESS_EXECUTION_PLAN.md` — gate, deliverables, exit criteria, dan definition of done.
6. Contract JSON Schema yang relevan.
7. Skill `SKILL.md` yang relevan dengan task.

Jika ada konflik, ikuti urutan prioritas di `00_AI_SOURCE_OF_TRUTH.md`. Jangan menyelesaikan konflik dengan asumsi diam-diam.

## Safety defaults

Default repository harus tetap seperti ini:

```text
FEATURE_STAGE=MVP_MANUAL
ENABLE_F5_PUBLISHER=false
ENABLE_REAL_PROVIDER_CALLS=false
```

Tidak boleh ada secret di repository, workflow export, fixture, log, schema instance, atau prompt. Tidak ada login platform dan tidak ada external publish pada local/mock test.

## Mode kerja Nemotron

| Mode | Kegunaan | External side effect |
|---|---|---|
| `PLAN` | Audit, desain, ADR, schema, rencana, review | Tidak ada |
| `BUILD` | Source code, migration, workflow draft, test | Workspace saja |
| `MOCK` | Fake provider dan end-to-end lokal | Tidak ada provider nyata |
| `PUBLISH` | Provider/platform nyata setelah semua gate lulus | Hanya dengan approval dan policy |

`PUBLISH` bukan mode default. Umur akun saja tidak cukup untuk mengaktifkan mode otomatis.

## Siklus wajib setiap task non-trivial

Nemotron harus menjalankan tiga pass:

1. **Builder:** membuat perubahan sesuai requirement.
2. **Reviewer:** memeriksa diff terhadap source-of-truth, security, ownership, idempotency, dan backward compatibility.
3. **Verifier:** menjalankan schema validation, lint, test, migration dry-run, atau workflow check yang relevan.

Nemotron hanya boleh menyatakan task selesai jika Verifier pass menghasilkan bukti aktual.

## Perintah verifikasi Gate 0

Dari root repository, jalankan:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run validate:schemas
npm.cmd test
```

Test adapter Nemotron saat ini mencakup tool allowlist, argument validation, structured output, default network block, dan timeout classification.

## Guardrails yang tidak boleh dilewati

Nemotron wajib mengembalikan `HOLD` jika requirement ambigu, schema conflict belum selesai, credential atau ownership tidak valid, provider capability tidak diketahui, test tidak dapat dijalankan, migration berisiko kehilangan data, atau external action belum mendapat approval.

Nemotron tidak boleh:

- mengarang aturan platform;
- menganggap upload/publish berhasil tanpa verifier;
- menambahkan publishing route ke MVP;
- menggunakan SQLite sebagai runtime fallback target;
- menyimpan secret;
- melakukan retry non-idempotent;
- menghapus audit atau ownership check agar test lulus;
- mengubah scope task tanpa mencatat dampaknya.

## Format completion report

Setiap task harus diakhiri dengan laporan berikut:

```text
Task: ...
Mode: PLAN | BUILD | MOCK | PUBLISH
Changed files: ...
Contracts validated: ...
Tests/lint executed: ...
Side effects performed: ...
Side effects not performed: ...
Known risks: ...
Next safe step: ...
```

## Production-readiness boundary

Project baru boleh disebut production-ready setelah migration dan restore test, content MVP end-to-end, Telegram Manual acceptance, scheduler/queue recovery, publisher mock tests, secret scan, observability, rollback plan, provider canary, emergency-stop test, dan acceptance sign-off semuanya memiliki evidence.

Ikuti `docs/PRODUCTION_READINESS_EXECUTION_PLAN.md`; jangan mengganti checklist tersebut dengan klaim model.

## Dokumen utama

- `00_AI_SOURCE_OF_TRUTH.md`
- `docs/design.md`
- `docs/rules.md`
- `docs/NEMOTRON_OPERATOR_GUIDE.md`
- `docs/OPENCODE_DESKTOP_NEMOTRON_SETUP.md`
- `docs/PRODUCTION_READINESS_EXECUTION_PLAN.md`
- `contracts/*.schema.json`
- `skills/*/SKILL.md`