---
name: telegram
description: Secure Telegram interface for n8n-tt-outpost. Use for consuming updates, routing commands, checking allowlists and ownership, reporting job progress, delivering artifacts, processing Semi-Auto batch approvals, cancellation, and emergency-stop commands.
---

# Telegram Interface

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/job.schema.json`

## Purpose

Menyediakan interface Telegram yang aman untuk MVP Manual dan future approval/control flow tanpa menaruh secret di message, log, workflow export, atau prompt.

## Supported commands

| Command | MVP | Produk final |
|---|---|---|
| `/start` | Help dan scope Manual | Help sesuai mode enabled |
| `/post <tema>` | Buat content job | Buat job dan route policy |
| `/status [job_id]` | Status job milik user | Status job/publish milik user |
| `/download [artifact_id]` | Download artifact valid | Sama, plus result links |
| `/batal <job_id>` | Cancellation | Cancellation dengan publish control |
| `/account` | Metadata platform-neutral | Account metadata dan age status |
| `/mode manual` | Diterima | Diterima |
| `/mode semi` | Ditolak pada MVP | Diperiksa age gate dan F5 |
| `/mode full` | Ditolak pada MVP | Diperiksa age gate dan policy |
| `/approve <batch_id>` | Tidak aktif pada MVP | Approval per batch |
| `/reject <batch_id>` | Tidak aktif pada MVP | Reject batch |
| `/stop` | Emergency stop channel tersedia bila dikonfigurasi | Wajib untuk Full-Auto |

## Update consumer

1. Hanya satu consumer aktif atau gunakan distributed lock.
2. Simpan Telegram update/cursor ID secara persisten.
3. Verifikasi allowlist sebelum command routing.
4. Deduplicate update berdasarkan update ID dan idempotency key.
5. Ack/update cursor hanya setelah persistence yang diperlukan berhasil.
6. Gunakan bounded retry untuk Telegram API transient errors.
7. Jangan menaruh bot token di output, log, atau skill input.

## Security and ownership

- Allowlist chat/user ID.
- Resolve `user_id` dari trusted Telegram context, bukan dari text command.
- Setiap job/status/artifact/approval harus ownership-checked.
- Jangan menampilkan apakah job milik user lain ada.
- Jangan menerima physical path, shell command, SQL, credential, atau arbitrary callback URL.
- Callback button approval harus signed/opaque, expired, one-time, dan terikat pada user serta batch hash.

## Command routing

### `/post`

1. Parse bounded theme text.
2. Validate user/allowlist.
3. Check duplicate recent idempotency key.
4. Create JobRecord dengan `RECEIVED`.
5. Acknowledge job ID dan status awal.
6. Orchestrator melanjutkan lifecycle.

### `/status`

1. Resolve requested job ID atau last job user.
2. Ownership check.
3. Return safe current state, progress, warning, next action.
4. Redact internal paths, secrets, provider raw payload, dan stack traces.

### `/download`

1. Resolve logical artifact ID.
2. Ownership dan retention check.
3. Generate secure expiring link atau send file sesuai size/provider limits.
4. Audit delivery.
5. Jangan expose physical storage path.

### `/batal`

1. Ownership check.
2. Send cancellation request ke job-state.
3. Return `CANCEL_REQUESTED` atau final `CANCELLED`.
4. Jangan mengklaim remote post terhapus jika sudah published.

### `/approve` dan `/reject`

1. Hanya aktif setelah F5 dibuka.
2. Verify batch ownership, expiry, hash, policy version, dan current state.
3. Approval per batch, bukan per item.
4. Package/policy change invalidates approval.
5. Forward result ke Orchestrator dan audit.

### `/stop`

1. Verify user/operator authority.
2. Set emergency stop deterministically tanpa LLM.
3. Prevent new batches and cancellable queued work.
4. Notify impacted jobs.
5. Require preflight again before resume.

## Notifications

Status message minimum memuat:

- job ID singkat;
- state user-facing;
- progress/step;
- warning/action yang dibutuhkan;
- link artifact yang expired sesuai policy;
- partial platform results bila publishing aktif.

Jangan menampilkan:

- bot token, API key, cookie, authorization header;
- absolute physical path;
- raw provider response dengan secret;
- job/artifact milik user lain;
- klaim publish sukses tanpa verifier.

## Failure handling

| Error | Response |
|---|---|
| User not allowlisted | Generic access denied; no data disclosure. |
| Duplicate update | Return prior safe result/no-op. |
| Telegram transient failure | Bounded retry/backoff. |
| Job not found/unauthorized | Generic not available. |
| Artifact expired | Explain retention expired; do not expose path. |
| Approval expired | Ask for new batch preview/approval. |
| Emergency stop | Confirm stopped status and next action. |
| Session/2FA/CAPTCHA required | Request safe user action; no credential in chat logs. |

## Side effects

- Read/write Telegram cursor and idempotency state.
- Create command requests.
- Write notifications and audit events.
- Trigger job-state, orchestrator, approval, delivery, or emergency-stop services.
- Tidak login platform atau publish langsung.

## Quality checks

- command parser boundary tests;
- allowlist and ownership tests;
- duplicate update tests;
- cursor restart/recovery tests;
- callback expiry and one-time tests;
- secret redaction tests;
- artifact ownership/expiry tests;
- cancellation and emergency-stop tests;
- MVP rejects Semi-Auto/Full-Auto;
- notification never claims unverified publish success.
