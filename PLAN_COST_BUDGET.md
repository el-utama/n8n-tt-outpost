> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# RENCANA BIAYA — Otomatisasi TikTok/Instagram via n8n (Revisi Matang)

## Asumsi
- User sudah memiliki PC: 32GB RAM, i7-14700F, RTX 5060.
- Fase awal: hingga 3 job produksi/hari per akun; posting dilakukan Manual oleh user.
- Konten: carousel 5 foto atau video pendek 30–60 detik.
- AI lokal via Ollama (GPU RTX 5060), tidak pakai API berbayar.
- Budget maksimal: Rp 500.000/bulan.

## Tabel Biaya Bulanan (IDR)

| Aspek | Opsi | Biaya Bulanan | Keterangan |
|-------|------|---------------|------------|
| Perangkat | PC yang sudah ada | Rp 0 | Tidak perlu beli hardware baru |
| Hosting n8n | Lokal (PC rumah) | Rp 0 | n8n via Docker, bejalan di PC |
| AI Caption (LLM Lokal) | Ollama + model 7b/8b via GPU | Rp 0 | Berjalan di PC user |
| Sumber gambar berterms/license | Unsplash / Pexels / Pixabay | Rp 0 | Gratis tier mungkin tersedia; daftar API key dan simpan metadata terms |
| Voiceover (TTS Lokal) | Edge-TTS (online gratis) atau Piper (offline) | Rp 0 | Lokal / gratis |
| Pembuatan Video | FFmpeg (GPU h264_nvenc) | Rp 0 | Open source |
| Penyimpanan File | Lokal + opsi cloud | Rp 0 – 50.000 | Tergantung bitrate, retention, backup, dan quota; perlu dihitung |
| Telegram Bot | Bot API | Rp 0 software terencana | Tetap tunduk pada limit, rate limit, dan kebijakan provider yang berlaku |
| Dashboard Web | Opsional, di-host di PC yang sama | Rp 0 | Prioritas rendah |
| Listrik & Internet | Rumah | Variabel | PC menyala selama n8n berjalan |
| **TOTAL Fase Lokal** | | **Rp 0 software** | Hanya biaya listrik/internet rumah |
| **TOTAL Fase VPS (opsional)** | VPS 4–8 GB + domain | Rp 100.000 – 208.300 | Masih di bawah Rp 500.000 |

## Sisa Budget (jika tetap lokal)
Seluruh Rp 500.000 tersisa untuk:
- Upgrade internet jika sering upload video besar.
- Langganan TTS premium (ElevenLabs ~Rp 80.000/bulan) jika ingin suara lebih natural.
- Cadangan untuk VPS di masa depan.
- Biaya listing atau promosi konten (opsional).

## Perhitungan storage dan biaya operasional

Estimasi storage harus memakai formula: `jumlah job × (video + audio + image source + preview + manifest + log + backup) × retention`. Angka “ratusan video” tidak boleh digunakan tanpa bitrate dan retention yang ditentukan.

Bandwidth harus memperhitungkan unduhan media, unggahan hasil ke Telegram atau artifact storage, retry, dan backup.

## Peringatan Biaya Tersembunyi
- Listrik komputer jika n8n berjalan 24/7 (bisa diestimasi ~Rp 50.000–150.000/bulan tergantung tarif dan penggunaan PC).
- Kuota internet untuk unduh gambar dan upload video ke Telegram/TikTok.
- Biaya waktu untuk review hasil sebelum posting (jika mode Manual Assist).
