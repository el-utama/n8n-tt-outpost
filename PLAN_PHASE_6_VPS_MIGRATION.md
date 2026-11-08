> **Status baseline:** Dokumen ini telah disinkronkan. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. MVP F1–F3 = Manual only; PostgreSQL sejak F1; belum ada implementasi.

# FASE 6 — VPS Migration: Opsional, Karena PC Sudah Cukup Kuat (Revisi Matang)

## Tujuan
Menawarkan jalan keluar jika user tidak ingin komputer pribadi menyala 24/7. Karena PC user sudah 32GB RAM + RTX 5060, lokal adalah opsi prima untuk fase awal. VPS hanya diperlukan jika ingin akses 24 jam tanpa mengandalkan PC rumah.

## Micro-Phase F6

### F6.1 — Apakah Perlu VPS?
| Kondisi | Rekomendasi |
|---------|-------------|
| PC bisa menyala 24/7, user hanya 1 orang | **Tidak perlu VPS.** Tetap lokal, biaya Rp 0 server. |
| PC sering mati/tidur, user ingin 24/7 | Pertimbangkan VPS. |
| Ingin diakses oleh beberapa orang sekaligus | Pertimbangkan VPS atau Cloudflare Tunnel ke PC lokal. |
| Jika publisher masa depan disetujui dan membutuhkan lingkungan selalu aktif | Evaluasi VPS pada saat itu; tidak diperlukan untuk MVP/F4. |

### F6.2 — Spesifikasi VPS yang Direkomendasikan (jika dipilih)
Karena RTX 5060 tidak akan ada di VPS murah, pilih salah satu:
- **CPU-only VPS 4–8 GB RAM:** Cukup untuk n8n + Ollama model kecil (3b–7b via CPU). TTS via Edge-TTS (online).
- **GPU VPS (mahal):** Hanya jika ingin model AI besar dengan akselerasi cloud. Tidak diperlukan untuk budget Rp 500rb/bulan.

Penyedia terjangkau: DigitalOcean ($6–$12/bulan), Hetzner CX21/CX31 (~Rp 100.000–200.000/bulan), Lightsail AWS ($3.5–$10/bulan).

### F6.3 — Migrasi dari Lokal ke VPS
1. Export workflow n8n dari lokal (JSON).
2. Install Docker + n8n di VPS.
3. Install Ollama di VPS (pilih model sesuai RAM VPS, bukan RTX 5060).
4. Pindahkan folder `/assets/` dan migrasikan PostgreSQL menggunakan dump/restore yang tervalidasi.
5. Konfigurasi domain + SSL (Let's Encrypt) untuk akses aman.
6. Telegram dapat tetap memakai polling atau beralih ke webhook setelah security review; perubahan mode harus mempertahankan idempotency dan secret policy.

## Deliverable F6
- Opsi pindah ke VPS jika lokal tidak mencukupi ketersediaan 24/7.
- Dokumentasi migrasi workflow n8n tanpa harus membangun dari nol.

## Biaya F6 (Estimasi)
- VPS 4–8 GB RAM: ~Rp 100.000 – 200.000/bulan.
- Domain + SSL: ~Rp 100.000/tahun (rata-rata Rp 8.300/bulan).
- Masih di bawah budget Rp 500.000/bulan.
