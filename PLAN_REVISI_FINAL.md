> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# PLAN REVISI FINAL — Otomatisasi Konten TikTok & Instagram via n8n

## 1. Keputusan baseline

| Item | Keputusan |
|---|---|
| Target inti MVP | Menghasilkan video vertikal dengan voiceover Bahasa Indonesia dan mengirimkannya melalui Telegram. |
| Scope MVP | F1 Foundation, F2 Content Engine, F3 Telegram Manual Interface. |
| Posting MVP | Manual only. User menerima video, caption, hashtag, dan sumber lalu posting sendiri. |
| Produk final | Agentik AI dapat publish/cross-post ke TikTok, Instagram, dan Facebook melalui adapter platform. |
| Publisher MVP | Tidak aktif pada F1–F3; Manual-only. |
| Publisher final | Semi-Auto dan Full-Auto tersedia setelah F5 lulus review dan acceptance criteria. |
| Database | PostgreSQL sejak F1. SQLite bukan runtime target atau fallback transparan. |
| Content research | M-RESEARCH disebut Content Ideation; bukan riset web atau fact-checking. Output faktual tanpa sumber diberi status `unverified`. |
| Interface | Telegram Bot untuk user yang di-allowlist. |
| Hardware | Capability probe, benchmark ringan, dan fallback; tidak ada angka GPU layers/concurrency yang dianggap universal. |
| Status proyek | Perencanaan saja. Tidak ada instalasi, workflow, bot, API connection, atau publisher yang dijalankan. |

## 2. Arsitektur MVP

| Kode | Modul | Fungsi MVP |
|---|---|---|
| M-INPUT | Input Interface | Menerima tema melalui Telegram dan memvalidasi user. |
| M-USER | User Manager | Menyimpan user Telegram, allowlist, dan ownership. |
| M-THEME | Theme Processor | Normalisasi dan validasi tema. |
| M-RESEARCH | Content Ideation | Membuat sudut pandang, hook, struktur, dan keyword; bukan riset faktual. |
| M-IMAGE | Media Sourcing | Mengambil asset dengan metadata provider, sumber, terms, dan hash. |
| M-CAPTION | Caption Writer | Membuat caption, CTA, dan hashtag Bahasa Indonesia. |
| M-TTS | Voiceover Engine | Menghasilkan voiceover dengan engine utama dan fallback. |
| M-VIDEO | Video Composer | Menggabungkan gambar, audio, dan teks menjadi MP4 9:16. |
| M-STORE | Asset Manager | Menyimpan metadata job/artifact di PostgreSQL dan file di storage lokal. |
| M-NOTIFY | Output Notifier | Mengirim hasil atau secure expiring download link ke Telegram. |
| M-SCHED | Scheduler & Queue | Menjaga queue produksi internal dan recovery. Diimplementasikan setelah F1–F3 bila diperlukan. |
| M-APPROVAL | Manual Delivery Gate | Memastikan hasil menunggu posting Manual oleh user. |
| M-PUBLISH | Agentic Cross-Post Publisher | Tidak aktif dalam MVP; produk final F5. |

## 3. Alur MVP

```text
User Telegram yang di-allowlist mengirim tema
    ↓
Validasi user, input, rate limit, dan idempotency
    ↓
Theme Processor → Content Ideation
    ↓
Media Sourcing → Caption Writer
    ↓
TTS → Video Composer
    ↓
Quality Gate → PostgreSQL manifest + asset storage
    ↓
Telegram delivery / secure expiring link
    ↓
User posting Manual melalui aplikasi platform
```

Tidak ada login platform, penyimpanan cookie platform, browser automation, auto-posting, atau approval umur akun pada alur MVP. Produk final menambahkan tahap eligibility gate dan cross-post adapter setelah F5 disetujui.

## 4. Telegram MVP

Perintah yang direncanakan:

| Perintah | Fungsi |
|---|---|
| `/start` | Menjelaskan scope Manual-only dan cara memakai bot. |
| `/post <tema>` | Membuat satu job idempotent. |
| `/status` | Menampilkan status job milik user. |
| `/download` | Mengirim artifact completed milik user yang belum expired. |
| `/batal` | Meminta pembatalan job dan cleanup. |
| `/account <username>` | Opsional; hanya metadata, bukan login/verifikasi platform. |
| `/mode manual` | Diterima. |
| `/mode semi` atau `/mode full` | Ditolak pada MVP; tersedia pada produk final setelah F5 lulus. |

Kontrol wajib: allowlist, ownership check, persistent update cursor, single consumer/lock, rate limit, bounded retry/backoff, input validation, no arbitrary path, secret separation, platform eligibility, adapter validation, dan policy preflight.

## 5. Database dan state

PostgreSQL menjadi sumber kebenaran untuk:

- `users` dan allowlist;
- `accounts` sebagai metadata platform, tanpa session cookie pada MVP;
- `jobs` dan state machine;
- `job_steps` dan retry/checkpoint;
- `artifacts` dan manifest sumber;
- `telegram_updates`/idempotency key;
- audit log dan retention metadata.

SQLite hanya boleh digunakan untuk prototipe lokal sekali jalan yang sengaja dibatasi single-user/single-worker, bukan target deployment.

## 6. Fase roadmap

| Fase | Fokus | Status |
|---|---|---|
| F1 | Foundation lokal, PostgreSQL, capability probe, healthcheck, recovery dasar | Direncanakan |
| F2 | Content Ideation, media metadata, caption, TTS, video 9:16, quality gate | Direncanakan |
| F3 | Telegram Manual Interface, allowlist, ownership, delivery, cancellation | Direncanakan |
| F4 | Scheduler/queue produksi internal dan guardrail operasional | Setelah F1–F3; belum implementasi |
| F5 | Agentic Publisher & Cross-Post Adapters | Produk final; perlu review compliance/security dan acceptance criteria terpisah |
| F6 | VPS migration | Ditunda sampai kebutuhan 24/7 terbukti |

## 7. Acceptance baseline

Acceptance criteria wajib mengikuti `outputs/PLAN_MVP_ACCEPTANCE_TELEGRAM_DATABASE.md`. MVP hanya lulus bila artifact valid, ownership aman, job idempotent, restart/recovery diuji, backup/restore PostgreSQL lulus, dan mode otomatis tetap tidak tersedia.
