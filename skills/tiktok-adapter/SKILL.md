---
name: tiktok-adapter
description: Draft TikTok cross-post adapter for n8n-tt-outpost. Use after F5 approval to validate TikTok account/session capability, transform shared content packages into TikTok-specific payloads, publish idempotently, and verify results without bypassing official or approved integration requirements.
---

# Skill — TikTok Adapter

**Status:** Draft design only; F5 not enabled  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/platform-payload.schema.json`, `contracts/publish-intent.schema.json`, `contracts/publish-result.schema.json`

## Purpose

Mengubah shared ContentPackage menjadi payload TikTok-specific, menjalankan preflight, dan mengembalikan normalized PublishResult. Adapter tidak boleh menyalin payload ke platform lain.

## Preconditions

- F5 feature flag dan go/no-go aktif.
- Account ownership valid.
- TikTok age gate sudah lulus untuk mode otomatis.
- Session/auth health tersedia melalui Secret/Session Manager tanpa secret masuk ke skill prompt.
- Content QC lulus.
- Policy/approval preflight lulus.
- Integration method resmi atau approved secara compliance/security.

## Inputs

- `PublishIntent`;
- shared ContentPackage;
- TikTok account capability summary;
- TikTok-specific platform profile;
- authorized artifact URI;
- idempotency key;
- schedule dan policy decision.

## Payload rules

- Build `platform-payload.schema.json` dengan `platform=tiktok`.
- Gunakan shared video/image/audio asset yang sudah QC.
- Transform base caption dan hashtags sesuai capability/limit configuration yang terverifikasi.
- Title hanya diisi jika capability/payload contract TikTok pada integration version mendukungnya.
- Privacy, mentions, thumbnail, schedule, media duration/size, dan options harus berasal dari verified adapter configuration.
- Jangan mengarang limit atau capability; jika tidak diketahui, `HOLD`.

## Procedure

1. Validate ownership, intent status, and idempotency.
2. Query/resolve capability configuration tanpa mengungkap credential.
3. Validate media and metadata against current adapter contract.
4. Build and schema-validate TikTok payload.
5. Run policy/session/capability preflight.
6. Submit through approved client.
7. Persist normalized result immediately with remote ID if available.
8. Verify remote result using supported read/status operation.
9. Return `PUBLISHED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, or `STOPPED`.

## Idempotency and recovery

A retry must reuse the same publish intent and platform idempotency key. Timeout without confirmation becomes `PENDING_VERIFICATION`, not an automatic duplicate upload. If provider does not support idempotency, use local intent lock plus remote lookup before retry.

## Platform-specific boundary

TikTok adapter owns TikTok payload mapping, caption/tag constraints, privacy, scheduling capability, response codes, and result verification. It does not decide global age eligibility, daily quota, or emergency stop; those belong to policy engine and orchestrator.

## Failure modes

- `ERR_TIKTOK_CAPABILITY_UNKNOWN` → `HOLD`.
- `ERR_TIKTOK_SESSION_INVALID` → user/session action required.
- `ERR_TIKTOK_MEDIA_REJECTED` → final failure for TikTok only.
- `ERR_TIKTOK_RATE_LIMIT` → bounded retry with provider guidance.
- `ERR_TIKTOK_TIMEOUT` → verify remote state before retry.
- `ERR_TIKTOK_PERMISSION` → final/hold; never bypass permission.
- `ERR_TIKTOK_DUPLICATE_RISK` → stop and verify existing intent.

## Side effects

- Read authorized account/session through manager.
- Submit/verify TikTok publish only when F5 is enabled.
- Write PublishResult and audit event.
- Never write Instagram/Facebook payloads.

## Quality checks

- Payload valid against schema.
- Adapter version and capability snapshot stored.
- Idempotency key stable.
- Remote result verified or explicitly pending.
- No secret/raw provider payload in logs.
- Partial result visible to orchestrator and user.
