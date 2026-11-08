# RULES — n8n-tt-outpost

**Status:** Draft kanonik operasional  
**Versi:** 1.0.0-draft  
**Tanggal:** 2026-11-08  
**Sumber utama:** `00_AI_SOURCE_OF_TRUTH.md`, `docs/design.md`, `contracts/*.schema.json`

## 1. Tujuan dan kekuatan aturan

Dokumen ini menetapkan perilaku yang wajib diikuti oleh Orchestrator Agent, seluruh skill, workflow n8n, deterministic services, dan platform adapter.

Urutan otoritas:

1. Instruksi user terbaru yang sah.
2. `00_AI_SOURCE_OF_TRUTH.md`.
3. `docs/design.md`.
4. `contracts/*.schema.json`.
5. Dokumen ini.
6. Skill dan workflow turunan.

Jika aturan turunan bertentangan dengan sumber yang lebih tinggi, aturan turunan harus dianggap invalid dan diperbaiki. Tidak boleh menyelesaikan konflik dengan memilih aturan yang lebih permisif.

## 2. Klasifikasi aturan

### 2.1 Hard rule

Pelanggaran hard rule harus menghentikan action yang melanggar, mencatat audit event, dan menghasilkan keputusan `DENY`, `HOLD`, atau `FAILED_FINAL` sesuai konteks.

### 2.2 Soft rule

Soft rule menghasilkan warning. Job hanya boleh lanjut jika tidak ada hard rule yang dilanggar dan output tetap memenuhi schema serta quality gate.

### 2.3 Approval rule

Approval rule mengharuskan persetujuan user atau operator yang berwenang sebelum side effect tertentu.

### 2.4 Platform rule

Platform rule diterapkan oleh adapter platform terkait. Aturan TikTok tidak boleh diasumsikan berlaku untuk Instagram atau Facebook.

## 3. Aturan status proyek

1. Selama status proyek masih perencanaan, AI hanya boleh membuat, mengaudit, menjelaskan, dan menyempurnakan dokumen.
2. Tidak boleh memasang dependency, membuat workflow n8n aktif, menyalakan bot, menghubungkan API, membuat database runtime, login platform, atau menjalankan publisher tanpa instruksi implementasi eksplisit dari user.
3. Dokumen planning tidak boleh menyatakan bahwa fitur sudah berjalan.
4. MVP F1–F3 selalu Manual-only.
5. Semi-Auto dan Full-Auto adalah target produk final F5, bukan capability aktif MVP.

## 4. Aturan identitas, ownership, dan akses

1. Setiap job wajib memiliki `job_id`, `user_id`, dan `idempotency_key`.
2. Telegram user/chat harus berada dalam allowlist sebelum job dibuat atau status/artifact dibaca.
3. User hanya boleh mengakses job, content package, policy profile, approval, dan artifact miliknya sendiri.
4. `account_id` harus merujuk pada metadata account yang platform-neutral.
5. Username, tanggal pembuatan akun, atau data yang diketik user bukan bukti kepemilikan atau verifikasi platform.
6. Ownership check harus dilakukan sebelum membaca artifact, mengubah policy, memberi approval, membatalkan job, atau meminta publish.
7. User input tidak boleh menentukan physical path, shell command, SQL fragment, workflow ID arbitrary, atau credential reference arbitrary.

## 5. Aturan JobRecord dan state machine

1. Job wajib valid terhadap `contracts/job.schema.json` sebelum diproses.
2. State normal wajib mengikuti urutan:

```text
RECEIVED
→ VALIDATING
→ GENERATING_IDEATION
→ SOURCING_MEDIA
→ GENERATING_CAPTION
→ GENERATING_TTS
→ COMPOSING_VIDEO
→ VALIDATING_ARTIFACT
→ DELIVERING
→ COMPLETED
```

3. State failure yang sah adalah `FAILED_RETRYABLE` atau `FAILED_FINAL`.
4. Cancellation memakai `CANCEL_REQUESTED` lalu `CANCELLED` jika pekerjaan dapat dihentikan.
5. Tidak boleh melakukan transition langsung dari `RECEIVED` atau input Telegram ke publishing.
6. Setiap transition harus atomik, memiliki precondition, actor/module, timestamp, dan audit event.
7. `attempt` dimulai dari 1 dan tidak boleh melebihi `max_attempts`.
8. Retry hanya boleh untuk error yang ditandai `retryable=true`.
9. Retry wajib memakai idempotency dan tidak boleh membuat job duplikat.
10. State `COMPLETED` hanya boleh digunakan setelah output dan delivery yang diwajibkan berhasil.
11. Error message untuk user tidak boleh berisi token, cookie, authorization header, physical secret, atau stack trace sensitif.
12. `updated_at` wajib berubah pada setiap transition atau perubahan state penting.

## 6. Aturan content package

1. Content package wajib valid terhadap `contracts/content-package.schema.json`.
2. `content_package_id` harus unik dan terhubung ke tepat satu job.
3. Content Ideation bukan riset web, fact-checking, atau sumber kebenaran faktual.
4. Klaim faktual tanpa sumber eksternal harus diberi status `unverified` atau warning yang setara.
5. Caption, hashtag, scene, voiceover, dan artifact harus berasal dari package yang dapat diaudit.
6. Media asset wajib menyimpan `asset_uri`, SHA-256, tipe media, dan source/license metadata bila berasal dari provider eksternal.
7. Istilah “bebas hak cipta” tidak boleh digunakan tanpa dasar terms/license yang disimpan.
8. Artifact user-facing harus memakai logical URI `artifact://` atau `asset://`, bukan physical path.
9. Content package immutable setelah `READY_FOR_PUBLISH`, kecuali dibuat versi baru dan approval lama dibatalkan.
10. Perubahan package setelah approval membatalkan batch approval yang terkait.
11. Quality check yang gagal adalah hard stop untuk publishing.

## 7. Aturan AI dan Orchestrator

1. Orchestrator membaca state dan memilih skill; ia tidak boleh melewati state atau policy gate.
2. Skill harus menerima input sesuai kontrak dan menghasilkan output yang dapat divalidasi.
3. LLM boleh mengusulkan ide, caption, mode, atau action, tetapi deterministic service memiliki keputusan final untuk enforcement.
4. LLM tidak boleh menentukan sendiri ownership, quota, interval, eligibility, emergency stop, atau success publish.
5. Jika input ambigu, confidence rendah, schema invalid, atau policy tidak lengkap, Orchestrator harus memilih `HOLD`, `NEED_APPROVAL`, atau meminta klarifikasi.
6. Agent tidak boleh mengarang hasil API, status publish, source/license, atau verifikasi umur akun.
7. Prompt dan output LLM tidak boleh berisi secret yang tidak diperlukan.
8. Output LLM harus diperlakukan sebagai untrusted data sampai divalidasi schema dan quality checks.
9. Skill tidak boleh melakukan side effect di luar bagian `Side Effects` yang dideklarasikan.
10. Skill harus mengembalikan error terstruktur, bukan hanya teks bebas.

## 8. Aturan mode publishing dan age gate

| Mode | Gate minimum | Approval |
|---|---:|---|
| Manual | Semua umur | Tidak diperlukan untuk delivery package |
| Semi-Auto | TikTok age ≥31 hari | Approval per batch |
| Full-Auto | TikTok age ≥90 hari | Policy profile dan preflight wajib; tidak per posting |

1. Umur akun TikTok menjadi gate utama eligibility otomatis.
2. Umur akun bukan jaminan keamanan, kepatuhan, atau keberhasilan platform.
3. Jika umur tidak verified, status harus `unverified` dan mode otomatis boleh ditolak atau ditahan.
4. `Manual` tersedia untuk semua umur.
5. Semi-Auto tidak meminta approval individual jika batch sudah disetujui, tetapi perubahan batch membatalkan approval.
6. Full-Auto tidak boleh aktif hanya karena umur lolos.
7. Setiap mode otomatis membutuhkan adapter readiness, session health, permission, policy profile, quota, dan emergency stop.
8. MVP menolak `/mode semi` dan `/mode full`.

## 9. Aturan Semi-Auto batch

1. Batch approval harus terikat pada `batch_id`, content package version/hash, user, platform target, dan expiry.
2. Preview batch wajib menunjukkan jumlah item, asset preview, jadwal, metadata per platform, dan quota impact.
3. User yang tidak memiliki ownership tidak boleh memberi approval.
4. Batch yang ditolak tidak boleh di-upload.
5. Approval expired atau package berubah berarti `NEED_APPROVAL` ulang.
6. Publish per platform tetap melewati adapter preflight setelah batch disetujui.
7. Satu kegagalan platform tidak boleh mengubah platform lain menjadi `PUBLISHED` tanpa result verification masing-masing.

## 10. Aturan Full-Auto policy profile

Full-Auto wajib memiliki semua item berikut sebelum enable:

- start date/time;
- durasi policy dalam hari;
- maksimum posting per hari secara total;
- maksimum posting per platform per hari;
- minimum interval antar-post dalam menit;
- daily time window;
- hari aktif/nonaktif;
- platform aktif;
- maksimum item per batch/content quota;
- retry limit;
- duplicate prevention;
- emergency stop authority.

Rules:

1. Policy profile tidak boleh memiliki nilai kosong, negatif, atau contradictory.
2. Timezone policy harus `Asia/Jakarta` kecuali keputusan produk mengubah baseline.
3. Preflight wajib dijalankan sebelum batch dan sebelum publish jika kondisi dapat berubah.
4. Jika quota, time window, interval, policy expiry, session, adapter, artifact, atau emergency stop gagal, publish harus `HOLD` atau `DENY`.
5. Full-Auto tidak boleh menambah quota otomatis tanpa user mengubah policy.
6. Policy change harus diaudit dan dapat memerlukan confirmation user.
7. Resume setelah emergency stop harus melakukan preflight ulang.
8. Retry tidak boleh mengabaikan minimum interval atau quota.

## 11. Aturan cross-post adapter

1. TikTok, Instagram, dan Facebook adalah adapter terpisah.
2. Shared visual/audio asset boleh sama, tetapi payload metadata wajib dibangun per platform.
3. Payload TikTok tidak boleh dikirim mentah ke Instagram atau Facebook.
4. Adapter wajib memvalidasi title, caption/description, hashtag/tag, mention, privacy, media type, duration, size, thumbnail, schedule, dan response semantics sesuai platform.
5. Tidak boleh mengarang platform capability; capability harus berasal dari adapter/configuration yang terverifikasi.
6. Adapter harus mengembalikan normalized result dan normalized error.
7. Setiap platform memiliki idempotency key atau mekanisme duplicate prevention yang setara.
8. Satu platform gagal tidak otomatis menandai platform lain gagal.
9. Partial success wajib terlihat jelas bagi user dan audit log.
10. Publishing yang memerlukan login, 2FA, CAPTCHA, atau session recovery harus berhenti dan meminta user action yang aman.

## 12. Aturan secret, session, dan security

1. Secret tidak boleh disimpan dalam workflow export, prompt, log, schema instance, source code, atau pesan Telegram.
2. Session/auth material wajib memiliki encryption at rest, access control, TTL, rotation, revoke/logout, dan expiry recovery.
3. Credential tidak boleh dikirim ke LLM kecuali bagian minimal yang secara eksplisit dibutuhkan, dan default-nya adalah tidak dikirim.
4. Token, cookie, authorization header, dan private key wajib diredaсsi dari logs.
5. Artifact download wajib ownership-checked, expiring, dan retention-controlled.
6. Emergency stop harus dapat dipanggil oleh user/operator yang berwenang tanpa memerlukan LLM reasoning.
7. Audit log menyimpan tindakan dan alasan, bukan secret.

## 13. Aturan scheduler, queue, retry, dan recovery

1. Scheduler memakai `Asia/Jakarta`.
2. PostgreSQL adalah sumber kebenaran queue dan state.
3. Worker harus memakai lease/lock, timeout, bounded retry, dan dead-letter state.
4. Queue harus memiliki concurrency limit, depth limit, dan backpressure.
5. Job stale harus dapat dideteksi dan dipulihkan atau ditandai operator action.
6. Retry memakai exponential backoff atau policy setara yang bounded.
7. Provider 5xx/timeout dapat retry jika idempotency terjamin.
8. Schema invalid, ownership failure, policy denial, dan unsupported media tidak boleh retry tanpa perubahan input atau keputusan baru.
9. Recovery setelah restart harus membaca state PostgreSQL, bukan mengandalkan memory worker.
10. Cleanup tidak boleh menghapus artifact yang belum melewati retention atau masih dimiliki job aktif.

## 14. Aturan Telegram

1. Hanya allowlisted user/chat yang dapat menggunakan bot.
2. Update cursor harus persisten.
3. Hanya satu consumer aktif atau distributed lock yang setara.
4. Command wajib divalidasi panjang, encoding, dan parameter.
5. `/status`, `/download`, `/batal`, dan approval harus ownership-checked.
6. `/download` hanya mengembalikan artifact yang belum expired dan dimiliki user.
7. `/mode semi` dan `/mode full` ditolak pada MVP.
8. Progress notification tidak boleh membocorkan provider secret atau physical path.
9. Telegram rate limit dan provider error harus menghasilkan bounded retry/backoff.
10. Callback approval harus memiliki expiry dan tidak boleh dipakai ulang setelah status final.

## 15. Aturan observability dan audit

1. Setiap transition, policy decision, approval, publish intent, result, retry, stop, dan recovery wajib memiliki audit event.
2. Log harus structured, searchable, dan bebas secret.
3. Metrics minimal mencakup queue depth, job duration, error rate, retry count, artifact cleanup, approval latency, adapter result, policy denial, dan emergency stop.
4. User-facing error harus actionable tanpa membocorkan detail internal sensitif.
5. Publish dianggap sukses hanya jika adapter dan result verifier mengembalikan status sukses yang dapat diaudit.
6. Partial failure tidak boleh disembunyikan dari user.

## 16. Prioritas keputusan saat terjadi konflik

Gunakan urutan berikut:

1. Lindungi user, secret, ownership, dan emergency stop.
2. Hentikan side effect jika policy atau schema tidak jelas.
3. Pertahankan idempotency dan jangan membuat duplicate.
4. Pilih `HOLD` atau `NEED_APPROVAL` daripada menebak.
5. Catat audit event.
6. Jelaskan konflik dan minta keputusan user bila dibutuhkan.

## 17. Acceptance minimum sebelum implementasi skill berikutnya

Sebelum skill baru dibuat atau diaktifkan:

- input/output-nya dirujuk ke schema atau kontrak tertulis;
- hard rules dan failure modes terdokumentasi;
- side effects dideklarasikan;
- ownership dan secret handling dijelaskan;
- test cases valid, invalid, retryable, final, dan cancellation tersedia;
- skill tidak membuka publisher otomatis sebelum F5 dan go/no-go terpenuhi.
