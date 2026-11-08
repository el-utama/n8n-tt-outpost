> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. F4 hanya internal scheduler/queue; PostgreSQL sejak F1; belum ada implementasi.

# FASE 4 — Internal Automation: Scheduler, Queue, dan Recovery

## Tujuan

Mengatur produksi konten secara berjadwal, menjaga queue PostgreSQL, memulihkan job setelah restart atau kegagalan, dan merancang eligibility/policy gate untuk publisher produk final. F4 **tidak mengaktifkan auto-posting** pada MVP.

## Micro-Phase F4

### F4.1 — Scheduler & Queue

- n8n Cron membuat job produksi berdasarkan jadwal yang memakai timezone `Asia/Jakarta`.
- PostgreSQL menjadi sumber kebenaran queue dan state.
- Satu job memiliki idempotency key dan tidak boleh diproses dua kali.
- Worker menggunakan lease/lock, timeout, retry terbatas, dan dead-letter state.
- Queue memiliki batas kedalaman, concurrency, dan backpressure.
- Scheduler hanya menghasilkan konten dan mengirim hasil untuk posting Manual.

### F4.2 — Account Age Gate dan Metadata

Pada baseline ini, data akun bersifat metadata saja:

- `user_id`, platform, username, dan tanggal input;
- status ownership dan waktu perubahan metadata;
- tidak ada login, session cookie, atau verifikasi kepemilikan platform;
- umur TikTok menjadi gate utama: Manual 0+ hari, Semi-Auto ≥31 hari, Full-Auto ≥90 hari;
- tanggal umur yang diinput user diberi status `unverified` bila tidak ada verifikasi;
- gate umur tidak menjamin keamanan platform dan tidak cukup untuk mengaktifkan publisher.

Ambang umur hanya menentukan eligibility awal produk final. Publisher tetap membutuhkan adapter readiness, session health, approval/policy state, dan emergency stop.

### F4.3 — Manual Delivery Gate

- Semua hasil yang selesai dikirim ke user untuk posting Manual.
- `/mode manual` diterima.
- `/mode semi` dan `/mode full` ditolak karena publisher belum aktif.
- Tidak ada antrean posting platform pada F4.

### F4.4 — Full-Auto Policy Preflight

Sebelum Full-Auto produk final dapat diaktifkan, user wajib menetapkan tanggal mulai, durasi policy dalam hari, maksimum posting per hari, minimum interval antar-post dalam menit, time window harian, platform aktif, batch/content quota, retry limit, dan emergency stop. F4 hanya merancang serta memvalidasi policy ini; F4 tidak melakukan publish pada MVP.

### F4.5 — Guardrail Operasional Internal

- Batasi queue, concurrency, ukuran input, dan frekuensi produksi sesuai kapasitas lokal.
- Gunakan retry/backoff untuk dependency sementara.
- Hentikan atau tunda produksi jika disk rendah, database tidak sehat, atau queue penuh.
- Tidak ada randomisasi untuk mengelabui deteksi platform.
- Gunakan istilah `guardrail internal konservatif`, bukan “interval aman”.

## Deliverable F4

- Rancangan scheduler timezone `Asia/Jakarta`.
- Queue PostgreSQL dengan lock/lease, retry, cancellation, dan recovery.
- Batas concurrency dan backpressure.
- Monitoring queue depth, stale jobs, disk, database, dan error rate.
- Delivery Manual yang tidak memerlukan sesi platform.

## Catatan biaya

Tidak ada biaya software tambahan yang direncanakan selain PC lokal dan biaya listrik/internet. Backup dan storage harus tetap dimasukkan ke perencanaan operasional.
