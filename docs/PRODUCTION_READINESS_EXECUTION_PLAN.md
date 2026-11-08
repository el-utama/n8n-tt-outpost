# PRODUCTION READINESS EXECUTION PLAN — n8n-tt-outpost

**Status:** Controlled implementation authorized  
**Tanggal:** 2026-11-08  
**Tujuan:** Menyiapkan program agar Nemotron dapat melanjutkan engineering dan operasi melalui kontrak, tools, test, dan gates yang jelas.

## 1. Kondisi awal yang jujur

Repository saat ini berisi design, rules, contracts, skills, dan audit documents. Belum ada source code runtime, n8n workflow export, PostgreSQL migration, test suite, model server, Telegram consumer, atau platform credential.

Karena itu, “production-ready” belum tercapai. Target pekerjaan ini adalah membangun implementasi bertahap dan membuktikannya dengan test. Tidak ada klaim production-ready sebelum checklist pada dokumen ini lulus.

## 2. Default engineering decisions

Jika belum ada instruksi berbeda, implementasi memakai:

- PostgreSQL sebagai state database;
- n8n sebagai workflow/orchestration integration layer;
- local or OpenAI-compatible Nemotron endpoint melalui model adapter;
- official/approved platform integration only;
- mock provider untuk seluruh test publisher;
- `Asia/Jakarta` sebagai timezone;
- Manual MVP sebagai default;
- F4/F5 feature flags disabled by default;
- logical artifact URI;
- structured JSON contracts;
- no secret in repository or workflow export.

Varian Nemotron tidak di-hard-code sampai capability probe memilih model profile. Model adapter harus menerima endpoint/model ID melalui configuration reference.

## 3. Build sequence

### Gate 0 — Engineering foundation

Deliverables:

- project source tree;
- configuration schema and `.env.example` without secrets;
- model adapter interface;
- contract validator;
- structured logger/redactor;
- test runner;
- tool allowlist;
- checkpoint/diff workflow;
- Nemotron operator bootstrap.

Exit criteria: local validation commands run successfully without provider credentials.

### Gate 1 — PostgreSQL and job-state

Deliverables:

- migrations for users, jobs, state events, idempotency, queue leases, audit;
- transaction-safe state transition service;
- bounded retry and cancellation;
- recovery tests;
- schema fixtures.

Exit criteria: illegal transition, replay, concurrent worker, cancellation, and stale lease tests pass.

### Gate 2 — Content engine

Deliverables:

- content ideation adapter;
- caption writer;
- media sourcing abstraction;
- artifact registry;
- TTS abstraction;
- video composer abstraction;
- content QC;
- end-to-end local content generation test.

Exit criteria: a mock/local job produces a valid ContentPackage and owned artifacts without external publishing.

### Gate 3 — Telegram Manual MVP

Deliverables:

- Telegram consumer abstraction;
- allowlist and ownership;
- command router;
- status/cancel/download flow;
- expiring artifact delivery;
- rate limit and retry;
- manual-only acceptance tests.

Exit criteria: user can submit a theme, receive a package, inspect status, download artifact, and cancel safely in a controlled test environment.

### Gate 4 — Scheduler and queue

Deliverables:

- scheduler;
- worker lease;
- backpressure;
- dead-letter handling;
- retention cleanup;
- metrics and alerts.

Exit criteria: restart, duplicate trigger, stale lease, cleanup dependency, and recovery tests pass.

### Gate 5 — Publisher mock and cross-post adapter

Deliverables:

- policy engine;
- age gate using unverified/verified states;
- policy profile;
- batch builder and approval state;
- platform payload builders;
- TikTok/Instagram/Facebook mock adapters;
- result verifier;
- partial failure and idempotency tests;
- emergency stop.

Exit criteria: no real provider call is required; all mock scenarios and safety gates pass.

### Gate 6 — Provider readiness

This gate requires external facts and user-owned credentials. Deliverables cannot be declared complete without:

- selected official integration method per platform;
- verified account/page ownership;
- approved credentials/session mechanism;
- current provider capability configuration;
- terms/compliance review;
- sandbox/test account where available;
- documented rate and media constraints;
- recovery and revoke procedure.

Exit criteria: one platform at a time passes a controlled canary test with explicit authorization.

### Gate 7 — Production readiness

Required evidence:

- clean install/recovery procedure;
- pinned dependencies and model/runtime profile;
- migration backup/restore test;
- secret scanning;
- structured logging/redaction;
- health checks;
- resource and latency benchmark;
- queue/retry/recovery test;
- artifact retention test;
- security/ownership test;
- provider canary result;
- emergency stop test;
- operational runbook;
- rollback plan;
- acceptance sign-off.

## 4. What I can complete before user starts Nemotron

Saya dapat menyiapkan seluruh repository implementation, contracts, local/mock runtime, test fixtures, validator, n8n workflow templates, migrations, documentation, model adapter, tool boundary, and Nemotron bootstrap tanpa menunggu user menjalankan Nemotron.

## 5. What cannot be truthfully completed without user-owned external inputs

Hal berikut tidak boleh dipalsukan:

- Telegram bot token;
- PostgreSQL production location/credentials;
- actual Nemotron endpoint/model selection if not locally available;
- platform account ownership;
- TikTok/Instagram/Facebook credentials or approved session;
- provider terms/compliance approval;
- production domain/VPS choice;
- explicit authorization for real publish canary.

Bagian tersebut akan memiliki configuration placeholder dan mock test. Production-ready secara teknis berarti code path siap; production activation tetap memerlukan user-owned secrets and approvals.

## 6. Definition of done

Program baru disebut production-ready jika:

1. repository dapat di-setup ulang dari dokumentasi;
2. all contracts validate;
3. PostgreSQL migration and restore pass;
4. content MVP end-to-end test pass;
5. Telegram Manual acceptance pass;
6. scheduler/queue recovery pass;
7. all publisher mock tests pass;
8. no critical security finding;
9. model capability profile and benchmark are recorded;
10. secrets are externalized;
11. observability and runbook exist;
12. provider canary is explicitly authorized and verified;
13. F5 remains disabled unless its gate is signed off.

## 7. Next implementation batch

Urutan batch pertama:

1. Create runtime source tree and configuration contract.
2. Add reusable schema/test validator.
3. Add PostgreSQL migration baseline.
4. Add job-state/idempotency service.
5. Add model adapter interface and mock Nemotron endpoint.
6. Add CI-like local validation command.
7. Produce Gate 0 evidence.

No external platform call is part of this batch.
