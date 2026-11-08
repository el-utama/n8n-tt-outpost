> **Status baseline:** ROADMAP PRODUK FINAL. Sumber kebenaran AI: `00_AI_SOURCE_OF_TRUTH.md`. F5 belum diimplementasikan; MVP F1–F3 tetap Manual-only.

# FASE 5 — Agentic Publisher dan Cross-Post Adapters

## 1. Tujuan produk final

F5 mengubah paket konten hasil F2–F4 menjadi publishing agentik yang dapat mengirim konten ke TikTok, Instagram, dan Facebook. Asset visual utama—gambar/video dan voiceover—dapat digunakan bersama, tetapi payload metadata dan aturan delivery diproses oleh adapter masing-masing platform.

F5 tidak boleh dimulai sebagai implementasi hanya karena user memilih mode. F5 membutuhkan review compliance, security, authentication/session, recovery, observability, dan acceptance criteria per platform.

## 2. Tiga mode publishing

| Mode | Eligibility berbasis umur TikTok | Perilaku user dan agent |
|---|---|---|
| **Manual** | Semua umur akun | Agent membuat paket konten; user posting sendiri. |
| **Semi-Auto** | TikTok age ≥31 hari | Agent mengunggah satu batch; user memberi approval per batch dan memonitor hasil. |
| **Full-Auto** | TikTok age ≥90 hari | Agent menjadwalkan dan publish sesuai policy limits yang ditetapkan user; user memiliki emergency stop. |

Umur akun TikTok adalah gate utama untuk eligibility otomatis. Untuk tanggal yang hanya diinput user dan tidak diverifikasi, sistem menyimpan status `unverified` dan dapat menerapkan policy konservatif atau menolak mode otomatis.

Umur akun TikTok bukan jaminan bahwa publisher aman. Platform adapter, session health, policy profile, approval state, quota, dan emergency stop harus lulus sebelum publish.

## 3. Semi-Auto per batch

Semi-Auto tidak meminta approval untuk setiap posting individual. Agent membentuk batch berdasarkan content profile dan jadwal, lalu mengirim ringkasan untuk approval user.

Ringkasan batch sekurang-kurangnya memuat jumlah item, platform tujuan, jadwal, caption/metadata per platform, media preview, dan estimasi penggunaan quota. Jika user menolak batch, agent tidak boleh mengunggah item di dalam batch tersebut.

## 4. Full-Auto policy profile

Full-Auto hanya dapat diaktifkan setelah user menetapkan dan mengonfirmasi policy profile, sekurang-kurangnya:

- tanggal mulai;
- berapa hari policy berlaku;
- maksimum posting per hari per platform dan gabungan;
- minimum jarak antar-post dalam menit;
- time window harian;
- hari aktif/nonaktif;
- platform yang aktif;
- maximum batch/content quota;
- retry limit dan perilaku saat error;
- aturan duplicate prevention;
- emergency stop dan siapa yang berwenang mengaktifkannya.

Agent wajib melakukan preflight sebelum setiap batch dan setiap publish. Jika tanggal policy habis, quota tercapai, interval belum terpenuhi, session invalid, adapter tidak sehat, atau emergency stop aktif, publish harus ditunda atau ditolak.

## 5. Cross-post adapter

Satu content package menghasilkan shared visual asset, tetapi adapter membuat payload platform-specific.

| Komponen | TikTok | Instagram | Facebook |
|---|---|---|---|
| Media visual | Mengikuti media contract TikTok | Mengikuti media contract Instagram | Mengikuti media contract Facebook |
| Caption/description | Aturan TikTok | Aturan Instagram | Aturan Facebook |
| Title | Jika didukung oleh payload | Tidak diasumsikan tersedia; jangan kirim field title secara otomatis | Ditentukan adapter jika tersedia |
| Hashtag/tag | Limit dan syntax TikTok | Limit dan syntax Instagram | Limit dan syntax Facebook |
| Mention/privacy/schedule | Adapter-specific | Adapter-specific | Adapter-specific |
| Error/retry | Error taxonomy TikTok | Error taxonomy Instagram | Error taxonomy Facebook |

Adapter tidak boleh menyalin payload TikTok mentah ke Instagram atau Facebook. Setiap adapter wajib memvalidasi field, panjang, jumlah tag, media type, durasi, ukuran, privacy, scheduling, dan response sebelum menandai publish berhasil.

## 6. Authentication dan session

F5 harus memprioritaskan API atau jalur resmi yang tersedia. Jika integrasi resmi tidak tersedia, keputusan penggunaan mekanisme lain harus melalui review compliance dan security terlebih dahulu.

Session material tidak boleh disimpan sebagai credential plaintext di workflow atau log. Rancangan harus mencakup encryption at rest, key separation, access control, TTL, rotation, revoke/logout, 2FA/CAPTCHA handoff, dan session expiry recovery.

## 7. Recovery dan idempotency

Publisher wajib memiliki:

- publish intent dengan unique idempotency key;
- status `PENDING`, `APPROVED`, `UPLOADING`, `PUBLISHED`, `FAILED_RETRYABLE`, `FAILED_FINAL`, dan `CANCELLED`;
- pencegahan duplicate post saat timeout atau retry;
- audit record per platform;
- human-visible error dan recovery action;
- emergency stop yang mencegah batch baru dan menghentikan pekerjaan yang dapat dihentikan.

## 8. Deliverable F5

F5 baru dianggap siap bila tersedia:

1. adapter TikTok, Instagram, dan Facebook yang terpisah;
2. age gate TikTok dengan status verified/unverified;
3. Semi-Auto batch approval;
4. Full-Auto policy profile dan preflight limits;
5. emergency stop;
6. session/security design;
7. platform-specific acceptance criteria;
8. duplicate prevention dan recovery test;
9. compliance/security go-no-go decision;
10. observability dan audit trail.

## 9. Status implementasi

Tidak ada bagian F5 yang aktif dalam MVP. Dokumen ini hanya mendefinisikan target produk final dan syarat pembukaannya.
