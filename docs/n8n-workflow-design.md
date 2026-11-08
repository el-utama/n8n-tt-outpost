# N8N WORKFLOW DESIGN — n8n-tt-outpost

**Status:** Draft desain; belum diimplementasikan  
**Versi:** 1.0.0-draft  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/*.schema.json`

## 1. Tujuan

Dokumen ini memetakan 12 skill awal, tiga adapter platform, JobRecord state machine, PostgreSQL queue, dan Telegram interface ke workflow n8n yang dapat diimplementasikan secara bertahap.

n8n menjadi orchestration boundary dan integration runner. Enforcement sensitif tetap berada di service deterministik atau transaction boundary, bukan pada prompt LLM dan bukan pada node AI yang bebas.

## 2. Workflow topology

```text
WF-00 Telegram Consumer
    ↓
WF-01 Command Router / Job Intake
    ↓
WF-02 Job Orchestrator
    ├── WF-10 Theme + Ideation
    ├── WF-11 Media Sourcing
    ├── WF-12 Caption
    ├── WF-13 TTS
    ├── WF-14 Video Composition
    ├── WF-15 Content QC
    ├── WF-20 Manual Delivery
    └── WF-30 Policy/Publisher (F5 only)

WF-40 Scheduler
    ↓
WF-41 Queue Worker / Recovery

WF-50 Retention Cleanup
WF-60 Observability / Alerts
```

Setiap Execute Workflow call membawa `job_id`, `correlation_id`, `expected_status`, `idempotency_key`, schema version, timeout, dan cancellation context.

## 3. Workflow inventory

### WF-00 — Telegram Update Consumer

**Trigger:** Telegram polling atau webhook yang disetujui kemudian.  
**Purpose:** menerima update, menjaga cursor, deduplicate, dan mengirim event internal.

Urutan node konseptual:

1. Trigger/HTTP Receive.
2. Normalize update.
3. Load Telegram cursor/lock.
4. Acquire single-consumer lock.
5. Allowlist check.
6. Deduplicate update ID.
7. Write inbound event.
8. Execute `telegram` command router.
9. Ack cursor setelah persistence berhasil.
10. Release lock.

Hard rule: update tidak boleh langsung memanggil publisher.

### WF-01 — Command Router / Job Intake

**Commands:** `/post`, `/status`, `/download`, `/batal`, `/account`, `/mode`, `/approve`, `/reject`, `/stop`.

Node konseptual:

1. Parse bounded command.
2. Resolve trusted Telegram user ID.
3. Ownership/allowlist check.
4. Idempotency lookup.
5. Route command.
6. For `/post`, create JobRecord with `RECEIVED`.
7. For status/download/cancel, call deterministic service.
8. Send safe acknowledgement.

MVP feature flag menolak `/mode semi`, `/mode full`, `/approve`, dan `/reject`.

### WF-02 — Job Orchestrator

**Trigger:** new job atau state transition.  
**Purpose:** menjalankan routing berdasarkan JobRecord.

Node konseptual:

1. Load JobRecord transactionally.
2. Check cancellation/emergency stop.
3. Validate schema and current state.
4. Determine next skill from routing table.
5. Execute Workflow subflow.
6. Validate output contract.
7. Transition state via Job State Manager.
8. Record audit/metrics.
9. Retry/hold/fail/notify sesuai classification.

Orchestrator tidak boleh menulis status `PUBLISHED` tanpa PublishResult verifier.

### WF-10 — Theme and Ideation

State: `VALIDATING` → `GENERATING_IDEATION`.

Skills: Theme Processor dan `content-ideation`.

Node konseptual:

1. Load theme and content profile.
2. Validate length and safety.
3. Normalize theme.
4. Call local LLM with structured output constraint.
5. Validate ideation fragment.
6. Persist package draft/version.
7. Transition to `SOURCING_MEDIA`.

LLM output adalah untrusted data dan harus divalidasi sebelum database write.

### WF-11 — Media Sourcing

State: `SOURCING_MEDIA`.

Skill: `media-sourcing`.

Node konseptual:

1. Load visual keywords.
2. Check provider availability and quota.
3. Request candidate assets through provider client.
4. Validate MIME/size.
5. Register artifact/asset through storage service.
6. Hash and store source/license metadata.
7. Deduplicate.
8. Persist package version.
9. Transition to `GENERATING_CAPTION`.

Provider credential hanya melalui n8n credential reference/secret manager.

### WF-12 — Caption

State: `GENERATING_CAPTION`.

Skill: `caption-writer`.

Node konseptual:

1. Load ideation and content profile snapshot.
2. Call local LLM for structured caption.
3. Validate caption/hashtag schema.
4. Add unverified notice if required.
5. Persist package version.
6. Transition to `GENERATING_TTS`.

### WF-13 — TTS

State: `GENERATING_TTS`.

Skill: `tts`.

Node konseptual:

1. Load narration.
2. Select approved engine/voice.
3. Generate audio via controlled service.
4. Probe audio.
5. Register artifact and hash.
6. Fallback on retryable provider failure.
7. Persist voiceover reference.
8. Transition to `COMPOSING_VIDEO`.

### WF-14 — Video Composition

State: `COMPOSING_VIDEO`.

Skill: `video-composer`.

Node konseptual:

1. Resolve asset/audio URIs.
2. Check capability profile.
3. Build deterministic composition plan.
4. Call controlled media service/FFmpeg runner.
5. Probe MP4, ratio, audio, duration, and dimensions.
6. Register final artifact.
7. Persist package version.
8. Transition to `VALIDATING_ARTIFACT`.

n8n tidak menerima shell command bebas dari LLM. Composition arguments berasal dari allowlisted config.

### WF-15 — Content QC

State: `VALIDATING_ARTIFACT`.

Skill: `content-qc`.

Node konseptual:

1. Validate ContentPackage schema.
2. Resolve artifact ownership.
3. Verify hashes and metadata.
4. Run media probes.
5. Check source/license metadata.
6. Run text/safety checks.
7. Set `QC_PASSED` or `REJECTED`.
8. If MVP, transition to `DELIVERING`; if F5 route enabled, create publish intent after policy gate.

### WF-20 — Manual Delivery

State: `DELIVERING`.

Skill: `telegram` + `storage-retention`.

Node konseptual:

1. Resolve owned package/artifacts.
2. Create expiring link or controlled file send.
3. Send video, caption, hashtags, source/license summary.
4. Audit delivery.
5. Transition job to `COMPLETED`.

### WF-30 — Policy and Publisher (F5 only)

**Feature flag:** disabled in MVP.

Subflows:

- WF-31 Account/age gate;
- WF-32 Policy preflight;
- WF-33 Batch builder;
- WF-34 Batch approval;
- WF-35 Platform payload builder;
- WF-36 TikTok publish;
- WF-37 Instagram publish;
- WF-38 Facebook publish;
- WF-39 Result verifier and reconciliation.

Each platform runs as an independent branch. A failure in one branch does not overwrite the status of another.

### WF-40 — Scheduler

**Trigger:** n8n Schedule Trigger using `Asia/Jakarta`.

Responsibilities:

- create production jobs;
- create publish intents only when F5 is enabled;
- honor active days/time windows;
- avoid duplicate schedules using idempotency;
- respect emergency stop and policy expiry.

### WF-41 — Queue Worker and Recovery

**Trigger:** interval/queue polling.

Node konseptual:

1. Acquire PostgreSQL lease.
2. Select eligible job using `FOR UPDATE SKIP LOCKED` equivalent.
3. Check stale/attempt/cancellation.
4. Execute WF-02.
5. Commit transition or release lease.
6. Move exhausted jobs to final failure/dead-letter.
7. Emit metrics.

### WF-50 — Retention Cleanup

**Trigger:** scheduled daily or configured interval.

Skill: `storage-retention`.

1. Find expired artifacts with no active dependency.
2. Mark cleanup pending.
3. Delete through managed storage service.
4. Keep required tombstone/audit metadata.
5. Retry transient cleanup failures.
6. Report backlog/quota.

### WF-60 — Observability and Alerts

**Trigger:** event/metric/error.

Track queue depth, stale jobs, step duration, provider errors, artifact quota, cleanup backlog, policy denials, approvals, publish results, and emergency stops.

## 4. n8n sub-workflow contract

Every Execute Workflow boundary must carry:

```json
{
  "job_id": "uuid",
  "correlation_id": "uuid",
  "expected_status": "GENERATING_TTS",
  "idempotency_key": "job:step:attempt",
  "schema_version": "1.0.0",
  "timeout_seconds": 300,
  "cancel_requested": false,
  "feature_stage": "MVP_MANUAL"
}
```

Sub-workflow output must include `ok`, output/reference, warnings, error classification, and next-state suggestion. Job-state remains the final authority for state transition.

## 5. Credential and secret boundary

- Telegram credentials use n8n credential reference.
- Provider/media keys use credential reference.
- Platform sessions use Secret/Session Manager only after F5 approval.
- No secret is passed through LLM nodes or stored in ordinary Set nodes.
- Execution data retention must redact or disable sensitive payload persistence where possible.

## 6. Error routing

- Retryable provider/network error → retry branch with bounded backoff.
- Schema/ownership/policy hard failure → final/hold branch.
- Approval needed → Telegram approval branch.
- Cancellation → job-state cancellation branch.
- Emergency stop → stop branch and no new publish branch.
- Partial platform failure → per-platform result reconciliation.

## 7. Implementation gates

1. Build and validate schemas before workflow creation.
2. Build PostgreSQL state/queue tables before sub-workflows.
3. Implement manual content-only flow first.
4. Test replay, restart, cancellation, ownership, retention, and QC.
5. Add F4 scheduler without publisher.
6. Add F5 adapters only after compliance/security review and test fixtures.
7. Enable platforms independently through feature flags.

No workflow should use a platform credential or publisher endpoint while the corresponding F5 flag is disabled.
