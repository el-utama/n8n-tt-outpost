> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. F3 = Telegram Manual Interface; PostgreSQL sejak F1; belum ada implementasi.

# FASE 3 — Interface: Telegram Manual Interface

## Tujuan

User tidak perlu membuka editor n8n. User yang berada dalam allowlist berinteraksi melalui Telegram untuk membuat job, melihat status, membatalkan job, dan menerima video, voiceover, caption, hashtag, serta metadata sumber.

MVP hanya menggunakan mode **Manual**. Semi-Auto dan Full-Auto ditahan sebagai roadmap F5 dan tidak boleh dijalankan dari F3.

## Micro-Phase F3

### F3.1 — Bot dan otorisasi

Bot dibuat melalui @BotFather, tetapi token harus disimpan sebagai secret/environment dan tidak boleh muncul di workflow export, repository, log, atau pesan user.

Bot hanya merespons user/chat ID yang berada dalam allowlist. Setiap operasi wajib memeriksa ownership terhadap user, job, account metadata, dan artifact.

### F3.2 — Perintah bot

| Perintah | Fungsi MVP |
|---|---|
| `/start` | Menjelaskan scope Manual-only, batasan, dan contoh penggunaan. |
| `/post <tema>` | Memvalidasi tema dan membuat satu job idempotent. |
| `/account <username>` | Opsional; menyimpan metadata platform tanpa login atau verifikasi kepemilikan. |
| `/mode manual` | Menetapkan mode Manual. |
| `/mode semi` atau `/mode full` | Ditolak karena publisher belum aktif. |
| `/status` | Menampilkan state, step, progress, waktu update, dan error yang aman. |
| `/download` | Mengirim artifact completed milik user yang belum melewati retention. |
| `/batal` | Mengajukan cancellation dan cleanup proses/temp file. |

### F3.3 — Update consumer dan job handoff

Gunakan satu consumer Telegram aktif atau distributed lock yang setara. `update_id`/cursor disimpan persisten sehingga restart tidak menggandakan atau melewati update. Consumer hanya memvalidasi input dan membuat record job; pekerjaan berat dijalankan oleh worker melalui PostgreSQL.

Request yang sama harus menggunakan idempotency key. Timeout, network error, dan rate limit menggunakan retry terbatas dengan backoff. Progress dibatasi agar tidak membanjiri chat.

### F3.4 — Output Notifier

Pesan final harus memuat job ID, status Manual, caption, hashtag, sumber asset, dan video atau secure expiring download link. Link tidak boleh menebak path, membuka directory listing, atau dapat dipakai oleh user lain.

Limit ukuran file Telegram harus diverifikasi saat implementasi. Jika file terlalu besar, gunakan storage artifact dengan token acak, expiry, ownership check, dan retention cleanup.

### F3.5 — Dashboard Web

Dashboard web bersifat opsional dan bukan deliverable MVP. Telegram tetap menjadi interface utama.

## Deliverable F3

- Bot Telegram Manual-only untuk user allowlist.
- Perintah `/start`, `/post`, `/status`, `/download`, `/batal`, dan metadata account.
- `/mode manual` diterima; mode otomatis ditolak.
- Persistent update cursor, idempotency, ownership check, rate limit, retry/backoff, dan cancellation.
- Pengiriman video/caption/sumber melalui Telegram atau secure expiring link.
- Tidak ada login platform, cookie platform, browser automation, atau auto-posting.

## Catatan biaya

Telegram Bot API tidak memiliki biaya software yang direncanakan; storage, bandwidth, listrik, dan backup tetap perlu dimasukkan ke perencanaan operasional.
