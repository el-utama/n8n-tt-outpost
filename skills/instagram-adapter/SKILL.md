---
name: instagram-adapter
description: Draft Instagram cross-post adapter for n8n-tt-outpost. Use after F5 approval to transform shared content into Instagram-specific media and caption payloads, respecting the adapter's verified capabilities without sending TikTok-only fields.
---

# Skill — Instagram Adapter

**Status:** Draft design only; F5 not enabled  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`, `contracts/platform-payload.schema.json`, `contracts/publish-intent.schema.json`, `contracts/publish-result.schema.json`

## Purpose

Membangun payload Instagram-specific dari shared ContentPackage dan mengembalikan PublishResult ter-normalisasi. Visual/audio utama boleh sama; metadata dan delivery contract wajib dibuat ulang.

## Preconditions

- F5 feature flag dan platform go/no-go aktif.
- Account ownership dan permission valid.
- Session/auth health tersedia melalui manager.
- Content QC lulus.
- Policy engine mengizinkan platform target.
- Integration method resmi atau approved secara compliance/security.

## Inputs

- `PublishIntent`;
- shared ContentPackage;
- Instagram account capability summary;
- Instagram platform profile;
- authorized artifact URI;
- idempotency key;
- policy/schedule result.

## Payload rules

- Build `platform-payload.schema.json` dengan `platform=instagram`.
- Gunakan media yang sesuai capability Instagram adapter.
- Instagram tidak diasumsikan memiliki title seperti TikTok; field `title` harus `null` atau tidak digunakan sesuai integration contract.
- Caption dibuat dari base caption tetapi dapat dipendekkan/diubah sesuai verified Instagram configuration.
- Hashtags, mentions, privacy, cover, media type, size, duration, carousel behavior, dan schedule diproses khusus Instagram.
- Jangan mengirim TikTok-only fields atau TikTok hashtag assumptions.
- Jika capability atau limit tidak diketahui, `HOLD`.

## Procedure

1. Validate intent, ownership, package version, and idempotency.
2. Resolve Instagram capability and session summary.
3. Map shared visual/audio asset and caption into Instagram payload.
4. Remove unsupported title/TikTok-only fields.
5. Validate payload and media.
6. Run policy/session/capability preflight.
7. Submit through approved client.
8. Persist PublishResult per Instagram intent.
9. Verify remote object/status where supported.

## Idempotency and partial failure

Reuse the same platform-specific idempotency key for retries. If upload result is uncertain, perform remote lookup or mark pending verification before retry. Instagram failure must not mark TikTok or Facebook as failed.

## Platform-specific boundary

Instagram adapter owns Instagram field mapping, media contract, caption/hashtag/mention limits, privacy, scheduling capability, and response taxonomy. Global mode, age gate, quota, and emergency stop remain outside this adapter.

## Failure modes

- `ERR_INSTAGRAM_CAPABILITY_UNKNOWN` → `HOLD`.
- `ERR_INSTAGRAM_SESSION_INVALID` → session action required.
- `ERR_INSTAGRAM_MEDIA_REJECTED` → fail Instagram only.
- `ERR_INSTAGRAM_RATE_LIMIT` → bounded retry.
- `ERR_INSTAGRAM_TIMEOUT` → remote verification before retry.
- `ERR_INSTAGRAM_UNSUPPORTED_FIELD` → rebuild payload without field; never forward raw TikTok payload.
- `ERR_INSTAGRAM_PERMISSION` → hold/final failure according to policy.

## Side effects

- Read authorized account/session through manager.
- Submit/verify Instagram publish only after F5 go/no-go.
- Write normalized PublishResult and audit event.
- Never write TikTok/Facebook payloads.

## Quality checks

- `title` is not incorrectly sent as an Instagram requirement.
- Caption/hashtags/mentions match verified adapter configuration.
- Payload schema and media checks pass.
- Idempotency and remote verification are recorded.
- No secret/raw provider response appears in logs.
