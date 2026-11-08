> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# FASE 2 — Content Engine: Konten hingga Video & Voiceover (Revisi Matang)

## Tujuan
Membangun mesin pembuatan konten lengkap dari satu tema input. Sistem dijamin mampu mengotomatisasi **sampai video dan voiceover**. Format output bisa berupa video MP4 atau carousel 5 gambar.

## Micro-Phase F2

### F2.1 — Modul Theme Processor (M-THEME)
Input: Tema mentah dari user (misal "kuliner Jogja", "motivasi pagi").
Proses (Ollama lokal):
- Normalisasi teks.
- Deteksi apakah tema aman (tidak SARA, dewasa, kontroversi, melanggar aturan TikTok).
Output: Tema terstruktur + kategori + tingkat risiko.

### F2.2 — Modul Content Ideation (M-RESEARCH)
Input: Tema dari M-THEME.
Proses (Ollama):
- Buat 5 sudut pandang konten menarik.
- Tentukan hook 3 detik pertama untuk retention.
- Struktur cerita dari gambar pertama hingga terakhir.
- Saran CTA (like, komentar, follow).
Output: Konten plan (judul, hook, isi, CTA, saran visual).

### F2.3 — Modul Media Sourcing (M-IMAGE)
Input: Kata kunci dari content ideation.
Proses:
- Query ke Unsplash / Pexels / Pixabay (API gratis, perlu daftar API key).
- Filter orientasi portrait (9:16) atau bisa dicrop.
- Ambil minimal 5 gambar per eksekusi.
- Unduh ke `/assets/images/`.
- Catat sumber dan photographer untuk atribusi (jika lisensi mengharuskan).
Output: 5 file gambar + metadata sumber.

### F2.4 — Modul Caption Writer (M-CAPTION)
Input: Tema + konten plan.
Proses (Ollama, Bahasa Indonesia):
- Tulis caption natural, bukan terjemahan mesin.
- Struktur: Hook → Isi → CTA → Hashtag.
- Hashtag disesuaikan tema.
- Panjang mengikuti content profile yang dikonfigurasi; batas platform-specific ditunda ke adapter masa depan.
Output: File teks caption + daftar hashtag.

### F2.5 — Modul Voiceover (M-TTS)
Input: Skrip caption atau content plan.
Opsi Engine:
| Engine | Cara Kerja | Kualitas Indonesia | Offline? | Kecepatan | Catatan |
|--------|------------|-------------------|----------|-----------|---------|
| Edge-TTS | Server Microsoft Edge | Sangat natural | Tidak | Cepat | Perlu internet, gratis |
| Piper TTS | Model lokal | Cukup natural | Ya | Sangat cepat | Tidak perlu internet |
| Coqui TTS | Model lokal (berat) | Baik | Ya | Lambat | Butuh banyak RAM/VRAM |

Rekomendasi untuk user (RTX 5060): Mulai **Edge-TTS** untuk kemudahan, opsi **Piper** jika ingin fully offline.

Output: File audio voiceover (MP3/WAV) di `/assets/audio/`.

### F2.6 — Modul Video Composer (M-VIDEO)
Input: 5 gambar + voiceover + caption teks.
Proses (FFmpeg):
- Gabung gambar menjadi video vertikal 9:16 (1080×1920).
- Tambah transisi sederhana antara gambar.
- Sinkronkan durasi gambar dengan panjang voiceover.
- Overlay teks caption di layar (disesuaikan dengan segmen suara).
- Encode via `h264_nvenc` (GPU RTX 5060) untuk kecepatan, atau libx264 (CPU) sebagai fallback.
- Export MP4, H.264, AAC, durasi 30–60 detik.
Output: File video siap posting di `/assets/videos/`.

### F2.7 — Modul Carousel Composer (M-CAROUSEL)
Input: 5 gambar + caption.
Proses:
- Susun 5 gambar dalam urutan logis.
- Setiap gambar diberi teks pelengkap ringan.
Output: 5 file gambar terurut + content package untuk adapter TikTok/Instagram/Facebook.

## Deliverable F2
Satu tema input menghasilkan salah satu dari:
- **Video MP4** (9:16) + voiceover + caption + hashtag, atau
- **Carousel 5 gambar** + caption + hashtag.

Semua file tersimpan terstruktur di `/assets/` dan tercatat di PostgreSQL beserta artifact manifest.

## Catatan Biaya F2
- Rp 0 (Ollama lokal, Edge-TTS/Piper gratis, FFmpeg lokal, Unsplash/Pexels gratis).
