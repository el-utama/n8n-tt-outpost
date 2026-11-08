# DATABASE DESIGN — n8n-tt-outpost

**Status:** Draft desain PostgreSQL; belum dibuat runtime  
**Versi:** 1.0.0-draft  
**Timezone bisnis:** `Asia/Jakarta`  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/*.schema.json`

## 1. Tujuan

Database menjadi sumber kebenaran untuk identity, JobRecord, state transition, content package metadata, artifacts, queue leases, policy profiles, approvals, publish intents/results, audit events, dan observability counters.

Binary artifacts dapat berada pada managed local storage atau object storage. PostgreSQL menyimpan metadata, ownership, hash, URI logical, retention, dan status. Physical path tidak pernah menjadi API user.

## 2. Database principles

- PostgreSQL sejak F1.
- Semua user-owned records memiliki `user_id` atau owner reference.
- Semua timestamps disimpan sebagai `timestamptz`; tampilan bisnis memakai `Asia/Jakarta`.
- State transition menggunakan transaction dan optimistic version/row lock.
- Idempotency keys memiliki unique index pada scope yang tepat.
- Secret/session material tidak disimpan plaintext di database biasa.
- JSONB dipakai untuk provider-specific metadata yang memang tidak stabil, tetapi core state tetap typed.
- Soft delete/tombstone dipakai untuk audit-critical records.
- Foreign keys mencegah orphan job/package/artifact.

## 3. Logical entities

```text
users
  ├── accounts
  │     └── account_age_snapshots
  ├── jobs
  │     ├── job_state_events
  │     ├── content_packages
  │     │     ├── content_package_versions
  │     │     ├── content_assets
  │     │     ├── artifacts
  │     │     └── quality_checks
  │     └── publish_intents
  │           ├── batch_approvals
  │           ├── platform_payloads
  │           └── publish_results
  ├── policy_profiles
  └── audit_events

queue_leases and idempotency_keys support the operational layer.
```

## 4. Tables

### 4.1 `users`

| Column | Type | Constraint |
|---|---|---|
| `user_id` | text | PK; trusted Telegram identity mapping |
| `telegram_chat_id` | text | UNIQUE |
| `status` | text | `ACTIVE`, `SUSPENDED`, `REVOKED` |
| `allowlisted_at` | timestamptz | nullable |
| `created_at` | timestamptz | required |
| `updated_at` | timestamptz | required |

Do not store bot token or raw credentials here.

### 4.2 `accounts`

| Column | Type | Constraint |
|---|---|---|
| `account_id` | uuid | PK |
| `user_id` | text | FK users |
| `platform` | text | `tiktok`, `instagram`, `facebook` |
| `account_handle` | text | user-provided metadata, not proof of ownership |
| `account_metadata` | jsonb | platform-neutral metadata |
| `ownership_status` | text | `UNVERIFIED`, `VERIFIED`, `REVOKED` |
| `tiktok_created_at` | timestamptz | nullable; only gate input |
| `age_verification_status` | text | `UNVERIFIED`, `VERIFIED`, `EXPIRED` |
| `session_reference` | text | secret manager reference only |
| `status` | text | `ACTIVE`, `DISABLED` |
| `created_at`/`updated_at` | timestamptz | required |

Index `(user_id, platform, account_handle)` should prevent accidental duplicates. Session secrets do not belong in `account_metadata`.

### 4.3 `jobs`

Maps to `contracts/job.schema.json`.

| Column | Type | Constraint |
|---|---|---|
| `job_id` | uuid | PK |
| `user_id` | text | FK users |
| `account_id` | uuid | nullable FK accounts |
| `correlation_id` | text | indexed |
| `theme_raw` | text | length bounded |
| `theme_normalized` | text | nullable |
| `content_profile` | jsonb | validated snapshot/input |
| `status` | text | state enum |
| `current_step` | text | required |
| `attempt` | integer | >=1 |
| `max_attempts` | integer | bounded |
| `idempotency_key` | text | unique per intake scope |
| `feature_stage` | text | `MVP_MANUAL`, `F4_SCHEDULER`, `F5_PUBLISHER` |
| `policy_decision` | text | nullable enum |
| `content_package_id` | uuid | nullable FK package |
| `publish_intent_id` | uuid | nullable FK intent |
| `error` | jsonb | safe structured error |
| `created_by` | text | enum |
| `timezone` | text | default `Asia/Jakarta` |
| `created_at`/`updated_at` | timestamptz | required |
| `completed_at`/`cancel_requested_at` | timestamptz | nullable |
| `retention_until` | timestamptz | nullable |
| `row_version` | bigint | optimistic concurrency |

Indexes: `(user_id, created_at desc)`, `(status, updated_at)`, unique `(user_id, idempotency_key)`.

### 4.4 `job_state_events`

Immutable audit of transitions.

| Column | Type | Constraint |
|---|---|---|
| `event_id` | uuid | PK |
| `job_id` | uuid | FK jobs |
| `previous_status` | text | nullable for creation |
| `next_status` | text | required |
| `step` | text | required |
| `actor_type`/`actor_id` | text | required |
| `attempt` | integer | required |
| `idempotency_key` | text | required |
| `metadata` | jsonb | no secrets |
| `created_at` | timestamptz | required |

### 4.5 `content_packages`

Current package identity and status.

| Column | Type | Constraint |
|---|---|---|
| `content_package_id` | uuid | PK |
| `job_id` | uuid | UNIQUE FK jobs |
| `schema_version` | text | required |
| `language` | text | required |
| `content_status` | text | package enum |
| `content_profile_snapshot` | jsonb | immutable snapshot |
| `unverified_notice` | text | nullable |
| `current_version` | integer | >=1 |
| `created_at`/`updated_at` | timestamptz | required |
| `retention_until` | timestamptz | nullable |

### 4.6 `content_package_versions`

Immutable versioned JSON package.

| Column | Type | Constraint |
|---|---|---|
| `package_version_id` | uuid | PK |
| `content_package_id` | uuid | FK |
| `version` | integer | unique per package |
| `package_json` | jsonb | validated against schema |
| `package_hash` | text | SHA-256 of canonical JSON |
| `created_by` | text | skill/user/system |
| `created_at` | timestamptz | required |

Approval and publish intent reference a specific version/hash.

### 4.7 `content_assets`

| Column | Type | Constraint |
|---|---|---|
| `asset_id` | uuid | PK |
| `content_package_id` | uuid | FK |
| `asset_uri` | text | unique logical URI |
| `media_type` | text | image/video/audio |
| `sha256` | text | required |
| `source_json` | jsonb | provider/terms/author metadata |
| `width`/`height` | integer | nullable |
| `duration_sec` | numeric | nullable |
| `created_at` | timestamptz | required |

### 4.8 `artifacts`

| Column | Type | Constraint |
|---|---|---|
| `artifact_id` | uuid | PK |
| `owner_user_id` | text | FK users |
| `job_id` | uuid | FK jobs |
| `content_package_id` | uuid | nullable FK |
| `artifact_uri` | text | UNIQUE |
| `storage_reference` | text | internal reference; never user-facing |
| `artifact_type` | text | video/audio/image/manifest/etc. |
| `mime_type` | text | required |
| `sha256` | text | required |
| `size_bytes` | bigint | >=0 |
| `width`/`height` | integer | nullable |
| `duration_sec` | numeric | nullable |
| `status` | text | `ACTIVE`, `DELIVERED`, `QUARANTINED`, `RETENTION_EXPIRED`, `CLEANUP_PENDING`, `DELETED` |
| `retention_class` | text | configured enum |
| `retention_until` | timestamptz | required |
| `created_at`/`updated_at` | timestamptz | required |

Never expose `storage_reference` to Telegram or LLM.

### 4.9 `quality_checks`

| Column | Type | Constraint |
|---|---|---|
| `quality_check_id` | uuid | PK |
| `content_package_id` | uuid | FK |
| `package_version` | integer | required |
| `check_id` | text | e.g. `SCHEMA`, `VIDEO_PLAYABLE` |
| `status` | text | `PASSED`, `FAILED`, `WARNING` |
| `message_safe` | text | redacted |
| `checked_at` | timestamptz | required |

### 4.10 `policy_profiles`

Maps to `contracts/policy-profile.schema.json`.

| Column | Type | Constraint |
|---|---|---|
| `policy_profile_id` | uuid | PK |
| `user_id` | text | FK users |
| `mode` | text | `SEMI_AUTO`, `FULL_AUTO` |
| `version` | integer | incrementing |
| `policy_json` | jsonb | schema validated |
| `confirmed_at` | timestamptz | nullable |
| `status` | text | `DRAFT`, `ACTIVE`, `EXPIRED`, `DISABLED` |
| `created_at`/`updated_at` | timestamptz | required |

Unique active policy per user/mode may be enforced with partial index.

### 4.11 `publish_intents`

Maps to `contracts/publish-intent.schema.json`.

| Column | Type | Constraint |
|---|---|---|
| `publish_intent_id` | uuid | PK |
| `job_id` | uuid | FK jobs |
| `content_package_id` | uuid | FK package |
| `package_version` | integer | required |
| `package_hash` | text | required |
| `user_id`/`account_id` | text/uuid | ownership |
| `mode` | text | Manual/Semi/Full |
| `policy_profile_id` | uuid | nullable FK |
| `batch_id`/`approval_id` | uuid | nullable |
| `platforms` | text[] | target list |
| `intended_schedule` | timestamptz | nullable |
| `idempotency_key` | text | unique |
| `status` | text | intent enum |
| `platform_status` | jsonb | per-platform status |
| `created_at`/`updated_at` | timestamptz | required |

### 4.12 `batch_approvals`

| Column | Type | Constraint |
|---|---|---|
| `approval_id` | uuid | PK |
| `batch_id` | uuid | unique/current batch |
| `user_id` | text | FK users |
| `package_ids` | uuid[] | frozen items |
| `package_hashes` | jsonb | item/version hashes |
| `policy_profile_version` | integer | snapshot |
| `platforms` | text[] | target |
| `preview_json` | jsonb | safe preview |
| `batch_hash` | text | required |
| `status` | text | `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `EXPIRED`, `INVALIDATED` |
| `expires_at` | timestamptz | required |
| `approved_at` | timestamptz | nullable |
| `created_at` | timestamptz | required |

### 4.13 `platform_payloads`

| Column | Type | Constraint |
|---|---|---|
| `payload_id` | uuid | PK |
| `publish_intent_id` | uuid | FK |
| `platform` | text | enum |
| `adapter_version` | text | required |
| `payload_json` | jsonb | schema validated; redact sensitive fields |
| `payload_hash` | text | required |
| `idempotency_key` | text | unique per platform intent |
| `status` | text | `DRAFT`, `VALIDATED`, `REJECTED`, `SUBMITTED` |
| `created_at` | timestamptz | required |

### 4.14 `publish_results`

| Column | Type | Constraint |
|---|---|---|
| `publish_result_id` | uuid | PK |
| `publish_intent_id` | uuid | FK |
| `platform` | text | enum |
| `status` | text | result enum |
| `remote_post_id` | text | nullable |
| `remote_url` | text | nullable |
| `idempotency_key` | text | required |
| `adapter_version` | text | required |
| `attempt` | integer | required |
| `error_json` | jsonb | safe normalized error |
| `verified_at` | timestamptz | nullable |
| `created_at` | timestamptz | required |

Unique `(publish_intent_id, platform, idempotency_key)` prevents duplicate result rows.

### 4.15 `queue_leases`

| Column | Type | Constraint |
|---|---|---|
| `lease_id` | uuid | PK |
| `job_id` | uuid | UNIQUE active lease |
| `worker_id` | text | required |
| `leased_at` | timestamptz | required |
| `lease_until` | timestamptz | required |
| `attempt` | integer | required |
| `status` | text | `ACTIVE`, `RELEASED`, `EXPIRED` |

### 4.16 `idempotency_keys`

| Column | Type | Constraint |
|---|---|---|
| `scope` | text | e.g. `telegram_update`, `job_step`, `publish_platform` |
| `key` | text | composite PK |
| `request_hash` | text | required |
| `response_ref` | text | nullable logical ref |
| `created_at` | timestamptz | required |
| `expires_at` | timestamptz | required/configured |

### 4.17 `audit_events`

Immutable security and business audit record.

| Column | Type | Constraint |
|---|---|---|
| `audit_event_id` | uuid | PK |
| `user_id` | text | nullable |
| `job_id` | uuid | nullable |
| `correlation_id` | text | indexed |
| `event_type` | text | required |
| `actor_type`/`actor_id` | text | required |
| `entity_type`/`entity_id` | text | required |
| `reason_codes` | text[] | required |
| `metadata_safe` | jsonb | redacted |
| `created_at` | timestamptz | required |

## 5. State and transaction rules

### Job transition

Use a transaction:

1. Select job row with lock or compare `row_version`.
2. Verify expected status and idempotency.
3. Update status/current step/attempt/version.
4. Insert `job_state_events`.
5. Commit.

### Queue lease

Select eligible rows with row lock/skip locked semantics, create/update lease, then execute with lease heartbeat. Expired leases must be recoverable and cannot imply successful execution.

### Publish intent

Create intent and per-platform idempotency records before any external side effect. Adapter result is committed independently per platform.

## 6. Indexes and constraints

Minimum indexes:

- jobs `(status, updated_at)`;
- jobs `(user_id, created_at desc)`;
- artifacts `(owner_user_id, status, retention_until)`;
- queue leases `(status, lease_until)`;
- audit events `(correlation_id, created_at)`;
- publish intents `(status, intended_schedule)`;
- publish results `(publish_intent_id, platform)`.

Minimum constraints:

- foreign keys for ownership and package relations;
- unique logical artifact URI;
- unique idempotency scope/key;
- nonnegative attempts/quota/size;
- controlled enum/status values;
- no active artifact cleanup while dependency exists.

## 7. Backup and retention

- PostgreSQL backup harus diuji restore, bukan hanya dibuat.
- Audit events dan tombstones mengikuti retention compliance yang ditetapkan.
- Artifact bytes memiliki retention class berbeda dari metadata.
- Cleanup job harus idempotent dan memiliki backlog metric.
- Restore harus mempertahankan package hash, artifact URI, ownership, policy, intent, dan result relationships.

## 8. Migration sequence

1. Create extensions/roles without application secrets in migration files.
2. Create users/accounts.
3. Create jobs/state/idempotency/queue.
4. Create packages/versions/assets/artifacts/QC.
5. Create policy/approval/publish tables.
6. Add indexes and constraints.
7. Seed only non-secret configuration and feature flags.
8. Run schema validation fixtures.
9. Run transaction, ownership, replay, recovery, and restore tests.

No migration should enable F5 publisher by default.
