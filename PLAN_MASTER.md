> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# PLAN MASTER — Agentic Content & Cross-Post Publishing TikTok, Instagram, Facebook via n8n

## Tujuan
Membangun sistem otomasi konten sosial media yang modular, mudah diperbaiki, dan siap dikembangkan. **Target inti MVP: aplikasi dapat membuat video dengan voiceover secara otomatis.** Pengiriman hasil dilakukan melalui Telegram. Posting platform untuk MVP adalah **Manual only**; Semi-Auto dan Full-Auto ditahan sebagai roadmap F5 dan belum aktif.

User tidak perlu membuka editor n8n. Interaksi utama melalui **Telegram Bot**.

Produk final bukan hanya generator konten. Setelah MVP dan review F5 selesai, agentik AI dapat menerbitkan paket konten ke TikTok, Instagram, dan Facebook melalui adapter platform-specific. Visual utama dapat dipakai bersama, sedangkan title, caption, tags, mentions, privacy, scheduling, dan error handling disesuaikan per platform.

## Spesifikasi Hardware yang Digunakan
- **RAM:** 32 GB
- **CPU:** Intel Core i7-14700F
- **GPU:** NVIDIA RTX 5060 (CUDA, estimated 8 GB VRAM)
- **OS:** Windows 10/11

## Prinsip Arsitektur: Modular & Pluggable
Setiap tugas dipisah menjadi modul independen dengan isolasi per user dan per akun. Modul posting adalah pluggable dan dapat diganti sesuai pilihan user.

| Kode | Modul | Fungsi | Catatan |
|------|-------|--------|---------|
| M-INPUT | Input Interface | Terima tema via Telegram | Telegram Bot sebagai prioritas |
| M-USER | User & Account Manager | Multi-user, ownership, dan metadata account platform-neutral | Tidak ada sesi platform dalam MVP |
| M-THEME | Theme Processor | Normalisasi & validasi tema | Ollama LLM lokal |
| M-RESEARCH | Content Ideation | Sudut pandang, struktur konten, hook 3 detik | Ollama LLM lokal; bukan riset web/fact-checking |
| M-IMAGE | Media Sourcing | Cari dan unduh 5+ gambar dengan terms/license terdokumentasi | Unsplash/Pexels/Pixabay API |
| M-CAPTION | Caption Writer | Caption, deskripsi, hashtag Bahasa Indonesia | Ollama LLM lokal |
| M-TTS | Voiceover Engine | Teks → suara Indonesia | Edge-TTS atau Piper (lokal) |
| M-VIDEO | Video Composer | Gabung gambar + suara + teks → MP4 9:16 | FFmpeg (GPU RTX 5060) |
| M-CAROUSEL | Carousel Composer | 5 gambar siap posting carousel | Alternatif jika video gagal |
| M-STORE | Asset Manager | Simpan & indeks file hasil | PostgreSQL + folder lokal |
| M-NOTIFY | Output Notifier | Kirim hasil ke Telegram | Telegram Bot API |
| M-SCHED | Scheduler & Queue | Antrian & jadwal produksi | n8n Cron + database state |
| M-APPROVAL | Approval Gate | Guardrail untuk roadmap publisher setelah review | Tidak aktif dalam MVP |
| M-PUBLISH | Agentic Cross-Post Publisher | Publish TikTok/Instagram/Facebook sesuai gate dan adapter | Produk final; tidak aktif dalam MVP |

## Alur Data (Happy Path)
```
User kirim tema ke Telegram
    ↓
M-INPUT → M-USER (validasi user, ownership, dan content profile)
    ↓
M-THEME → M-RESEARCH / Content Ideation (struktur konten)
    ↓
M-IMAGE (5 gambar) + M-CAPTION (teks Indonesia)
    ↓
M-TTS (voiceover Indonesia)
    ↓
M-VIDEO (gabung jadi MP4 9:16 dengan voiceover)
    ↓
M-STORE (simpan per user) → M-NOTIFY (kirim ke Telegram)
    ↓
User menerima hasil untuk posting Manual. Publisher otomatis tidak aktif dalam MVP.
```

Pada produk final, alur setelah delivery dapat dilanjutkan oleh M-APPROVAL dan M-PUBLISH setelah eligibility, policy profile, session health, dan adapter platform lulus.

## Mode Posting (Pilihan User)
Pada MVP sistem hanya menyediakan mode Manual. Mode otomatis adalah roadmap dan belum boleh dipilih:

| Mode | Deskripsi | Batasan Umur Akun |
|------|-----------|-------------------|
| **Manual** | n8n siapkan video + caption, user posting sendiri lewat aplikasi | Tersedia untuk semua umur akun (0+ hari) |
| **Semi-Auto** | TikTok age ≥31 hari; publish per batch setelah approval user | Produk final; tidak tersedia dalam MVP |
| **Full-Auto** | TikTok age ≥90 hari; publish sesuai policy limits user dengan emergency stop | Produk final; tidak tersedia dalam MVP |


Akun dan umur akun belum digunakan untuk auto-posting pada MVP. `/mode` selain Manual ditolak di MVP, tetapi menjadi mode produk final setelah F5 lulus.

## Rencana Fase (Micro-Phase)

| Fase | Nama | Fokus Utama | Estimasi |
|------|------|-------------|----------|
| F1 | Foundation | n8n + Ollama (GPU) + FFmpeg + PostgreSQL + deteksi otomatis | 2–3 hari |
| F2 | Content Engine | Caption, gambar, voiceover, **video 9:16** | 3–4 hari |
| F3 | Interface | Telegram Bot dengan multi-user, switch account, perintah `/mode` | 2–3 hari |
| F4 | Internal Automation | Scheduler dan queue produksi internal; tanpa auto-posting | 3–4 hari |
| F5 | Agentic Publisher & Cross-Post Adapters | TikTok/Instagram/Facebook dengan gate umur, batch approval, policy limits, dan emergency stop | Roadmap produk final; belum diimplementasikan |
| F6 | VPS Migration | Opsional jika PC tidak ingin menyala 24/7 | 2–3 hari |

## Asumsi User
- RAM 32GB, i7-14700F, RTX 5060 sudah tersedia.
- Akun TikTok belum ada (dari nol).
- Budget software Rp 0 (lokal, open source).
- Bahasa Indonesia penuh di semua antarmuka dan output konten.
- Tidak perlu implementasi sekarang, hanya perencanaan matang.
