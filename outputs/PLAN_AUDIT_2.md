# SECOND PLAN AUDIT — n8n-tt-outpost

**Audit date:** 2026-11-07  
**Scope:** Canonical source-of-truth, master plans, F1–F6, acceptance criteria, budget, hardware, and prior audit.  
**Implementation status:** None; this audit is planning-only.
**Follow-up status:** P1/P2 recommendations applied to the planning documents; this file is now historical/non-normative.

## 1. Executive result

The major contradictions from the previous audit are resolved. The documents now consistently state that:

- F1–F3 are the MVP scope;
- MVP posting is Manual-only;
- PostgreSQL is the target database from F1;
- M-RESEARCH is Content Ideation rather than verified web research;
- Telegram requires allowlisting, ownership checks, idempotency, persistent update state, rate limiting, bounded retries, cancellation, cleanup, and expiring artifact links;
- F4 is internal production scheduling/queueing only;
- F5 publisher automation is held for a separate compliance and security review;
- the project remains planning-only.

**Overall assessment at time of audit:** Coherent baseline with P1/P2 clarification items. Those clarification items have since been applied to the planning documents.

## 2. Findings that remain

### P1 — Resolve before the plan is considered final

#### P1.1 Hardware defaults still imply more certainty than the canonical policy allows
`PLAN_HARDWARE_AUTO_DETECT.md` still says the system will “langsung memilih konfigurasi optimal” and presents `qwen2.5:7b`, 8 GB VRAM, and `h264_nvenc` as the likely choices. `PLAN_PHASE_1_FOUNDATION.md` also describes the model as a default for “riset”.

**Risk:** The canonical policy requires capability probing and benchmark-based selection, not an assumed optimal configuration. The model is for ideation, not factual research.

**Recommended correction:** use “candidate baseline” instead of “optimal”; record detected capability, driver/runtime status, benchmark result, selected model, selected encoder, fallback reason, and confidence. Rename “riset” to “content ideation”.

#### P1.2 Platform/account abstraction is still TikTok-centric in supporting documents
The canonical source says TikTok and Instagram must be separate adapters, but the master and F4 documents still use TikTok-specific account wording in places. The MVP does not need platform login, so account metadata can be platform-neutral.

**Recommended correction:** use `platform`, `account_handle`, and `account_metadata` in the planning schema. Treat TikTok and Instagram as future adapter values, not as one shared account behavior.

#### P1.3 Budget document contains unverified operational assumptions
The budget says storage is “cukup untuk ratusan video” and that Telegram Bot API is “gratis tanpa batas pesan”. These are not safe planning guarantees. Storage depends on bitrate, source assets, retention, previews, logs, and backups. Telegram usage is subject to platform limits and operational constraints.

**Recommended correction:** mark these as estimates requiring verification; add a storage formula, retention policy, quota, bandwidth estimate, and a “subject to current provider limits” note.

#### P1.4 F6 still presents VPS as necessary for future Semi-Auto posting
The F6 table says VPS is required for Semi-Auto posting without the home PC. F5 is currently held and no publisher mode is approved.

**Recommended correction:** phrase this as a hypothetical future scenario only: “If a future publisher is approved and requires an always-on environment, evaluate VPS at that time.” VPS remains optional for the approved MVP and F4.

#### P1.5 Logical and physical paths are not distinguished
Some plans use `/assets/`, while the Windows setup uses `C:\n8n-tt-outpost\assets\`. The acceptance criteria refer to artifact paths without defining a logical artifact URI versus a physical storage path.

**Recommended correction:** define logical paths in the plan (`artifact://<id>`, `asset://<id>`) and keep physical paths as deployment-specific configuration. User input must never select a physical path.

### P2 — Improve for precision and maintainability

#### P2.1 Fixed detection timestamp is example data, not a schema rule
The hardware example contains a fixed `detected_at` timestamp. It should be explicitly labeled as an example and generated at runtime in a future implementation.

#### P2.2 Acceptance state naming and module naming should be aligned
The acceptance criteria use `GENERATING_PLAN`, while the synchronized plans use `Content Ideation`. This is not a functional conflict, but the state should be named `GENERATING_IDEATION` or documented as the canonical state for the ideation step.

#### P2.3 F2 still uses informal “research” references
Examples include “keyword dari research” and a caption/TTS input described as “research”. These should consistently become “content plan” or “ideation output”.

#### P2.4 F2 output contract needs a platform-neutral MVP label
The caption plan says “Panjang optimal TikTok”. Since MVP does not post to a platform and TikTok/Instagram are separate future adapters, use “configured caption length for the selected content profile” and defer platform-specific limits to adapter specifications.

#### P2.5 The master plan still lists account mode checks in the happy path
The MVP does not use account age or auto-posting. The flow can retain user/account ownership validation, but “cek mode posting per akun” should be replaced with “resolve user ownership and active content profile”.

#### P2.6 Historical audit wording must remain clearly non-normative
`outputs/PLAN_AUDIT.md` contains old risks and examples such as “Research Engine” and “interval aman”. This is acceptable as an audit record, but it must remain explicitly labeled historical/non-normative. The canonical source-of-truth must always override it.

## 3. Consistency matrix

| Decision | Canonical source | Master/revised plan | Acceptance criteria | Result |
|---|---|---|---|---|
| MVP F1–F3 | Yes | Yes | Yes | Consistent |
| Manual-only MVP | Yes | Yes | Yes | Consistent |
| PostgreSQL from F1 | Yes | Yes | Yes | Consistent |
| SQLite not runtime target | Yes | Yes | Yes | Consistent |
| Content Ideation, not web research | Yes | Mostly | Yes | Minor wording cleanup remains |
| Telegram security controls | Yes | Yes in F3 | Yes | Consistent |
| F4 internal queue only | Yes | Yes | Not in MVP AC | Consistent; F4 is post-MVP |
| F5 held | Yes | Yes | Yes | Consistent |
| TikTok/Instagram separate adapters | Yes | Partial | Partially | Platform-neutral wording needed |
| Capability probe | Yes | Partial | Yes | Remove “optimal”/hard-coded implications |
| Asia/Jakarta timezone | Yes | F4 only | Not explicit in all AC | Add to shared planning assumptions |

## 4. Go/no-go assessment

### Green — aligned and accepted

The scope boundary, database decision, Manual-only MVP, Telegram control requirements, publisher hold, and AI document hierarchy are now aligned.

### Amber — clarify before final freeze

Resolve the five P1 items: capability wording, platform-neutral account metadata, budget assumptions, VPS wording, and logical/physical artifact paths. Then perform a final terminology pass for ideation, caption profiles, and job state names.

### Red — not approved

No implementation, Telegram bot activation, API connection, database runtime, publisher automation, platform login, or VPS migration is approved by this audit.

## 5. Recommended finalization order

1. Update the canonical source-of-truth with the final terminology decisions.
2. Apply the same terminology to the hardware, F1, F2, F4, F6, and budget documents.
3. Add the logical artifact URI and storage-retention definitions to the acceptance criteria.
4. Mark the prior audit as historical/non-normative.
5. Run one final contradiction scan and freeze the planning baseline.

## 6. Final verdict

The plan is **architecturally coherent and has completed the documented refinement pass**. This report remains a historical record; active decisions must follow `00_AI_SOURCE_OF_TRUTH.md`. No implementation action is recommended by this audit.
