---
name: policy-engine
description: Deterministic publishing policy decisions for n8n-tt-outpost. Use for TikTok account-age gates, Manual/Semi-Auto/Full-Auto eligibility, policy-profile validation, quota and interval checks, batch approval requirements, emergency-stop checks, and pre-publish allow/deny/hold decisions.
---

# Policy Engine

**Status:** Draft 1.0.0  
**Sumber:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `docs/rules.md`

## Purpose

Menghasilkan keputusan deterministik `ALLOW`, `DENY`, `HOLD`, atau `NEED_APPROVAL` untuk delivery/publishing. Skill ini bukan LLM skill dan tidak melakukan upload.

## Inputs

- `user_id`, `account_id`;
- mode: `MANUAL`, `SEMI_AUTO`, atau `FULL_AUTO`;
- TikTok account age, verification status, dan timezone;
- active policy profile;
- platform targets dan adapter capability status;
- content package QC result/version/hash;
- quota usage, last publish timestamps, retry count;
- approval record untuk Semi-Auto;
- emergency-stop status;
- session/permission health summary tanpa secret.

## Outputs

```json
{
  "decision": "ALLOW",
  "mode": "SEMI_AUTO",
  "reason_codes": [],
  "requires_approval": false,
  "checked_at": "2026-11-08T02:00:00Z",
  "policy_profile_version": "1.0.0",
  "next_allowed_at": null
}
```

Reason codes harus stabil dan machine-readable, misalnya `AGE_BELOW_THRESHOLD`, `AGE_UNVERIFIED`, `POLICY_EXPIRED`, `DAILY_QUOTA_EXCEEDED`, `MIN_INTERVAL_NOT_MET`, `SESSION_UNHEALTHY`, `ADAPTER_UNAVAILABLE`, `CONTENT_QC_FAILED`, `APPROVAL_REQUIRED`, `EMERGENCY_STOP_ACTIVE`.

## Eligibility rules

| Mode | Rule |
|---|---|
| Manual | Always eligible jika ownership dan content QC lulus. |
| Semi-Auto | TikTok age ≥31 hari, verified atau policy konservatif yang secara eksplisit mengizinkan, batch approval valid. |
| Full-Auto | TikTok age ≥90 hari, policy profile lengkap/confirmed, dan seluruh preflight lulus. |

MVP selalu menolak mode Semi-Auto dan Full-Auto meskipun umur akun memenuhi threshold.

## Full-Auto policy validation

Wajib ada dan valid:

- `start_at` dan `duration_days` positif;
- `max_posts_per_day` dan per-platform quota;
- `minimum_interval_minutes`;
- daily time window dan active days;
- active platforms;
- `max_batch_items`;
- retry limit;
- duplicate prevention;
- emergency stop status/authority.

Tolak nilai negatif, kosong, kontradiktif, policy expired, dan policy di luar timezone baseline `Asia/Jakarta`.

## Preflight sequence

1. Check project feature flag: MVP atau F5 enabled.
2. Check ownership dan account mapping.
3. Check mode dan TikTok age gate.
4. Check verification status dan conservative policy.
5. Check package QC, version, retention, dan artifact existence.
6. Check platform capability/session summary.
7. Check policy active window.
8. Check daily/total quota.
9. Check minimum interval.
10. Check approval hash/expiry untuk Semi-Auto.
11. Check retry and duplicate constraints.
12. Check emergency stop.
13. Return decision dan reason codes.

## Hard rules

- Jangan mengubah quota atau timestamp publish dari dalam LLM.
- Jangan menganggap tanggal input user sebagai verified.
- Jangan mengeluarkan `ALLOW` jika hard check tidak memiliki data.
- Jangan melakukan side effect publish.
- Jangan membypass emergency stop.
- Jangan mengubah policy tanpa ownership dan audit event.

## Failure handling

- Missing data → `HOLD` atau `DENY`, bukan asumsi.
- Database unavailable → retry bounded; jangan mengeluarkan `ALLOW` berdasarkan cache stale.
- Policy conflict → `HOLD` dan `POLICY_CONFLICT`.
- Age below threshold → `DENY` untuk mode otomatis; Manual tetap dapat diproses.
- Session invalid → `HOLD` dengan `SESSION_ACTION_REQUIRED`.

## Side effects

- Read policy/account/quota/session summaries.
- Write policy decision dan audit event.
- Tidak mengunggah, login, mengubah platform, atau menghapus artifact.

## Quality checks

- Decision reproducible untuk input yang sama.
- Semua reason code dapat diaudit.
- Test threshold 30/31/89/90 hari.
- Test expired policy, quota, interval, approval expiry, stop, partial platform readiness.
- Test MVP flag menolak automatic modes.
