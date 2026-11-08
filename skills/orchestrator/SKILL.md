---
name: orchestrator
description: Coordinate n8n-tt-outpost jobs and skills using JobRecord state, schemas, deterministic policy decisions, approvals, recovery, and safe routing without bypassing enforcement gates.
---

# SKILL — Orchestrator Agent

**Status:** Draft  
**Versi:** 1.0.0-draft  
**Owner:** Agent runtime / n8n orchestration layer  
**Sumber aturan:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/*.schema.json`

## 1. Purpose

Orchestrator Agent mengoordinasikan skill dan workflow berdasarkan `JobRecord`, kontrak data, dan policy decision. Ia mengatur urutan kerja, meminta approval, mengembalikan progress, serta berhenti jika ada hard rule, schema failure, atau deterministic gate yang tidak lulus.

Orchestrator **bukan pemilik keputusan enforcement**. Ia tidak boleh mengarang eligibility, mengubah quota, melewati age gate, mengklaim publish sukses, atau menjalankan adapter tanpa keputusan deterministic service.

## 2. Trigger

- Telegram command yang sudah lolos allowlist.
- Scheduler membuat job produksi.
- Job-state memberi transition result.
- Skill mengembalikan output valid.
- Skill mengembalikan error retryable/final.
- User mengirim cancellation, batch approval, rejection, atau emergency stop.
- Recovery worker menemukan job yang stale.

## 3. Input contract

Orchestrator menerima:

- `JobRecord` valid atau request pembuatan job;
- current state dan correlation ID;
- skill result terstruktur;
- deterministic policy result;
- user approval/rejection event;
- adapter result jika F5 telah dibuka;
- emergency stop status;
- system health signal.

Orchestrator tidak menerima raw secret, cookie, physical path arbitrary, atau credential plaintext.

## 4. Output contract

Setiap keputusan menghasilkan envelope:

```json
{
  "decision": "RUN_SKILL",
  "job_id": "uuid",
  "current_status": "GENERATING_IDEATION",
  "next_skill": "content-ideation",
  "input_ref": "job://uuid",
  "requires_approval": false,
  "reason_codes": [],
  "correlation_id": "uuid"
}
```

Decision yang sah:

- `RUN_SKILL`;
- `WAIT`;
- `NEED_APPROVAL`;
- `HOLD`;
- `RETRY`;
- `FAIL_FINAL`;
- `CANCEL`;
- `STOPPED`;
- `DELIVER`.

Orchestrator tidak mengembalikan `PUBLISH` langsung sebagai keputusan bebas. Publishing hanya berjalan setelah policy engine mengembalikan allow dan adapter preflight lulus.

## 5. Routing table MVP

| Current state | Next skill | Syarat |
|---|---|---|
| `RECEIVED` | `job-state` → `VALIDATING` | Job schema, allowlist, ownership, idempotency lulus. |
| `VALIDATING` | `theme-processor` | Input tema valid, content profile tersedia. |
| `GENERATING_IDEATION` | `content-ideation` | Theme normalized tersedia. |
| `SOURCING_MEDIA` | `media-sourcing` | Ideation dan keywords valid. |
| `GENERATING_CAPTION` | `caption-writer` | Content package partial valid. |
| `GENERATING_TTS` | `tts` | Script/narration valid. |
| `COMPOSING_VIDEO` | `video-composer` | Media dan voiceover valid. |
| `VALIDATING_ARTIFACT` | `content-qc` | Artifact URI dan metadata tersedia. |
| `DELIVERING` | `telegram-delivery` | QC passed dan ownership valid. |
| `COMPLETED` | none | Terminal state. |

## 6. Routing produk final

Publishing route hanya dapat digunakan setelah F5 dibuka secara eksplisit dan acceptance criteria terkait lulus.

```text
READY_FOR_PUBLISH
    ↓
account-manager
    ↓
policy-engine: age gate + mode + policy
    ├── MANUAL → telegram-delivery
    ├── SEMI_AUTO → batch-builder → batch-approval → adapter-preflight
    └── FULL_AUTO → policy-preflight → adapter-preflight
    ↓
adapter-publish per platform
    ↓
publish-result-verifier
    ↓
job-state / audit / notification
```

MVP harus mengarahkan semua output ke Manual delivery. `/mode semi` dan `/mode full` menghasilkan `HOLD` atau `DENY` pada MVP.

## 7. Orchestration loop

1. Baca JobRecord dari PostgreSQL.
2. Verifikasi correlation ID dan ownership context.
3. Periksa emergency stop dan system health.
4. Validasi current state dan contract version.
5. Minta job-state transition ke state skill berikutnya.
6. Jalankan satu skill terisolasi dengan input contract.
7. Validasi skill output terhadap schema/contract.
8. Simpan artifact/reference dan audit result.
9. Klasifikasikan error deterministic.
10. Pilih `RUN_SKILL`, `RETRY`, `WAIT`, `NEED_APPROVAL`, `HOLD`, `FAIL_FINAL`, atau `CANCEL`.
11. Kirim progress yang aman kepada user.
12. Jangan melanjutkan jika state transition gagal.

Orchestrator tidak boleh menjalankan banyak side effect yang tidak terkoordinasi dalam satu langkah. Setiap side effect harus memiliki checkpoint dan idempotency key.

## 8. Rules untuk LLM reasoning

LLM boleh:

- menjelaskan tema;
- memilih atau menyarankan angle dari options yang diberikan;
- menyusun ideation;
- menulis caption draft;
- merangkum error;
- menyusun preview batch.

LLM tidak boleh menjadi sumber final untuk:

- ownership;
- age gate;
- quota atau interval;
- policy expiry;
- emergency stop;
- permission/session health;
- idempotency;
- schema validity;
- remote publish success;
- license verification.

Jika LLM mengembalikan format tidak valid, Orchestrator tidak boleh memperbaiki secara diam-diam dengan asumsi baru. Ia harus meminta structured retry, memakai fallback deterministik, atau menghasilkan `HOLD`.

## 9. Approval handling

### 9.1 Semi-Auto

- Minta approval setelah batch preview lengkap.
- Pastikan approval berasal dari owner yang benar.
- Verifikasi batch hash dan expiry.
- Jika package, target platform, policy, atau schedule berubah, batalkan approval.
- Setelah approved, jalankan preflight ulang sebelum upload.

### 9.2 Full-Auto

- Tidak meminta approval per posting.
- Wajib menemukan policy profile yang aktif dan confirmed.
- Jalankan preflight sebelum batch/publish.
- Jika policy tidak lengkap atau expired, `HOLD` dan notify user.

## 10. Error handling

| Kondisi | Decision |
|---|---|
| Skill timeout sementara | `RETRY` jika bounded dan idempotent. |
| Provider 5xx | `RETRY` melalui backoff. |
| Schema output invalid | `RETRY` terstruktur satu/terbatas kali; lalu `FAIL_FINAL`. |
| Ownership gagal | `FAIL_FINAL`/security deny; jangan bocorkan detail. |
| Policy tidak lengkap | `HOLD` atau `NEED_APPROVAL`. |
| Age gate gagal | `DENY` mode otomatis; Manual boleh tetap berjalan. |
| Session expired | `WAIT` untuk user action; jangan retry membabi buta. |
| Adapter unsupported | `HOLD` atau `FAIL_FINAL` per platform. |
| Emergency stop aktif | `STOPPED`; tidak membuat batch baru. |
| Database unavailable | `WAIT`/retry queue; jangan menganggap write sukses. |

## 11. Security and side effects

Orchestrator:

- boleh membaca metadata dan references yang diizinkan;
- boleh membuat routing/audit decisions;
- boleh meminta skill dan notification;
- tidak boleh membaca secret plaintext;
- tidak boleh mengirim token ke LLM;
- tidak boleh menerima physical path user sebagai tool argument tanpa resolver terverifikasi;
- tidak boleh publish tanpa policy/adapter result;
- tidak boleh menghapus audit record;
- tidak boleh mengubah policy tanpa ownership dan confirmation yang diperlukan.

## 12. Quality gates sebelum lanjut

Sebelum memanggil skill berikutnya, Orchestrator memeriksa:

1. output JSON/contract valid;
2. referenced artifact exists dan ownership valid;
3. state transition berhasil di database;
4. current attempt masih dalam batas;
5. no active cancellation/emergency stop;
6. no hard rule violation;
7. required audit event tersimpan;
8. secret redaction lulus;
9. content package version konsisten;
10. policy decision tersedia bila route publishing.

## 13. Handoff contract

Orchestrator menyerahkan kepada skill:

- `job_id` dan correlation ID;
- input reference logical, bukan physical arbitrary path;
- expected state;
- schema/contract version;
- bounded timeout;
- allowed side effects;
- cancellation signal;
- relevant policy result tanpa secret.

Skill mengembalikan:

- `ok`;
- output reference atau structured output;
- next state suggestion yang tetap divalidasi job-state;
- error classification;
- metrics/audit metadata;
- warnings.

## 14. Testing requirements

- routing test untuk semua state normal;
- invalid transition test;
- duplicate Telegram update test;
- stale worker recovery test;
- cancellation dan emergency stop test;
- malformed LLM output test;
- policy deny test untuk umur <31 dan <90 hari;
- batch approval expiry test;
- package hash change invalidates approval test;
- platform partial failure test;
- adapter success/result verification test;
- secret redaction test;
- database outage test;
- no-publish MVP test.

## 15. Handoff ke modul lain

- `job-state` untuk semua transition;
- `theme-processor`, `content-ideation`, `media-sourcing`, `caption-writer`, `tts`, `video-composer`, dan `content-qc` untuk creation;
- `telegram-delivery` untuk Manual delivery;
- `policy-engine`, `batch-builder`, dan `batch-approval` untuk publisher final;
- `tiktok-adapter`, `instagram-adapter`, dan `facebook-adapter` hanya setelah F5 go/no-go;
- `publish-result-verifier` untuk hasil platform;
- `observability` dan `audit-logger` pada setiap boundary.
