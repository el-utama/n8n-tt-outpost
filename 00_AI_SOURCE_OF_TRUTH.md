# AI SOURCE OF TRUTH — n8n-tt-outpost

**Status:** KANONIK / WAJIB DIIKUTI  
**Tanggal baseline:** 2026-11-08  
**Mode proyek:** Controlled implementation di workspace diizinkan berdasarkan instruksi user terbaru; external side effect, credential use, login, dan production publishing tetap terkunci sampai gate terkait lulus.

## 1. Hierarki sumber kebenaran

AI wajib memakai urutan prioritas berikut saat membaca atau memperbarui rencana:

1. Instruksi user terbaru dalam percakapan aktif.
2. Dokumen ini: `00_AI_SOURCE_OF_TRUTH.md`.
    3. `docs/design.md` untuk arsitektur, lifecycle, komponen, dan batas implementasi.
    4. `contracts/*.schema.json` untuk kontrak data mesin.
    5. `docs/rules.md` untuk hard rules, approval rules, security, dan enforcement behavior.
    6. `docs/NEMOTRON_OPERATOR_GUIDE.md` untuk boot sequence, tool boundary, reviewer loop, dan completion gates AI builder.
    7. `outputs/PLAN_MVP_ACCEPTANCE_TELEGRAM_DATABASE.md` untuk acceptance criteria, mitigasi Telegram, dan ADR database.
    8. Dokumen fase `PLAN_PHASE_*.md`.
    9. `PLAN_MASTER.md`, `PLAN_REVISI_FINAL.md`, `PLAN_COST_BUDGET.md`, dan `PLAN_HARDWARE_AUTO_DETECT.md` sebagai dokumen rencana pendukung.
    10. `skills/*/SKILL.md` sebagai kontrak operasional turunan.
    11. `outputs/PLAN_AUDIT.md` dan `outputs/PLAN_AUDIT_2.md` sebagai catatan audit historis dan alasan keputusan.

Jika dua dokumen tingkat bawah bertentangan dengan dokumen tingkat atas, AI wajib mengikuti dokumen tingkat atas dan menandai dokumen bawah sebagai perlu sinkronisasi. Dokumen lama tidak boleh dipakai untuk membatalkan keputusan kanonik.

## 2. Batasan tindakan AI

Saat baseline ini aktif, AI boleh:

- mengaudit, membandingkan, menjelaskan, dan menyempurnakan rencana;
- membuat atau memperbarui dokumen perencanaan;
- menyusun acceptance criteria, ADR, risk register, schema konseptual, dan roadmap.
- membuat source code, migration, workflow draft, mock adapter, test, validator, dan dokumentasi di workspace;
- menjalankan validation, unit test, integration test lokal, dan mock end-to-end.

AI tidak boleh menggunakan credential produksi, login, mengubah akun/platform, mengirim publish nyata, atau melakukan destructive external action tanpa gate dan instruksi/approval yang sesuai. Mock dan local-only runtime boleh dibuat dan diuji.

## 3. Keputusan baseline yang mengikat

### 3.1 Scope MVP F1–F3

MVP hanya mencakup:

- Foundation lokal;
- content ideation dan content engine;
- caption, media sourcing dengan metadata lisensi, TTS, dan video 9:16;
- Telegram interface untuk user yang di-allowlist;
- pengiriman artifact ke Telegram;
- mode posting **Manual only**.

MVP tidak mencakup publishing otomatis, login platform, browser automation, riset web real-time, atau dashboard web wajib. Namun, **produk final memang menargetkan agentik AI yang dapat melakukan cross-post publishing ke TikTok, Instagram, dan Facebook** setelah gate, review, dan acceptance criteria publisher terpenuhi.

### 3.2 Database

PostgreSQL adalah database utama sejak F1. SQLite bukan fallback runtime yang setara. SQLite hanya boleh disebut sebagai opsi prototipe single-user/single-worker dengan batasan eksplisit dan tidak boleh menjadi asumsi dalam schema atau acceptance criteria target MVP.

### 3.3 Content ideation, bukan riset faktual

M-RESEARCH pada MVP disebut **Content Ideation**. Ollama lokal dapat menghasilkan sudut pandang, hook, struktur, dan keyword, tetapi output tidak boleh dianggap sebagai riset web atau fact-checking. Konten faktual tanpa sumber eksternal harus diberi status `unverified`.

### 3.4 Telegram

Telegram menggunakan satu consumer aktif atau distributed lock yang setara, cursor/update ID persisten, idempotency, allowlist, ownership check, rate limit, bounded retry/backoff, cancellation, cleanup, dan secure expiring download link untuk artifact besar. Secret tidak boleh berada di workflow export atau log.

### 3.5 Hardware

Konfigurasi model, GPU layers, encoder, concurrency, dan fallback ditentukan melalui capability probe dan benchmark ringan. Angka seperti 35 GPU layers atau concurrency 3 hanya boleh menjadi nilai awal hasil probe, bukan jaminan atau hard-coded universal.

Spesifikasi hardware yang diketahui adalah input awal, bukan bukti bahwa konfigurasi tertentu optimal. Hasil probe wajib menyimpan capability, driver/runtime status, benchmark result, selected configuration, fallback reason, dan confidence.

### 3.6 F4 dan F5

F4 merancang scheduler/antrian, account-age gate, policy eligibility, dan guardrail operasional. F4 tidak mengaktifkan auto-posting pada MVP. F5 adalah roadmap produk final untuk agentik publisher dan cross-post adapter, ditahan sampai review compliance, security, session/2FA/CAPTCHA, human approval, recovery, dan acceptance criteria terpisah.

Istilah “interval aman”, “anti-deteksi”, dan randomisasi untuk mengelabui platform tidak boleh digunakan sebagai klaim. Gunakan istilah `batas internal konservatif` dan `guardrail operasional`.

### 3.6.1 Tiga mode produk final

Gate utama eligibility otomatis menggunakan umur akun TikTok yang dicatat user, dengan timezone `Asia/Jakarta` dan status `unverified` bila tanggal tidak dapat diverifikasi:

| Mode | Eligibility | Perilaku |
|---|---|---|
| Manual | Semua umur akun | AI membuat paket konten; user publish sendiri. |
| Semi-Auto | TikTok account age ≥31 hari | AI mengunggah per batch; user memberi approval per batch dan dapat memonitor hasil. |
| Full-Auto | TikTok account age ≥90 hari | AI menjadwalkan dan mempublikasikan sesuai policy limits yang dikonfigurasi user; user tetap memiliki emergency stop dan kontrol kebijakan. |

Mode otomatis tidak boleh aktif hanya karena umur akun lolos. Sistem juga wajib memeriksa platform adapter, policy profile, session health, quota, jadwal, dan approval state.

### 3.6.2 Full-Auto preflight policy

Sebelum Full-Auto diaktifkan, user wajib menetapkan policy profile sekurang-kurangnya: tanggal mulai dan berapa hari policy berlaku, posting maksimum per hari, minimum interval antar-post, time window harian, platform yang aktif, batch/content quota, retry limit, dan emergency stop. Sistem menolak atau menunda publish jika salah satu batas terlampaui.

### 3.6.3 Cross-post adapter

Content asset visual utama dapat digunakan bersama pada tiga platform, tetapi metadata dan delivery contract harus diproses per adapter. Adapter wajib menangani perbedaan title, caption, hashtag/tag limit, mention, privacy, media duration/size, thumbnail, scheduling, dan error semantics. Tidak boleh mengirim payload TikTok mentah ke Instagram atau Facebook.

### 3.7 Platform

TikTok, Instagram, dan Facebook diperlakukan sebagai adapter/platform terpisah. MVP tidak login ke platform mana pun. Data username atau tanggal pembuatan akun yang diinput user bukan bukti kepemilikan atau tanggal yang terverifikasi.

Metadata akun MVP harus platform-neutral: `platform`, `account_handle`, `account_metadata`, dan ownership reference. Jangan menggunakan schema TikTok sebagai schema universal.

### 3.8 Zona waktu dan umur akun

Semua tanggal, jadwal, dan perhitungan umur akun memakai timezone bisnis yang harus ditetapkan sebagai `Asia/Jakarta` kecuali user mengubah keputusan ini. Ambang umur 0–30, 31–90, dan 90+ hari adalah guardrail internal, bukan jaminan keamanan platform.

Timezone `Asia/Jakarta` juga menjadi asumsi bersama untuk acceptance criteria, scheduler, retention, dan audit timestamps kecuali dinyatakan lain.

### 3.9 Artifact dan storage path

Dokumen menggunakan logical artifact references seperti `artifact://<artifact_id>` dan `asset://<asset_id>`. Physical paths seperti `/assets/` atau `C:\n8n-tt-outpost\assets\` adalah detail deployment dan tidak boleh berasal langsung dari input user. User-facing download selalu melalui artifact ID, ownership check, expiry, dan retention policy.

## 4. Keputusan dokumen

- Dokumen ini adalah instruksi perencanaan kanonik untuk AI.
- Acceptance criteria dan mitigasi pada `outputs/PLAN_MVP_ACCEPTANCE_TELEGRAM_DATABASE.md` adalah baseline pengujian.
- Semua dokumen fase wajib konsisten dengan Manual only untuk MVP dan PostgreSQL sejak F1.
- Bila perubahan baru disetujui user, AI wajib memperbarui dokumen ini terlebih dahulu, lalu menyinkronkan dokumen turunan.
- Setiap perubahan besar harus mencatat tanggal, alasan, dan dampak terhadap fase/acceptance criteria.

## 5. Status roadmap

| Fase | Status baseline |
|---|---|
| F1 Foundation | Direncanakan, belum diimplementasikan |
| F2 Content Engine | Direncanakan, belum diimplementasikan |
| F3 Telegram Manual Interface | Direncanakan, belum diimplementasikan |
| F4 Internal scheduler/queue | Direncanakan setelah F1–F3, belum diimplementasikan |
| F5 Agentic publisher/cross-post | Roadmap produk final; perlu review dan acceptance criteria per platform; belum diimplementasikan |
| F6 VPS migration | Ditunda sampai kebutuhan 24/7 terbukti |
