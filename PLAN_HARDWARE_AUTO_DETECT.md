> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# HARDWARE AUTO-DETECT — Logika Deteksi & Konfigurasi (Revisi Matang)

## Tujuan
User tidak perlu ditanya tentang CPU, RAM, GPU. Sistem mengetahui spesifikasi yang sudah ada dan menyesuaikan konfigurasi otomatis.

## Spesifikasi yang Sudah Diketahui (User)
- **RAM:** 32 GB
- **CPU:** Intel Core i7-14700F (20 core, 28 thread)
- **GPU:** NVIDIA RTX 5060 (CUDA capable, estimated 8 GB VRAM)
- **OS:** Dianggap Windows 10/11

Dengan spesifikasi ini, deteksi otomatis menghasilkan candidate baseline tanpa meminta input hardware manual. Konfigurasi final dipilih setelah capability probe dan benchmark ringan.

## Hasil Deteksi Otomatis (`auto-config.json`)

```json
{
  "detected_at": "runtime-generated",
  "os": "windows",
  "ram_gb": 32,
  "cpu_cores": 20,
  "gpu": "nvidia_rtx_5060",
  "gpu_vram_gb": 8,
  "cuda_available": true,
  "disk_free_gb": 200,
  "n8n_deploy": "docker",
  "ollama_model": "qwen2.5:7b",
  "ollama_gpu_layers": "probe_or_runtime_default",
  "tts_engine": "edge-tts",
  "ffmpeg_encoder": "h264_nvenc",
  "max_concurrent_jobs": "probe_limited",
  "daily_post_limit": null,
  "telegram_mode": "polling"
}
```

## Matriks Keputusan Otomatis (Spesifik untuk User ini)

| Komponen | Pilihan Otomatis | Alasan |
|----------|-----------------|--------|
| Deploy n8n | Docker Desktop + WSL2 | RAM 32GB cukup untuk overhead Docker, isolasi baik |
| Ollama Model | Candidate `qwen2.5:7b` | Dipilih hanya jika probe resource, model availability, dan benchmark memenuhi threshold |
| Ollama GPU Layers | Ditentukan capability probe/runtime | Tidak hard-coded; simpan hasil probe dan fallback |
| TTS Engine | Edge-TTS | Mudah setup di Windows, suara Indonesia natural, gratis |
| TTS Fallback | Piper TTS | Jika internet terputus atau Edge-TTS error |
| FFmpeg Encoder | `h264_nvenc` | Akselerasi GPU RTX 5060, encoding video lebih cepat |
| FFmpeg Fallback | `libx264` (CPU) | Jika NVENC tidak tersedia atau error |
| Max Concurrent Jobs | Hasil probe + benchmark ringan | Dibatasi oleh memory pressure dan queue |
| Daily Post Limit | Tidak berlaku pada MVP Manual only | Jika diperlukan nanti, disebut guardrail internal |
| Telegram Mode | Polling | Lokal tidak punya IP publik untuk webhook |

## Implementasi Deteksi (Rencana Teknis)
Skrip setup (`setup-auto.ps1` untuk Windows) akan:
1. Cek RAM via `Get-CimInstance Win32_PhysicalMemory`.
2. Cek CPU via `Get-CimInstance Win32_Processor`.
3. Cek GPU via `Get-CimInstance Win32_VideoController` (deteksi NVIDIA).
4. Cek CUDA via `nvidia-smi` atau Ollama built-in deteksi.
5. Cek ruang disk via `Get-PSDrive C`.
6. Jalankan probe model/encoder dan benchmark ringan dengan timeout.
7. Menulis hasil, fallback reason, dan confidence ke `config/auto-config.json`.
8. n8n membaca file ini untuk menentukan model Ollama, encoder FFmpeg, dan batas job bersamaan.

## Jika Hardware Berubah
User dapat menjalankan ulang skrip deteksi. `auto-config.json` akan ditimpa dan n8n akan menyesuaikan pada restart workflow.

## Batasan
- Deteksi asumesi Windows. Jika user beralih ke Linux, skrip perlu disesuaikan (bash script dengan `lshw`, `dmidecode`, `nvidia-smi`).
- Model Ollama yang terpilih dapat diubah manual di `auto-config.json` jika user ingin model lebih kecil atau lebih besar.
