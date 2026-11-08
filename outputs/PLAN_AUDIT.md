# AUDIT SELURUH RENCANA

**Proyek:** n8n-tt-outpost  
**Tanggal audit:** 2026-11-07  
**Status:** Audit baseline; keputusan telah dikonfirmasi user dan disinkronkan ke dokumen kanonik.  
**Sifat dokumen:** Historis/non-normatif; keputusan aktif wajib mengikuti `00_AI_SOURCE_OF_TRUTH.md`.  
**Dokumen diperiksa:** 10 dokumen rencana  
**Ruang lingkup:** konsistensi arsitektur, kesiapan implementasi, keamanan, operasional, biaya, dan risiko publisher.

## 1. Kesimpulan eksekutif

Rencana memiliki arah produk yang jelas: menerima tema melalui Telegram, menghasilkan konten Bahasa Indonesia, dan **wajib dapat menghasilkan video vertikal dengan voiceover**. Pemisahan modul F1–F6 juga sudah membantu pengembangan bertahap.

Namun, rencana **belum siap dieksekusi sebagai sistem end-to-end**. Bagian content generation lokal cukup layak sebagai MVP, sedangkan bagian posting otomatis melalui browser automation masih merupakan area berisiko tinggi dan belum memiliki spesifikasi teknis, kontrol keamanan, atau kriteria penerimaan yang memadai.

**Keputusan audit:**

- **GO bersyarat untuk MVP F1–F3:** setup lokal, content engine, dan Telegram dengan mode Manual.
- **NO-GO untuk Semi-Auto/Full-Auto saat ini:** harus ditahan sampai risiko platform, keamanan sesi, login/2FA/CAPTCHA, recovery, dan compliance dirancang secara eksplisit.
- **F6 VPS bukan prioritas:** lakukan hanya setelah MVP lokal stabil dan kebutuhan 24/7 benar-benar terbukti.

## 2. Ringkasan status per dokumen

| Dokumen | Status | Penilaian |
|---|---|---|
| `PLAN_MASTER.md` | Perlu revisi ringan | Arah dan fase jelas, tetapi masih mencampur target MVP dengan publisher berisiko tinggi. |
| `PLAN_REVISI_FINAL.md` | Perlu revisi utama | Paling lengkap, tetapi beberapa keputusan penting masih berupa asumsi dan belum ada acceptance criteria. |
| `PLAN_COST_BUDGET.md` | Perlu validasi | Biaya software realistis untuk lokal, tetapi biaya listrik, storage, bandwidth, API quota, backup, dan biaya kegagalan belum dimodelkan. |
| `PLAN_HARDWARE_AUTO_DETECT.md` | Perlu revisi teknis | Deteksi dasar baik, tetapi konfigurasi model/GPU terlalu hard-coded. |
| `PLAN_PHASE_1_FOUNDATION.md` | Layak sebagai draft MVP | Batas Docker–host, secrets, backup, healthcheck, dan keamanan belum ditentukan. |
| `PLAN_PHASE_2_CONTENT_ENGINE.md` | Layak dengan gap penting | “Research” lokal bukan riset web aktual; lisensi media, fallback, validasi output, dan kualitas video belum cukup terukur. |
| `PLAN_PHASE_3_INTERFACE.md` | Perlu revisi keamanan | Perintah bot jelas, tetapi allowlist Telegram, otorisasi multi-user, idempotensi, dan pengiriman file belum dirancang. |
| `PLAN_PHASE_4_AUTOMATION_SCHEDULER.md` | Perlu revisi utama | Batas umur/interval adalah kebijakan internal tanpa dasar yang dijelaskan; queue, retry, lock, timezone, dan kalender belum rinci. |
| `PLAN_PHASE_5_PUBLISHER.md` | Risiko tinggi / tahan dulu | Browser automation tanpa API resmi memiliki risiko akun, ToS, sesi, CAPTCHA, 2FA, dan perubahan UI. |
| `PLAN_PHASE_6_VPS_MIGRATION.md` | Opsional, tunda | Migrasi SQLite, secret, sesi browser, domain, dan perbedaan model CPU/GPU belum punya prosedur rollback. |

## 3. Temuan prioritas

### P0 — Harus dibereskan sebelum implementasi produksi

#### P0.1 Scope MVP belum dipisahkan dari publisher berisiko tinggi
Semua dokumen menempatkan content generation dan automatic publishing dalam satu roadmap yang terlihat setara. Padahal target inti yang paling terukur adalah video + voiceover. Publisher otomatis bergantung pada sistem eksternal yang tidak stabil dan dapat memicu pembatasan akun.

**Keputusan yang disarankan:** tetapkan MVP sebagai F1–F3 dengan **Manual sebagai satu-satunya mode aktif**. F4 dipakai untuk produksi/antrian internal, bukan untuk auto-posting. F5 menjadi eksperimen terisolasi setelah ada persetujuan eksplisit dan threat model.

#### P0.2 Keamanan bot dan multi-user belum didefinisikan
Chat ID disebut sebagai identitas, tetapi belum ada allowlist, proses onboarding admin, otorisasi perintah, rate limit, atau pemisahan akses antar-user. Tanpa ini, siapa pun yang menemukan bot dapat mencoba menjalankan job, mengambil file, atau mengganti akun.

**Minimum yang harus ditambahkan:**

- allowlist Telegram user/chat ID dan mode admin;
- validasi bahwa setiap job, akun, dan file dimiliki user yang meminta;
- rate limit dan batas ukuran input;
- larangan path bebas dari input user;
- audit log untuk perintah sensitif;
- prosedur revoke bot token dan rotasi secrets.

#### P0.3 Penyimpanan cookie/sesi publisher adalah aset sangat sensitif
Rencana menyebut cookie terenkripsi, tetapi tidak menjelaskan key management, lokasi key, TTL, rotasi, backup, atau penghapusan sesi. Enkripsi dengan key yang disimpan di folder yang sama bukan perlindungan memadai.

**Keputusan minimum:** jangan menyimpan kredensial mentah di workflow n8n. Gunakan secret store/environment yang tidak masuk Git, enkripsi at rest, permission folder terbatas, retensi pendek, dan prosedur revoke/logout. Fase awal sebaiknya tidak menyimpan sesi publisher sama sekali.

#### P0.4 “Research Engine” tidak benar-benar melakukan riset aktual
Ollama lokal dapat membuat ide, outline, dan hook dari pengetahuan model, tetapi tidak otomatis memperoleh fakta/topik terbaru. Istilah “riset” berisiko membuat user menganggap output telah diverifikasi.

**Perbaikan:** ganti label menjadi `Content Ideation` untuk MVP, atau tambahkan sumber web/API yang jelas, tanggal pengambilan, sitasi, validasi fakta, timeout, dan fallback. Konten faktual harus memiliki status `unverified` bila tidak ada sumber.

#### P0.5 Batas mode/umur akun adalah kebijakan internal, bukan jaminan keamanan platform
Aturan 30/31/90 hari dan 3–10 posting per hari memberi guardrail internal, tetapi tidak membuktikan bahwa akun aman dari pembatasan. Kalimat seperti “interval aman” dan mitigasi “randomisasi” terlalu pasti.

**Perbaikan:** ubah terminologi menjadi `batas internal konservatif`, dokumentasikan bahwa tidak ada jaminan platform, dan jadikan default Manual. Hindari desain yang bertujuan mengelabui deteksi platform; fokus pada kepatuhan, human review, dan kontrol frekuensi.

### P1 — Harus dibereskan sebelum beta

#### P1.1 Konflik database dan runtime
`PLAN_MASTER` menyebut PostgreSQL, Fase 1 menggunakan SQLite, sedangkan revisi final menyebut PostgreSQL dengan SQLite sebagai fallback. Selain itu, n8n dalam Docker, Ollama di host Windows, FFmpeg, dan folder asset belum memiliki rancangan koneksi/mount yang pasti.

**Keputusan yang disarankan:** gunakan PostgreSQL sejak awal bila targetnya multi-user dan queue persisten. Jika MVP single-user, SQLite boleh dipakai hanya dengan batasan eksplisit. Tetapkan network alias, volume, permission, backup, migration, dan healthcheck.

#### P1.2 Konfigurasi hardware terlalu preskriptif
`ollama_gpu_layers: 35`, model default, VRAM 8 GB, concurrency 3, dan disk bebas 200 GB diperlakukan sebagai fakta/konfigurasi pasti. Nilai tersebut dapat berbeda karena varian hardware, driver, quantization, model tag, versi Ollama, proses lain, dan kapasitas disk aktual.

**Perbaikan:** deteksi capability, bukan hanya nama perangkat. Lakukan probe model, probe NVENC, cek ruang disk nyata, lalu pilih concurrency berdasarkan benchmark dan memory pressure. Simpan alasan pemilihan serta fallback.

#### P1.3 Content pipeline belum memiliki kontrak data dan quality gates
Modul-modul disebutkan, tetapi schema input/output, error code, idempotency key, timeout, retry, dan checkpoint belum ditentukan.

**Minimal schema job:** `job_id`, `user_id`, `account_id`, `theme`, `status`, `step`, `attempt`, `created_at`, `updated_at`, `error_code`, `artifact_manifest`, dan `retention_until`.

**Quality gates minimum:** audio ada dan dapat diputar, video 9:16, durasi sesuai, codec kompatibel, resolusi/bitrate tervalidasi, teks tidak terpotong, file tidak korup, caption berada dalam batas yang ditetapkan, serta sumber gambar tercatat.

#### P1.4 Sourcing media dan lisensi belum cukup aman
“Bebas hak cipta” terlalu longgar. API gratis tetap memiliki rate limit, syarat atribusi, pembatasan penggunaan, dan kemungkinan hasil yang tidak sesuai. Tidak ada fallback ketika lima gambar tidak tersedia.

**Perbaikan:** simpan provider, asset ID, URL sumber, author, license/terms URL, waktu unduh, dan hash file. Tetapkan fallback antar-provider, deduplikasi, filter NSFW, serta kebijakan penghapusan asset.

#### P1.5 Telegram workflow belum memiliki mekanisme update dan pembatalan yang aman
Polling `getUpdates` secara manual berisiko salah offset, duplikasi, dan race condition bila ada lebih dari satu worker. `/batal` juga belum memiliki definisi apakah proses subprocess FFmpeg/TTS benar-benar dihentikan.

**Perbaikan:** gunakan satu consumer dengan offset persisten, deduplikasi `update_id`, job queue idempotent, status progress yang konsisten, cancellation token, dan cleanup subprocess/temp files.

#### P1.6 Ukuran file dan storage belum dihitung berdasarkan volume
3 posting/hari, 30–60 detik, video 1080×1920, source image, audio, thumbnail, compressed copy, log, dan backup dapat menghabiskan disk lebih cepat dari asumsi “ratusan video”.

**Perbaikan:** tetapkan retensi, kuota per user/account, cleanup otomatis, checksum, backup/restore test, dan estimasi storage berdasarkan bitrate aktual. Limit pengiriman Telegram harus diverifikasi terhadap API saat implementasi, bukan dianggap konstan.

### P2 — Perlu dirapikan agar rencana dapat dikelola

- Gunakan satu istilah konsisten: `M-ACCOUNT` atau `M-USER`, jangan berganti tanpa batas modul.
- Bedakan akun TikTok dan Instagram; saat ini struktur akun dominan TikTok tetapi target disebut TikTok & Instagram.
- Jelaskan bahwa `username` bukan bukti kepemilikan akun dan tanggal pembuatan akun diinput user tidak terverifikasi.
- Tetapkan timezone bisnis, misalnya `Asia/Jakarta`, untuk umur akun, cron, dan interval.
- Definisikan perilaku saat restart, listrik padam, koneksi terputus, model tidak tersedia, API gambar terkena rate limit, dan disk penuh.
- Tambahkan observability: structured logs, metrics job sukses/gagal, durasi per tahap, queue depth, disk usage, dan alert Telegram.
- Tambahkan acceptance test dan Definition of Done per fase.
- Pisahkan estimasi waktu development dari waktu setup, debugging driver/GPU, dan pengujian publisher.
- Jangan menganggap VPS CPU 4–8 GB sebagai drop-in replacement untuk mesin lokal GPU; lakukan benchmark dan ubah konfigurasi model/encoder.

## 4. Konflik dan keputusan yang harus diselesaikan

| Topik | Isi yang sekarang | Keputusan yang disarankan |
|---|---|---|
| Database | PostgreSQL utama, SQLite fallback, F1 SQLite | PostgreSQL untuk target multi-user; SQLite hanya MVP single-user dengan batasan. |
| Riset | Ollama disebut research engine | MVP gunakan ideation; web research harus modul terpisah dan bersumber. |
| Publisher | Manual, Semi-Auto, Full-Auto sama-sama direncanakan | Aktifkan Manual dulu; otomatis dipisahkan sebagai eksperimen berisiko. |
| Umur akun | 30 hari vs ≥31 hari, 90 hari vs ≥90 hari | Definisikan fungsi umur berbasis tanggal/timezone secara eksplisit. |
| Interval | F4 45 menit–2 jam, tabel 3–6 jam/1–3 jam | Pilih satu policy konservatif; jangan gunakan istilah “aman”. |
| Hardware | 35 GPU layers, concurrency 3 | Ganti dengan capability probe + benchmark. |
| Platform | TikTok dan Instagram | Buat adapter dan acceptance criteria terpisah per platform. |
| File Telegram | Kompres <50 MB atau link | Verifikasi limit terkini, lalu sediakan artifact storage yang aman. |

## 5. Urutan eksekusi yang direkomendasikan

### Gate 0 — Revisi desain
1. Bekukan scope MVP: Manual only, satu platform terlebih dahulu, single-user atau allowlist yang jelas.
2. Pilih PostgreSQL atau nyatakan batasan SQLite secara resmi.
3. Tetapkan schema job, state machine, error model, timezone, retensi, dan backup.
4. Tulis threat model dan kebijakan secrets.
5. Tambahkan acceptance criteria per fase.

### Gate 1 — Foundation
1. Setup Docker/n8n/Ollama/FFmpeg dengan healthcheck.
2. Validasi model, GPU, NVENC, ruang disk, dan fallback CPU.
3. Jalankan smoke test tanpa Telegram: input tema → artifact dummy.
4. Uji restart, timeout, retry, dan cleanup.

### Gate 2 — Content Engine
1. Implementasikan theme validation dan ideation.
2. Implementasikan media sourcing dengan metadata lisensi.
3. Implementasikan TTS dengan fallback.
4. Implementasikan composer video 9:16 dan validasi output.
5. Uji minimal 20 tema beragam dan simpan metrik kegagalan.

### Gate 3 — Telegram Manual
1. Terapkan allowlist dan otorisasi.
2. Implementasikan `/post`, `/status`, `/download`, `/batal` secara idempotent.
3. Kirim video/caption/sumber dengan artifact link yang memiliki expiry.
4. Uji dua job bersamaan, restart worker, koneksi putus, dan file besar.

### Gate 4 — Scheduler internal
1. Tambahkan queue produksi dan kalender `Asia/Jakarta`.
2. Terapkan concurrency, lock, retry/backoff, dan dead-letter state.
3. Tambahkan quota harian sebagai guardrail internal, bukan klaim keamanan platform.
4. Uji recovery setelah restart/power loss.

### Gate 5 — Publisher review
Sebelum kode publisher dibuat, lakukan review terpisah untuk terms platform, keamanan login/session, 2FA/CAPTCHA, human approval, data retention, dan rollback. Jangan mengaktifkan auto-posting hanya karena kontrol umur akun telah lolos.

## 6. Definition of Done yang disarankan untuk MVP

MVP baru dianggap selesai jika:

- satu user yang terdaftar dapat mengirim tema dari Telegram;
- sistem menghasilkan video MP4 vertikal dengan voiceover Bahasa Indonesia atau memberikan error yang dapat ditindaklanjuti;
- setiap artifact memiliki manifest dan metadata sumber;
- job dapat dilanjutkan atau gagal secara jelas setelah restart;
- user hanya dapat melihat job dan file miliknya;
- mode Manual bekerja tanpa sesi login TikTok/Instagram;
- file sementara dibersihkan sesuai retensi;
- backup database dan restore test berhasil;
- tersedia log dan metrik dasar untuk menemukan kegagalan;
- tidak ada klaim bahwa interval atau umur akun menjamin keamanan platform.

## 7. Putusan akhir

Rencana ini **layak dilanjutkan setelah revisi desain** untuk jalur berikut: `Foundation → Content Engine → Telegram Manual → Scheduler internal`. Jalur publisher otomatis harus dipisahkan sebagai proyek lanjutan dengan persetujuan dan risk review tersendiri.

Prioritas paling penting bukan menambah fitur, melainkan mengunci: **scope MVP, otorisasi, secrets, database/state machine, kontrak modul, quality gates, dan recovery**. Tanpa enam hal tersebut, implementasi akan mudah terlihat berhasil pada happy path tetapi rapuh saat terjadi error, restart, multi-user access, atau perubahan platform.
