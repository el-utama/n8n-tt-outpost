---
name: job-state
description: Deterministic JobRecord lifecycle management for n8n-tt-outpost. Use for valid state transitions, idempotency, retries, cancellation, concurrency control, PostgreSQL persistence, recovery, and job audit events.
---

# SKILL — Job State Manager

**Status:** Draft  
**Versi:** 1.0.0-draft  
**Owner:** Orchestrator / deterministic state service  
**Sumber aturan:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/job.schema.json`

## 1. Purpose

Mengelola lifecycle `JobRecord` secara deterministik dan atomik. Skill ini memastikan job hanya bergerak melalui state yang sah, retry tidak menggandakan pekerjaan, cancellation dapat diproses, dan setiap perubahan dapat diaudit.

Skill ini **bukan LLM reasoning skill**. Keputusan transition, attempt, idempotency, dan persistence harus dilakukan oleh kode/service deterministik.

## 2. Triggers

Skill dipanggil ketika:

- job baru dibuat dari Telegram atau scheduler;
- Orchestrator menyelesaikan satu step;
- sebuah step menghasilkan error;
- user meminta cancellation;
- worker melakukan recovery setelah restart;
- operator melakukan retry/requeue yang berwenang.

## 3. Inputs

### 3.1 Transition request

```json
{
  "job_id": "uuid",
  "expected_status": "VALIDATING",
  "next_status": "GENERATING_IDEATION",
  "step": "theme-processor",
  "actor_type": "skill",
  "actor_id": "theme-processor-v1",
  "attempt": 1,
  "idempotency_key": "job-uuid:theme-processor:1",
  "metadata": {}
}
```

### 3.2 Error request

```json
{
  "job_id": "uuid",
  "expected_status": "GENERATING_TTS",
  "error": {
    "code": "ERR_TTS_CONNECTIVITY",
    "message": "TTS provider tidak tersedia.",
    "step": "tts",
    "retryable": true,
    "occurred_at": "2026-11-08T02:00:00Z"
  }
}
```

### 3.3 Cancellation request

```json
{
  "job_id": "uuid",
  "requested_by": "telegram_user",
  "user_id": "telegram-chat-id",
  "reason": "User meminta pembatalan"
}
```

## 4. Outputs

### 4.1 Successful transition

```json
{
  "ok": true,
  "job_id": "uuid",
  "previous_status": "VALIDATING",
  "current_status": "GENERATING_IDEATION",
  "attempt": 1,
  "transition_id": "uuid",
  "updated_at": "2026-11-08T02:00:00Z"
}
```

### 4.2 Rejected transition

```json
{
  "ok": false,
  "decision": "REJECTED",
  "code": "ERR_INVALID_STATE_TRANSITION",
  "message": "Transition tidak diizinkan dari state saat ini.",
  "retryable": false
}
```

## 5. State transition contract

State normal:

```text
RECEIVED → VALIDATING
VALIDATING → GENERATING_IDEATION
GENERATING_IDEATION → SOURCING_MEDIA
SOURCING_MEDIA → GENERATING_CAPTION
GENERATING_CAPTION → GENERATING_TTS
GENERATING_TTS → COMPOSING_VIDEO
COMPOSING_VIDEO → VALIDATING_ARTIFACT
VALIDATING_ARTIFACT → DELIVERING
DELIVERING → COMPLETED
```

Failure/cancellation:

```text
ANY_NON_FINAL_STATE → FAILED_RETRYABLE
ANY_NON_FINAL_STATE → FAILED_FINAL
ANY_NON_FINAL_STATE → CANCEL_REQUESTED → CANCELLED
```

Guardrails:

- `COMPLETED`, `FAILED_FINAL`, dan `CANCELLED` adalah terminal state.
- Transition harus memakai optimistic concurrency atau row lock.
- `expected_status` wajib dicocokkan dengan status database.
- Dua worker tidak boleh berhasil melakukan transition yang sama.
- Direct transition ke publishing tidak diperbolehkan oleh skill ini.
- State job tidak boleh diubah hanya dengan menerima klaim dari LLM.

## 6. Preconditions

Sebelum transition:

1. Job ada dan user/actor memiliki permission.
2. Job valid terhadap schema.
3. `expected_status` sama dengan status database.
4. `idempotency_key` belum digunakan untuk transition yang berbeda.
5. `next_status` termasuk transition map.
6. Attempt berada dalam batas.
7. Cancellation/emergency stop tidak memblokir action.

## 7. Retry policy

- Error `retryable=true` dapat diarahkan ke `FAILED_RETRYABLE`.
- Jika `attempt >= max_attempts`, ubah ke `FAILED_FINAL`.
- Retry harus membuat transition/audit event baru.
- Backoff ditentukan oleh queue policy, bukan LLM.
- Retry tidak boleh mengulang side effect yang sudah sukses tanpa idempotency check.
- Error schema invalid, ownership failure, policy denial, dan unsupported media default-nya `FAILED_FINAL` atau `HOLD`, bukan retry.

## 8. Cancellation policy

- Cancellation harus ownership-checked.
- Job aktif masuk ke `CANCEL_REQUESTED`.
- Worker memeriksa cancellation checkpoint sebelum side effect berikutnya.
- Setelah side effect yang dapat dihentikan selesai atau dibatalkan, job menjadi `CANCELLED`.
- Cancellation tidak boleh menghapus audit event.
- Artifact sementara dibersihkan sesuai retention/cleanup policy.
- Cancellation tidak otomatis membatalkan publish remote yang sudah confirmed; gunakan recovery/publish control terpisah.

## 9. Persistence dan audit

Setiap transition menyimpan:

- job ID;
- previous/current status;
- current step;
- actor type dan actor ID;
- attempt;
- idempotency key;
- timestamp `Asia/Jakarta` untuk tampilan dan UTC storage bila dipakai;
- error code bila ada;
- correlation/request ID.

Secret dan stack trace sensitif tidak boleh disimpan pada audit event.

## 10. Failure modes

| Code | Kategori | Tindakan |
|---|---|---|
| `ERR_JOB_NOT_FOUND` | Final | Tolak request dan audit. |
| `ERR_UNAUTHORIZED_JOB_ACCESS` | Final/security | Tolak tanpa membocorkan existence lebih dari perlu. |
| `ERR_INVALID_STATE_TRANSITION` | Final | Minta Orchestrator membaca ulang state. |
| `ERR_STATE_CONFLICT` | Retryable | Baca ulang state lalu retry bounded. |
| `ERR_DUPLICATE_IDEMPOTENCY` | Safe no-op | Kembalikan hasil transition sebelumnya. |
| `ERR_ATTEMPT_LIMIT` | Final | Set `FAILED_FINAL`. |
| `ERR_CANCELLED` | Final | Set `CANCELLED` bila checkpoint memungkinkan. |
| `ERR_DATABASE_UNAVAILABLE` | Retryable | Queue recovery, jangan menganggap transition sukses. |

## 11. Side effects

- Read/write row JobRecord di PostgreSQL.
- Write transition/audit event.
- Set queue lease atau release lease bila dipanggil oleh worker.
- Tidak memanggil platform publisher.
- Tidak mengirim secret ke LLM.
- Tidak menghapus artifact final tanpa cleanup policy.

## 12. Quality checks

- Schema validation JobRecord lulus.
- Transition map test lulus untuk semua state.
- Concurrent transition test memastikan satu pemenang.
- Duplicate idempotency test lulus.
- Retry boundary test lulus.
- Cancellation checkpoint test lulus.
- Restart/recovery test membaca state dari PostgreSQL.
- Audit event tidak mengandung secret.

## 13. Handoff

Skill ini menyerahkan kontrol kembali ke Orchestrator dengan:

- state terbaru;
- transition result;
- error classification;
- next allowed action;
- correlation ID.

Job-state tidak memilih skill bisnis berikutnya. Orchestrator membaca `current_status` dan routing table.
