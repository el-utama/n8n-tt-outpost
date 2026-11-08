> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# FASE 1 — Foundation: Setup Lokal n8n + Ollama + FFmpeg (Revisi Matang)

## Tujuan
Menyiapkan environment n8n di komputer lokal dengan akselerasi GPU (RTX 5060) dan AI lokal (Ollama), tanpa user perlu menentukan spesifikasi manual. Semua konfigurasi menyesuaikan hardware yang sudah ada (32GB RAM, i7-14700F, RTX 5060).

## Micro-Phase F1

### F1.1 — Deteksi & Konfigurasi Otomatis (berdasarkan hardware user)
Karena spesifikasi sudah diketahui, skrip setup akan:
- Deteksi OS (Windows 10/11 diutamakan).
- Deteksi RAM dan uji resource terhadap kandidat model Ollama 7B–8B dengan GPU offload.
- Deteksi GPU NVIDIA dan status runtime/CUDA; gunakan GPU hanya jika probe berhasil.
- Pilih candidate model seperti `qwen2.5:7b` atau `llama3.1:8b` berdasarkan availability, benchmark, memory pressure, dan fallback policy.
- Pilih deploy n8n: Docker Desktop (Windows) karena RAM melimpah.

**Tabel Rekomendasi Model untuk Spesifikasi User:**

| Model Ollama | VRAM Estimasi | Kecepatan (RTX 5060) | Kualitas Bahasa Indonesia | Digunakan untuk |
|--------------|---------------|----------------------|---------------------------|-----------------|
| `qwen2.5:0.5b` | ~0.5 GB | Sangat cepat | Cukup (sederhana) | Fallback jika error |
| `qwen2.5:3b` | ~2 GB | Cepat | Baik | Caption ringan |
| `qwen2.5:7b` | ~5 GB | Sedang | Baik–Sangat baik | Caption dan content ideation candidate |
| `llama3.1:8b` | ~5 GB | Sedang | Baik | Alternatif default |

### F1.2 — Instalasi Dependensi (Windows)
1. **Docker Desktop** + WSL2 backend (untuk n8n terisolasi).
2. **Ollama** (installer Windows) + pull model default dengan GPU support.
3. **FFmpeg** (build release dengan `h264_nvenc` untuk encoding video via GPU, opsional).
4. **Python** (untuk Edge-TTS / Piper dan skrip pendukung).
5. **PostgreSQL** (database utama untuk state job, ownership, queue, dan recovery).

Struktur folder:
```
C:\n8n-tt-outpost\
  ├── docker-compose.yml
  ├── .env
  ├── setup-auto.ps1       # PowerShell setup otomatis (Windows)
  ├── workflows\           # JSON workflow n8n
  ├── modules\             # Sub-workflow modular
  ├── assets\
  │     ├── images\
  │     ├── videos\
  │     ├── audio\
  │     └── captions\
  ├── config\
  │     ├── auto-config.json   # Hasil deteksi hardware
  │     └── migrations/         # Schema PostgreSQL dan migration versioning
  └── logs\
```

### F1.3 — Telegram: Webhook vs Polling di Lokal
- Komputer lokal biasanya tidak memiliki IP publik statis. Telegram Webhook butuh URL publik.
- **Solusi Fase 1:** Gunakan satu Telegram polling consumer dengan cursor/update ID persisten, idempotency, dan lock. Tidak perlu ngrok.
- **Solusi Opsional:** Jika ingin webhook real-time, pakai ngrok atau Cloudflare Tunnel sebagai jembatan publik ke localhost:5678.

### F1.4 — Verifikasi Setup
- n8n accessible di `http://localhost:5678`
- Ollama merespons di `http://localhost:11434` dengan model terpilih
- FFmpeg dapat dijalankan dari command prompt
- Telegram bot dapat menerima pesan via polling

## Deliverable F1
- Komputer lokal siap menjalankan n8n + Ollama (GPU) + FFmpeg.
- File `auto-config.json` menyimpan konfigurasi hardware yang terdeteksi.
- Database PostgreSQL siap untuk state job, ownership, dan account metadata.

## Catatan Biaya F1
- Rp 0 (semua open source, menggunakan PC yang sudah ada).
- Biaya listrik & internet sesuai penggunaan rumah.
