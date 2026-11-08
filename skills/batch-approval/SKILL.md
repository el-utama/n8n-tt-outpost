---
name: batch-approval
description: Manage Semi-Auto batch previews, user approval or rejection, batch hashing, expiry, ownership, and pre-publish revalidation for n8n-tt-outpost. Use when a future F5 flow requires approval per batch rather than per post.
---

# Skill — Batch Approval

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/content-package.schema.json`

## Purpose

Mengelola approval user untuk satu batch Semi-Auto. Approval berlaku untuk batch yang tepat, bukan untuk semua konten atau posting masa depan. Skill ini tidak melakukan upload.

## Scope

- MVP F1–F3: nonaktif; `/approve` dan `/reject` ditolak atau ditandai feature-disabled.
- Produk final F5: aktif hanya setelah age gate, feature flag, adapter readiness, dan acceptance criteria lulus.
- Full-Auto tidak memakai approval per posting; ia memakai policy profile dan preflight.

## Inputs

- `batch_id`;
- `user_id` dan ownership context;
- content package IDs dan immutable package versions;
- target platforms;
- proposed schedule;
- per-platform metadata preview;
- quota impact dan policy profile version;
- `batch_hash`;
- approval expiry;
- signed/opaque Telegram callback atau explicit command.

Tidak menerima token, cookie, physical path, raw provider payload, atau approval tanpa owner context.

## Batch preview output

Preview harus memuat:

- batch ID dan expiry;
- jumlah item;
- package version/hash;
- platform target;
- media preview/reference yang aman;
- caption/title/tag/mention per platform;
- jadwal dan timezone `Asia/Jakarta`;
- quota impact;
- warnings dan unverified notice;
- tindakan `APPROVE` dan `REJECT` yang terikat user serta batch hash.

## Approval lifecycle

```text
DRAFT
  → PENDING_APPROVAL
  → APPROVED
  → PREFLIGHT
  → READY_TO_PUBLISH

PENDING_APPROVAL → REJECTED
PENDING_APPROVAL → EXPIRED
APPROVED → INVALIDATED
```

`APPROVED` tidak berarti publish pasti berhasil. Adapter preflight wajib berjalan setelah approval dan sebelum upload.

## Procedure

1. Resolve batch dan verify owner.
2. Freeze package versions, platform targets, schedule, and policy version.
3. Compute canonical `batch_hash` dari data yang terlihat user.
4. Create preview dengan expiry.
5. Deliver preview melalui Telegram.
6. Consume one-time approval/rejection action.
7. Verify owner, signature/opaque callback, expiry, current state, and hash.
8. Store decision and audit event.
9. Jika approved, rerun policy/adapter preflight.
10. Invalidate approval jika package, policy, target, schedule, or quota changes.

## Hard rules

- Approval tidak boleh berlaku lintas batch.
- Approval tidak boleh dipakai ulang setelah terminal decision.
- Approval expired harus menghasilkan `NEED_APPROVAL` baru.
- Perubahan package setelah approval membatalkan approval lama.
- User tidak boleh approve batch milik user lain.
- Approval tidak boleh bypass age gate, policy, session, adapter, atau emergency stop.
- Tidak boleh mengklaim publish sukses dari approval saja.

## Decision output

```json
{
  "batch_id": "uuid",
  "decision": "APPROVED",
  "batch_hash": "sha256",
  "approved_by": "user-id",
  "approved_at": "2026-11-08T04:00:00Z",
  "expires_at": "2026-11-08T05:00:00Z",
  "requires_preflight": true
}
```

Decision: `APPROVED`, `REJECTED`, `EXPIRED`, `INVALIDATED`, `NEED_APPROVAL`, atau `DENIED`.

## Failure modes

| Code | Action |
|---|---|
| `ERR_BATCH_NOT_FOUND` | Deny tanpa membocorkan batch user lain. |
| `ERR_BATCH_OWNERSHIP` | Security deny dan audit. |
| `ERR_BATCH_HASH_MISMATCH` | Invalidate approval; create new preview. |
| `ERR_APPROVAL_EXPIRED` | Return `NEED_APPROVAL`. |
| `ERR_APPROVAL_REPLAY` | Safe no-op/deny dan audit. |
| `ERR_BATCH_MUTATED` | Invalidate and rebuild preview. |
| `ERR_FEATURE_DISABLED` | MVP deny with clear user message. |
| `ERR_PREFLIGHT_FAILED` | Keep batch unpublishable; notify reason. |

## Side effects

- Read/write batch approval state.
- Write audit event.
- Send preview/decision notification through Telegram interface.
- Tidak login, upload, atau publish.

## Quality checks

- Hash canonical and reproducible.
- Preview exactly matches approved payload inputs.
- Callback one-time, signed/opaque, user-bound, and expiring.
- Package/policy mutation invalidates approval.
- Ownership and feature flag tests pass.
- Concurrent approval/rejection has one terminal winner.
- Full-Auto never asks for per-post approval through this skill.
