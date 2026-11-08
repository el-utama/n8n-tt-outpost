---
name: facebook-adapter
description: Draft Facebook cross-post adapter for n8n-tt-outpost. Use after F5 approval to map shared content into Facebook-specific description, media, privacy, scheduling, and result payloads with independent idempotency and verification.
---

# Skill — Facebook Adapter

**Status:** Draft design only; F5 not enabled  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/platform-payload.schema.json`, `contracts/publish-intent.schema.json`, `contracts/publish-result.schema.json`

## Purpose

Membuat payload dan lifecycle publish Facebook secara terpisah dari TikTok dan Instagram, sambil menggunakan shared visual/audio asset bila media contract mengizinkan.

## Preconditions

- F5 feature flag dan Facebook go/no-go aktif.
- Page/account ownership dan permission valid.
- Session/auth health tersedia lewat manager.
- Content QC lulus.
- Policy engine mengizinkan platform.
- Approved integration method dan test environment tersedia.

## Inputs

- `PublishIntent`;
- shared ContentPackage;
- Facebook account/page capability summary;
- Facebook platform profile;
- authorized artifact URI;
- idempotency key;
- policy dan intended schedule.

## Payload rules

- Build `platform-payload.schema.json` dengan `platform=facebook`.
- Map base caption menjadi Facebook description/fields yang didukung adapter.
- Title hanya digunakan jika capability Facebook integration version mendukungnya; jangan menganggap title TikTok universal.
- Hashtags, mentions, privacy/visibility, page destination, thumbnail, media type/size/duration, dan scheduling harus Facebook-specific.
- Visual/audio boleh shared, tetapi media validation tetap dijalankan terhadap Facebook contract.
- Jika capability unknown atau field ambiguous, `HOLD`.

## Procedure

1. Validate account/page ownership and intent.
2. Resolve capability, permission, and session summary.
3. Build Facebook payload from shared package.
4. Validate payload, media, metadata, and idempotency.
5. Run policy/session/adapter preflight.
6. Submit through approved client.
7. Persist normalized PublishResult.
8. Verify remote result/status.
9. Notify orchestrator of success, pending verification, partial failure, or final failure.

## Idempotency and recovery

Each Facebook publish intent has its own stable idempotency key. A timeout must trigger remote lookup or `PENDING` state before retry. Facebook result status is never inferred from request acceptance alone.

## Platform-specific boundary

Facebook adapter owns Page/account field mapping, description, tags/mentions, privacy, scheduling, media rules, and provider error taxonomy. Global age gate, quota, interval, and emergency stop remain policy/orchestrator responsibilities.

## Failure modes

- `ERR_FACEBOOK_CAPABILITY_UNKNOWN` → `HOLD`.
- `ERR_FACEBOOK_PERMISSION` → require account/page action.
- `ERR_FACEBOOK_SESSION_INVALID` → session recovery action.
- `ERR_FACEBOOK_MEDIA_REJECTED` → fail Facebook only.
- `ERR_FACEBOOK_RATE_LIMIT` → bounded retry.
- `ERR_FACEBOOK_TIMEOUT` → verify remote state before retry.
- `ERR_FACEBOOK_UNSUPPORTED_FIELD` → rebuild adapter payload.
- `ERR_FACEBOOK_DUPLICATE_RISK` → stop and resolve existing intent.

## Side effects

- Read authorized account/page/session through manager.
- Submit/verify Facebook publish only after F5 go/no-go.
- Write PublishResult and audit event.
- Never write TikTok/Instagram payloads.

## Quality checks

- Payload uses Facebook-specific mapping.
- Page/account target and ownership are explicit.
- Media and metadata pass adapter validation.
- Idempotency and verification status are stored.
- Partial platform outcome is visible.
- No secret/raw provider response is logged.
