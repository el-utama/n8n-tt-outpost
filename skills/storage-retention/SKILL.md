---
name: storage-retention
description: Manage logical artifact storage, ownership, hashes, retention windows, quotas, secure expiring links, cleanup, and recovery for n8n-tt-outpost. Use whenever content artifacts or temporary media are created, delivered, expired, restored, or deleted.
---

# Skill — Storage and Retention

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Mengelola artifact dan asset melalui logical URI, bukan physical path user. Skill ini menjaga ownership, integrity, retention, quota, secure delivery, cleanup, dan recovery metadata.

## Logical references

Gunakan:

- `artifact://<artifact_id>` untuk output seperti video, audio, manifest, caption, dan thumbnail;
- `asset://<asset_id>` untuk source media atau reusable asset.

Physical storage path bersifat deployment-specific, tidak keluar ke user, dan tidak boleh berasal dari input Telegram atau prompt LLM.

## Inputs

- artifact/asset bytes dari managed media service;
- `user_id`, `job_id`, `content_package_id`;
- artifact type, MIME, dimensions, duration, size;
- SHA-256;
- retention class dan expiry;
- ownership context;
- download request atau cleanup request;
- quota configuration.

## Artifact record

```json
{
  "artifact_id": "uuid",
  "artifact_uri": "artifact://video/uuid",
  "owner_user_id": "user-id",
  "job_id": "uuid",
  "content_package_id": "uuid",
  "artifact_type": "video",
  "mime_type": "video/mp4",
  "sha256": "64-hex",
  "size_bytes": 12345678,
  "created_at": "2026-11-08T04:00:00Z",
  "retention_until": "2026-11-15T04:00:00Z",
  "status": "ACTIVE"
}
```

## Lifecycle

```text
CREATED → ACTIVE → DELIVERED
ACTIVE → RETENTION_EXPIRED → CLEANUP_PENDING → DELETED
ACTIVE → QUARANTINED
ACTIVE → RESTORE_PENDING → ACTIVE
```

Artifact yang masih direferensikan job aktif, approval aktif, atau publish intent aktif tidak boleh dihapus tanpa dependency resolution.

## Procedure: create/register

1. Validate owner, job, and package context.
2. Validate MIME, size, type, and managed source.
3. Compute or verify SHA-256.
4. Create logical URI and immutable artifact record.
5. Set retention class and `retention_until`.
6. Store metadata in PostgreSQL and bytes in configured storage.
7. Return URI; never return physical path.

## Procedure: secure download

1. Resolve logical URI.
2. Check ownership and authorization.
3. Check status and retention expiry.
4. Create expiring link or controlled Telegram delivery.
5. Record download audit event.
6. Do not expose storage path, bucket key, or permanent public URL.

## Procedure: cleanup

1. Find artifacts past retention and not referenced by active dependency.
2. Mark `CLEANUP_PENDING` transactionally.
3. Delete bytes through managed storage service.
4. Retain minimal audit/tombstone metadata if required.
5. Verify deletion and record result.
6. Retry transient cleanup failures boundedly.

Cleanup must not delete source/license metadata needed for audit before the approved audit-retention period.

## Retention classes

Retention values are configuration, not hard-coded claims. Minimum classes:

| Class | Use |
|---|---|
| `TEMPORARY` | Intermediate TTS/video files; short retention after job terminal. |
| `DELIVERY` | User-facing artifact after Telegram delivery. |
| `PUBLISHED_REFERENCE` | Artifact referenced by publish result/audit. |
| `SOURCE_ASSET` | Reusable sourced media with license metadata. |
| `AUDIT_TOMBSTONE` | Minimal record after bytes are deleted. |

Actual duration must be set by policy and storage budget; do not promise “ratusan video” without calculation.

## Quota and storage policy

Track at least:

- bytes per user;
- bytes per job;
- total storage;
- temporary bytes;
- upload/download bandwidth estimate;
- cleanup backlog;
- backup footprint.

If quota is reached, new artifact creation becomes `HOLD` or `ERR_STORAGE_QUOTA`; cleanup must not bypass active ownership or retention.

## Hard rules

- Never accept arbitrary physical path from user.
- Never give one user another user’s artifact.
- Never change bytes without updating hash/version.
- Never create public non-expiring links by default.
- Never delete active, approved, published-reference, or legally/audit-required artifacts.
- Never log tokens, signed URLs, bucket keys, or private paths.
- Quarantine hash mismatch, MIME mismatch, or suspicious artifact.

## Failure modes

| Code | Action |
|---|---|
| `ERR_ARTIFACT_NOT_FOUND` | Safe not-found response. |
| `ERR_ARTIFACT_OWNERSHIP` | Deny and audit. |
| `ERR_HASH_MISMATCH` | Quarantine; security audit. |
| `ERR_STORAGE_QUOTA` | Hold creation and notify. |
| `ERR_RETENTION_DEPENDENCY` | Delay cleanup until dependency resolved. |
| `ERR_LINK_EXPIRED` | Require new authorized link. |
| `ERR_CLEANUP_TRANSIENT` | Bounded retry and backlog metric. |
| `ERR_STORAGE_UNAVAILABLE` | Hold; never claim write success. |

## Side effects

- Read/write managed bytes and artifact metadata.
- Create expiring links.
- Mark artifacts and cleanup state.
- Write audit and quota metrics.
- Tidak publish platform dan tidak mengambil arbitrary URL.

## Quality checks

- URI pattern valid.
- Ownership check passes.
- Hash matches bytes.
- MIME/size/type consistent.
- Retention and dependencies evaluated.
- Download links expire.
- Cleanup is idempotent.
- Backup/restore retains metadata and integrity.
