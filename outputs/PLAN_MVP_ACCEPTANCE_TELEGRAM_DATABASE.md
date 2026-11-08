# RANCANGAN ACCEPTANCE CRITERIA MVP F1–F3

**Proyek:** n8n-tt-outpost  
**Tanggal:** 2026-11-07  
**Scope:** Foundation, Content Engine, dan Telegram Interface  
**Mode posting MVP:** Manual only  
**Rekomendasi database:** PostgreSQL sebagai database utama

**Timezone baseline:** `Asia/Jakarta` untuk scheduler, retention, umur metadata, dan audit timestamps.

**Artifact reference:** gunakan logical ID seperti `artifact://<artifact_id>` dan `asset://<asset_id>`; physical path deployment tidak boleh berasal dari input user.

---

## 1. Batasan dan definisi MVP

MVP F1–F3 dianggap sebagai sistem yang dapat menerima tema dari Telegram, memprosesnya menjadi konten, menghasilkan video vertikal dengan voiceover, lalu mengirim hasilnya kembali kepada user melalui Telegram.

MVP **tidak mencakup**:

- login atau upload otomatis ke TikTok/Instagram;
- browser automation publisher;
- Semi-Auto atau Full-Auto posting;
- riset web faktual real-time;
- multi-tenant terbuka tanpa allowlist;
- dashboard web sebagai komponen wajib.

Mode akun pada MVP hanya `Manual`. Data akun dapat disiapkan untuk kompatibilitas fase berikutnya, tetapi tidak boleh memicu auto-posting.

## 2. Status job yang wajib

Semua job harus menggunakan state machine yang eksplisit:

```text
RECEIVED
  → VALIDATING
  → GENERATING_IDEATION
  → SOURCING_MEDIA
  → GENERATING_CAPTION
  → GENERATING_TTS
  → COMPOSING_VIDEO
  → VALIDATING_ARTIFACT
  → DELIVERING
  → COMPLETED
```

State kegagalan dan kontrol:

```text
ANY_STATE → FAILED_RETRYABLE
ANY_STATE → FAILED_FINAL
ANY_STATE → CANCEL_REQUESTED → CANCELLED
```

Setiap perubahan state wajib menyimpan `job_id`, `user_id`, `step`, `attempt`, `timestamp`, dan pesan error terstruktur.

---

# 3. Acceptance Criteria F1 — Foundation

## F1.1 Deteksi hardware dan konfigurasi

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F1-AC-01 | Setup dapat mendeteksi OS, RAM, jumlah logical processor, GPU, ruang disk, dan ketersediaan `nvidia-smi` tanpa meminta user memasukkan spesifikasi manual. | Jalankan setup pada komputer target dan periksa `config/auto-config.json`. |
| F1-AC-02 | Hasil deteksi menyimpan timestamp, versi skrip, status setiap probe, dan alasan fallback jika probe gagal. | Matikan/ubah salah satu dependency lalu jalankan ulang setup. |
| F1-AC-03 | Sistem tidak gagal hanya karena GPU atau NVENC tidak tersedia; sistem memilih fallback CPU yang terdokumentasi. | Jalankan smoke test dengan encoder GPU dinonaktifkan. |
| F1-AC-04 | Concurrency tidak hanya menggunakan angka hard-coded; setup menghasilkan nilai awal berdasarkan probe dan menyediakan batas maksimum yang aman. | Periksa konfigurasi dan jalankan job paralel terbatas. |
| F1-AC-05 | Konfigurasi hardware dapat dibuat ulang tanpa menghapus database job atau asset yang sudah ada. | Jalankan setup dua kali dan bandingkan data persistent. |

## F1.2 n8n, PostgreSQL, dan runtime

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F1-AC-06 | n8n dapat dijalankan melalui Docker Compose dan dapat diakses hanya pada interface yang direncanakan; port database tidak diekspos publik. | Periksa container, port binding, dan akses dari host lain. |
| F1-AC-07 | PostgreSQL memiliki volume persistent, healthcheck, user database non-superuser untuk aplikasi, dan password dari secret/environment. | Hentikan/start container dan periksa data tetap ada. |
| F1-AC-08 | n8n, PostgreSQL, Ollama, dan FFmpeg memiliki healthcheck atau probe yang menghasilkan status `healthy`/`unhealthy` yang dapat ditindaklanjuti. | Simulasikan service mati dan periksa status/log. |
| F1-AC-09 | n8n dapat terhubung ke PostgreSQL dan menulis/membaca satu record job uji. | Jalankan workflow database smoke test. |
| F1-AC-10 | Workflow tidak menyimpan token Telegram, API key media, password database, atau secret lain sebagai plaintext di JSON workflow atau repository. | Scan workflow/export dan repository. |
| F1-AC-11 | Restart n8n tidak menghilangkan workflow, credential reference, database, atau konfigurasi persistent. | Restart seluruh stack lalu ulangi smoke test. |

## F1.3 Ollama dan FFmpeg

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F1-AC-12 | Ollama merespons health endpoint dan model yang dipilih dapat menghasilkan output teks dalam batas timeout yang ditentukan. | Jalankan prompt smoke test dan catat latency. |
| F1-AC-13 | Model fallback yang lebih kecil dapat dipilih jika model utama gagal, timeout, atau resource tidak cukup. | Simulasikan model utama tidak tersedia. |
| F1-AC-14 | FFmpeg dapat membaca input, menghasilkan output MP4 uji, dan melaporkan versi/encoder yang digunakan. | Jalankan command test dan inspect metadata output. |
| F1-AC-15 | Jika `h264_nvenc` gagal, pipeline otomatis mencoba `libx264` dan menyimpan alasan fallback pada log job. | Paksa encoder GPU gagal dan periksa hasil. |
| F1-AC-16 | Temporary files memiliki lokasi terpisah dari output final dan dibersihkan setelah job selesai atau gagal final. | Periksa folder sebelum/sesudah job. |

## F1.4 Reliability dan recovery

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F1-AC-17 | Job yang berhenti karena restart dapat dikenali sebagai interrupted dan tidak menghasilkan duplikasi artifact tanpa penanda. | Hentikan worker di tengah job lalu hidupkan kembali. |
| F1-AC-18 | Setiap langkah memiliki timeout, jumlah retry maksimum, dan klasifikasi retryable/final. | Simulasikan timeout dan error permanen. |
| F1-AC-19 | Log memuat `job_id` dan step sehingga satu kegagalan dapat ditelusuri dari input sampai output. | Cari seluruh log berdasarkan job ID. |
| F1-AC-20 | Backup database dasar dapat dibuat dan berhasil direstore ke instance pengujian. | Jalankan backup/restore test sebelum Gate F1. |

### Definition of Done F1

F1 selesai jika seluruh AC F1-AC-01 sampai F1-AC-20 lulus, tidak ada secret plaintext, service dapat restart tanpa kehilangan state, dan smoke test menghasilkan artifact uji menggunakan GPU atau fallback CPU.

---

# 4. Acceptance Criteria F2 — Content Engine

## F2.1 Input dan content plan

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F2-AC-01 | Tema kosong, terlalu panjang, atau mengandung input tidak valid ditolak dengan pesan yang jelas sebelum job dibuat. | Kirim variasi input invalid. |
| F2-AC-02 | Tema valid dinormalisasi dan disimpan bersama versi prompt/model yang digunakan. | Periksa record job dan manifest. |
| F2-AC-03 | Output content plan memiliki schema valid: title, hook, body/scene plan, CTA, caption draft, dan keyword media. | Validasi terhadap JSON schema. |
| F2-AC-04 | Sistem melabeli output sebagai ideation/unverified bila tidak menggunakan sumber eksternal yang dapat diverifikasi. | Periksa metadata plan pada job. |
| F2-AC-05 | Tema berisiko tinggi ditolak atau ditandai untuk review manual berdasarkan policy yang terdokumentasi. | Uji tema yang masuk daftar policy. |

## F2.2 Media sourcing

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F2-AC-06 | Sistem memperoleh minimal lima asset valid atau menghasilkan status `FAILED_RETRYABLE`/`FAILED_FINAL` yang jelas tanpa membuat video rusak. | Uji tema umum dan tema dengan hasil pencarian minim. |
| F2-AC-07 | Setiap asset menyimpan provider, asset ID, source URL, author bila tersedia, license/terms URL, waktu unduh, dan hash file. | Periksa artifact manifest. |
| F2-AC-08 | File asset diverifikasi sebagai image yang dapat dibaca dan tidak hanya berdasarkan ekstensi. | Jalankan image decode/metadata validation. |
| F2-AC-09 | Rate limit, timeout, HTTP error, dan provider kosong memiliki retry/backoff serta fallback provider yang jelas. | Simulasikan error provider. |
| F2-AC-10 | Asset duplikat berdasarkan hash atau URL tidak dihitung sebagai lima gambar berbeda. | Uji hasil provider dengan duplikasi. |
| F2-AC-11 | Tidak ada klaim “bebas hak cipta” tanpa metadata terms/license yang tersimpan. | Periksa manifest pada output. |

## F2.3 Caption dan voiceover

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F2-AC-12 | Caption menghasilkan struktur hook, isi, CTA, dan hashtag dalam Bahasa Indonesia sesuai batas panjang yang dikonfigurasi. | Validasi schema dan character count. |
| F2-AC-13 | Caption tidak memasukkan placeholder model, JSON mentah, atau instruksi internal. | Jalankan output lint. |
| F2-AC-14 | TTS menghasilkan file audio yang dapat diputar dengan sample rate/duration metadata yang valid. | Decode audio dan periksa durasi. |
| F2-AC-15 | Jika Edge-TTS gagal, sistem mencoba Piper atau menandai job gagal dengan alasan yang dapat ditindaklanjuti. | Simulasikan koneksi TTS gagal. |
| F2-AC-16 | Audio voiceover tidak kosong, tidak terpotong di awal/akhir, dan durasinya berada dalam batas MVP. | Dengarkan sampel dan validasi waveform/duration. |

## F2.4 Video composer

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F2-AC-17 | Output berupa MP4 yang dapat diputar menggunakan H.264 video dan AAC audio. | Jalankan `ffprobe` dan playback test. |
| F2-AC-18 | Rasio output 9:16 dan dimensi target 1080×1920, atau dimensi fallback yang terdokumentasi jika resource tidak cukup. | Periksa metadata video. |
| F2-AC-19 | Durasi video mengikuti voiceover dalam toleransi yang ditentukan dan tidak memotong audio secara prematur. | Bandingkan durasi audio/video. |
| F2-AC-20 | Semua image memiliki framing yang tidak merusak subjek utama dan tidak menyebabkan area kosong yang tidak direncanakan. | Review visual pada test set. |
| F2-AC-21 | Teks overlay tidak keluar frame, tidak saling menimpa, dan tetap terbaca pada perangkat mobile. | Review pada resolusi target dan preview mobile. |
| F2-AC-22 | Video yang gagal validasi tidak dikirim sebagai “selesai”; status job menjadi failed dengan error code. | Rusak/ubah input dan periksa delivery. |
| F2-AC-23 | Sistem menghasilkan manifest yang menghubungkan job dengan video, audio, caption, hashtag, thumbnail, dan metadata sumber. | Periksa manifest final. |

## F2.5 Pengujian pipeline

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F2-AC-24 | Minimal 20 tema uji menghasilkan metrik sukses/gagal per step. | Jalankan test batch terkontrol. |
| F2-AC-25 | Setidaknya satu test mencakup tema non-ASCII, tanda baca, dan teks panjang. | Jalankan input Bahasa Indonesia nyata. |
| F2-AC-26 | Pengulangan job dengan `idempotency_key` yang sama tidak menggandakan record final tanpa keputusan eksplisit untuk regenerate. | Jalankan request identik dua kali. |
| F2-AC-27 | Artefact final tetap dapat diambil setelah worker restart. | Restart service setelah compose selesai. |

### Definition of Done F2

F2 selesai jika seluruh AC F2-AC-01 sampai F2-AC-27 lulus pada test set, video dan voiceover tervalidasi, metadata sumber tersedia, fallback berjalan, dan tidak ada artifact korup yang dikirim ke user.

---

# 5. Acceptance Criteria F3 — Telegram Interface

## F3.1 Keamanan dan onboarding

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F3-AC-01 | Bot hanya merespons Telegram user/chat ID yang berada dalam allowlist atau telah melalui onboarding yang disetujui admin. | Uji user terdaftar dan tidak terdaftar. |
| F3-AC-02 | Setiap perintah memeriksa ownership terhadap user, job, account, dan artifact yang diminta. | Coba akses job milik user lain. |
| F3-AC-03 | Token bot disimpan melalui secret/environment dan tidak muncul pada pesan, log, export workflow, atau error stack. | Scan seluruh output dan log. |
| F3-AC-04 | Input command dibatasi ukuran, rate, dan karakter berbahaya; input tidak dapat menentukan path file atau menjalankan command arbitrary. | Uji path traversal, shell metacharacter, dan spam. |
| F3-AC-05 | Perintah sensitif seperti reset, hapus data, dan perubahan konfigurasi memerlukan otorisasi tambahan atau belum tersedia di MVP. | Uji command authorization. |

## F3.2 Perintah bot

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F3-AC-06 | `/start` menampilkan fungsi MVP, batasan Manual only, contoh `/post`, serta cara meminta bantuan. | Uji pada chat baru. |
| F3-AC-07 | `/post <tema>` membuat tepat satu job idempotent untuk satu request yang valid dan membalas `job_id`. | Kirim satu dan dua update identik. |
| F3-AC-08 | `/status` menampilkan state, step, progress, waktu update, dan error yang aman dibaca user tanpa membocorkan secret/path sensitif. | Uji selama job berjalan dan setelah gagal. |
| F3-AC-09 | `/download` hanya mengirim artifact milik user yang telah berstatus completed dan belum melewati retention. | Uji completed, failed, expired, dan foreign job. |
| F3-AC-10 | `/batal` mengubah job menjadi `CANCEL_REQUESTED`, menghentikan proses yang dapat dihentikan, dan mengonfirmasi hasil akhir. | Batalkan pada setiap step utama. |
| F3-AC-11 | `/account` pada MVP hanya mengelola metadata akun; tidak memulai login atau auto-posting. | Uji command dan audit side effect. |
| F3-AC-12 | `/mode` hanya menerima `manual`; mode lain ditolak dengan penjelasan bahwa publisher belum aktif. | Coba manual, semi, dan full. |

## F3.3 Update, polling, dan delivery

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F3-AC-13 | Telegram update diproses oleh satu consumer aktif atau mekanisme distributed lock yang mencegah double processing. | Jalankan restart/dua worker dan periksa duplicate job. |
| F3-AC-14 | `update_id`/cursor disimpan secara persisten sehingga restart tidak memproses pesan lama dua kali dan tidak melewati pesan valid. | Simulasikan restart pada beberapa posisi update. |
| F3-AC-15 | Timeout, HTTP error, Telegram rate limit, dan network disconnect menggunakan retry dengan backoff dan tidak membuat duplicate delivery tak terkendali. | Simulasikan error/respons rate limit. |
| F3-AC-16 | File video besar menggunakan kebijakan delivery yang dikonfigurasi: upload langsung jika memenuhi limit aktual atau secure download link ber-expiry. | Uji file kecil dan besar. |
| F3-AC-17 | Link download tidak membuka directory listing, memiliki expiry, memeriksa ownership, dan tidak menebak path file. | Uji akses tanpa token, token expired, dan token user lain. |
| F3-AC-18 | Pesan final mencantumkan video/link, caption, hashtag, sumber asset, status Manual, dan job ID. | Periksa pesan final. |
| F3-AC-19 | Pesan progress tidak membanjiri chat; update digabung atau dibatasi frekuensinya. | Jalankan job panjang dan hitung jumlah pesan. |
| F3-AC-20 | Error user-facing menggunakan bahasa Indonesia yang jelas dan menyediakan tindakan berikutnya tanpa menampilkan stack trace. | Uji setiap kategori error utama. |

## F3.4 Pengujian interface

| ID | Acceptance criterion | Cara verifikasi |
|---|---|---|
| F3-AC-21 | Minimal 10 skenario end-to-end diuji: sukses, input invalid, model timeout, media gagal, TTS fallback, FFmpeg fallback, cancel, restart, file besar, dan unauthorized access. | Jalankan test matrix dan simpan hasil. |
| F3-AC-22 | Dua job dari user yang sama tidak saling menimpa asset atau state. | Jalankan dua tema bersamaan. |
| F3-AC-23 | Job user A dan user B tidak dapat membaca atau memodifikasi data satu sama lain. | Jalankan isolated multi-user test. |
| F3-AC-24 | Backup/restore tidak merusak ownership, state job, manifest, atau expiry artifact. | Restore ke environment test lalu uji command. |

### Definition of Done F3

F3 selesai jika seluruh AC F3-AC-01 sampai F3-AC-24 lulus, hanya mode Manual aktif, tidak ada cross-user access, polling/update tidak menggandakan job, dan user dapat menerima hasil konten end-to-end.

---

# 6. Mitigasi risiko otomatisasi Telegram

## 6.1 Arsitektur operasional yang direkomendasikan

Gunakan alur berikut:

```text
Telegram Bot API
    ↓
Single update consumer / distributed lock
    ↓
Input validation + allowlist + idempotency
    ↓
Persistent job record di PostgreSQL
    ↓
Worker queue
    ↓
Content pipeline
    ↓
Artifact manifest + ownership check
    ↓
Telegram delivery / expiring download link
```

Pisahkan **update consumer** dari worker content. Consumer tidak boleh menjalankan pekerjaan berat secara langsung; tugasnya hanya validasi, membuat job, dan memberi acknowledgment.

## 6.2 Risk register dan mitigasi

| Risiko | Dampak | Mitigasi wajib | Bukti lulus |
|---|---|---|---|
| Bot token bocor | Pengambilalihan bot dan penyalahgunaan quota | Secret environment, permission terbatas, jangan masuk Git/log, rotasi dan revoke procedure | Secret scan bersih dan token dapat dirotasi |
| User tidak sah mengakses bot | Pembuatan job/ambil file tanpa izin | Allowlist chat ID, onboarding admin, ownership check per query | Unauthorized test ditolak |
| Pesan diproses dua kali | Duplikasi job dan biaya/resource terbuang | Simpan `update_id`, idempotency key, unique constraint | Replay update tidak membuat job baru |
| Pesan terlewat setelah restart | Request user hilang | Cursor/offset persistent, transaction sebelum acknowledgment | Restart test tidak melewati update |
| Dua consumer aktif | Race condition dan duplicate processing | Satu consumer atau PostgreSQL advisory/distributed lock | Dual-worker test menghasilkan satu processing |
| Telegram rate limit | Delivery tertunda atau gagal | Retry exponential backoff, jitter terbatas, message coalescing, queue delivery | Simulasi 429 pulih tanpa spam |
| Network disconnect | Job dianggap gagal padahal masih berjalan | Timeout terpisah untuk API call dan job, retry bounded, status pending | Putus koneksi tidak menggandakan job |
| Polling tidak stabil | Update delay atau offset salah | Satu proses polling, cursor metric, healthcheck, alert jika stale | Alert muncul saat polling stale |
| File terlalu besar | Video tidak terkirim | Ukur ukuran sebelum delivery; direct send atau expiring secure link | Test file kecil/besar lulus |
| Link file dapat ditebak | Kebocoran asset | Token acak, expiry, ownership check, no directory listing | Token user lain ditolak |
| Path traversal | Pembacaan file lokal arbitrer | Artifact ID, bukan path user; allowlist root; canonical path check | Payload traversal ditolak |
| Command injection | Eksekusi command di host/container | Jangan interpolasi input ke shell; argument array; validasi schema | Fuzz test tidak mengeksekusi command |
| Input spam | Queue penuh dan PC kehabisan resource | Per-user rate limit, global concurrency, max queue depth, cooldown | Flood test tetap bounded |
| Tema prompt injection | Model menghasilkan instruksi atau output tidak sesuai | Pisahkan system/developer prompt dari tema, schema output, sanitization, content policy | Prompt injection test tidak mengubah policy |
| Error stack bocor | Secret/path/internal data terungkap | Error mapping user-facing dan internal structured log terpisah | Pesan user tidak berisi stack trace |
| `/batal` tidak efektif | Resource terus berjalan dan disk penuh | Cancellation state, process group termination, cleanup job | Cancel test membersihkan process/temp |
| Worker mati di tengah proses | Job menggantung | Heartbeat, lease timeout, orphan recovery, retry policy | Job stale dipulihkan/ditandai gagal |
| Database penuh/terkunci | Bot tidak dapat membuat job | Disk alert, quota, PostgreSQL pool limit, cleanup retention | Simulasi disk/DB unavailable tertangani |
| Artifact tertinggal | Kebocoran privasi dan storage bengkak | Retention per asset, cleanup scheduler, delete-on-request | Expired asset tidak dapat diunduh |
| Webhook/polling salah konfigurasi | Tidak ada update atau update ganda | Pilih satu mode, dokumentasikan endpoint/status, healthcheck | Mode aktif dapat diverifikasi |
| Bot dibanjiri pesan progress | Chat user tidak usable dan rate limit | Progress throttling, edit message bila memungkinkan, final summary | Jumlah pesan dibatasi |

## 6.3 Urutan mitigasi sebelum go-live MVP

1. Buat bot token baru atau pastikan token saat ini tidak pernah masuk repository.
2. Tetapkan `TELEGRAM_ALLOWED_CHAT_IDS` dan satu admin bootstrap.
3. Implementasikan satu update consumer aktif dengan cursor persisten.
4. Tambahkan tabel/idempotency constraint untuk Telegram update dan request.
5. Tambahkan per-user/global rate limit dan batas queue.
6. Implementasikan ownership check pada semua operasi job/artifact.
7. Pisahkan secret/internal log dari pesan user.
8. Implementasikan delivery file besar dengan token expiry.
9. Implementasikan cancellation, orphan recovery, dan cleanup.
10. Jalankan test unauthorized, replay, restart, rate-limit, disconnect, file besar, dan path traversal.
11. Aktifkan alert jika polling stale, queue penuh, disk rendah, atau error rate meningkat.
12. Baru setelah semua test lulus, buka penggunaan MVP untuk user yang di-allowlist.

## 6.4 SLO minimum untuk MVP

- Tidak ada unauthorized access pada test matrix.
- Replay update yang sama menghasilkan **0 duplicate job**.
- Tidak ada kehilangan update pada restart test yang terkontrol.
- Tidak ada secret pada log, pesan, workflow export, atau repository.
- Queue tetap bounded saat menerima input melebihi kapasitas.
- Artifact expired tidak dapat diakses.
- Semua failure final memiliki job ID dan error code.

---

# 7. Konflik PostgreSQL vs SQLite

## 7.1 Mengapa konflik muncul

Dokumen saat ini menyebut tiga arah berbeda:

1. `PLAN_MASTER.md` mengarahkan ke PostgreSQL + state database.
2. `PLAN_PHASE_1_FOUNDATION.md` memilih SQLite karena file tunggal dan setup sederhana.
3. `PLAN_REVISI_FINAL.md` merekomendasikan PostgreSQL, dengan SQLite sebagai fallback.

Konflik ini memengaruhi schema, locking, queue, backup, deployment, serta desain multi-user. Keputusan harus dibuat sebelum F1 agar workflow tidak dibangun dengan asumsi storage yang berubah di tengah jalan.

## 7.2 Perbandingan teknis

| Aspek | PostgreSQL | SQLite |
|---|---|---|
| Model | Database server/client | Embedded file database |
| Setup | Lebih banyak konfigurasi/container | Sangat sederhana |
| Concurrent writes | Baik dengan transaction dan row-level behavior | Terbatas; satu writer pada satu waktu |
| Queue multi-worker | Cocok untuk claim/lock job | Rentan contention dan file-lock issue |
| Multi-user | Cocok sebagai sumber kebenaran bersama | Bisa, tetapi lebih rapuh saat write bersamaan |
| Recovery | WAL, point-in-time tooling, dump, replication options | Backup file/online backup; perlu disiplin saat file aktif |
| Backup | Tool database khusus dan volume backup | Mudah disalin tetapi raw copy harus aman terhadap write aktif |
| Observability | Statistik koneksi/query/locks lebih kaya | Lebih terbatas |
| Migrasi schema | Tool migration matang | Bisa, tetapi perubahan schema lebih ketat dan manual |
| Portabilitas | Perlu server/connection config | Satu file mudah dipindahkan |
| Resource footprint | Lebih besar | Sangat kecil |
| Failure mode | Service unavailable atau connection pool issue | Locked database, corrupt/partial file, writer contention |
| Cocok untuk n8n queue | Ya | Tidak ideal untuk queue multi-worker |
| Cocok untuk MVP single-user | Ya, meski overkill ringan | Ya |
| Cocok untuk target multi-user | Ya | Tidak direkomendasikan |
| Cocok untuk VPS migration | Ya | Bisa, tetapi perlu prosedur migrasi/lock yang ketat |

## 7.3 Dampak pada proyek ini

### Jika memilih SQLite

**Keuntungan:**

- F1 lebih cepat disiapkan;
- tidak perlu container database terpisah;
- mudah dibackup dan dipindahkan;
- cocok untuk eksperimen single-user dengan satu worker.

**Kerugian:**

- queue dan claim job lebih sulit dibuat aman;
- proses n8n, worker, scheduler, dan Telegram consumer dapat berebut writer lock;
- upgrade ke multi-user/PostgreSQL di kemudian hari membutuhkan migration dan pengujian ulang;
- file database menjadi single point of failure;
- concurrent write saat job content berjalan dapat menimbulkan retry/latency yang sulit diprediksi;
- kurang cocok jika F4 scheduler dan queue dijalankan paralel.

**Syarat jika tetap memilih SQLite:**

- hanya satu worker dan satu scheduler aktif;
- tidak ada horizontal scaling;
- WAL mode, busy timeout, transaction pendek, dan file permission wajib;
- database tidak boleh berada di folder sinkronisasi cloud;
- backup dilakukan dengan mekanisme SQLite-safe, bukan copy sembarangan saat write aktif;
- batas eksplisit: single-user/single-process pada MVP;
- migration ke PostgreSQL dianggap breaking change yang harus diuji.

### Jika memilih PostgreSQL

**Keuntungan:**

- sesuai dengan target multi-user dan isolasi per user/account;
- queue, retry, lease, locking, dan transactional state lebih mudah dirancang;
- lebih aman untuk scheduler, Telegram consumer, dan worker yang berjalan bersamaan;
- migration, indexing, constraint, dan observability lebih matang;
- jalur menuju VPS dan deployment 24/7 lebih lurus;
- dapat memakai advisory lock atau row-level claim untuk mencegah duplicate job.

**Kerugian:**

- setup F1 lebih kompleks;
- perlu volume persistence, password/secret, backup, upgrade, healthcheck, dan connection pool;
- memerlukan prosedur restore dan monitoring;
- resource dan troubleshooting sedikit lebih berat dibanding SQLite.

## 7.4 Rekomendasi keputusan

### Keputusan utama: gunakan PostgreSQL sejak F1

Rekomendasi ini dipilih karena rencana final sudah menargetkan:

- multi-user;
- multi-account;
- queue dan scheduler;
- checkpoint per step;
- restart/recovery;
- isolasi ownership;
- kemungkinan migrasi ke VPS.

Kebutuhan tersebut lebih penting daripada keuntungan setup sederhana SQLite. Memulai dengan PostgreSQL menghindari biaya migrasi dan perubahan perilaku locking setelah workflow F2–F4 sudah terbentuk.

### Konfigurasi minimum PostgreSQL untuk MVP

- satu container PostgreSQL dengan named volume;
- database app non-superuser;
- password melalui secret/environment, bukan workflow;
- healthcheck dan dependency condition untuk n8n/worker;
- connection pool dan batas koneksi;
- migration versioning;
- index minimal pada `jobs(user_id, status, created_at)` dan `job_steps(job_id, step)`;
- unique constraint untuk Telegram `update_id` atau idempotency key;
- transaction untuk membuat job dan acknowledgment;
- backup terjadwal serta restore test;
- log query/error tanpa secret;
- retention/cleanup untuk job dan artifact metadata.

## 7.5 Keputusan alternatif yang masih dapat diterima

SQLite hanya dapat dipilih bila tujuan sengaja dipersempit menjadi:

- satu user;
- satu worker;
- satu consumer Telegram;
- tidak ada concurrent scheduler/worker;
- tidak ada target multi-user dalam MVP;
- PostgreSQL migration dijadwalkan sebelum F4.

Jika kondisi tersebut dipilih, dokumen harus menyatakan secara eksplisit bahwa SQLite **bukan fallback transparan**, melainkan mode deployment berbeda dengan batas concurrency dan recovery yang berbeda.

## 7.6 ADR yang disarankan

**ADR-001: Database untuk MVP F1–F3**

- **Status:** Accepted
- **Keputusan:** PostgreSQL sebagai primary database sejak F1.
- **Alasan:** concurrency, queue, multi-user, transaction, recovery, dan jalur VPS.
- **Konsekuensi positif:** schema dan locking konsisten sampai fase berikutnya.
- **Konsekuensi negatif:** setup dan backup lebih kompleks.
- **Alternatif ditolak:** SQLite sebagai default karena single-writer contention dan migration risk.
- **Fallback:** SQLite hanya untuk prototipe lokal sekali jalan, bukan runtime target MVP.

---

# 8. Gate kelulusan MVP F1–F3

MVP boleh dinyatakan siap untuk penggunaan terbatas jika seluruh kondisi berikut terpenuhi:

1. Semua acceptance criteria F1, F2, dan F3 lulus atau memiliki waiver tertulis.
2. PostgreSQL persistent berjalan dengan backup dan restore test yang berhasil.
3. Telegram hanya dapat digunakan oleh allowlisted user.
4. Replay, restart, rate limit, cancellation, dan unauthorized access test lulus.
5. Satu tema menghasilkan video valid dengan voiceover atau error terstruktur yang jelas.
6. Semua artifact memiliki ownership dan retention.
7. Mode `/mode` selain Manual ditolak.
8. Tidak ada secret pada log, workflow export, atau repository.
9. Tidak ada klaim bahwa interval/umur akun menjamin keamanan platform.
10. Tersedia rollback: disable bot consumer, stop worker, revoke token, restore database, dan cleanup artifact.


---

# 9. Batas acceptance produk final — F5

Bagian ini bukan acceptance MVP dan tidak mengaktifkan publisher. Ia mendefinisikan syarat minimum agar produk final dapat disebut agentik dan siap dipertimbangkan untuk publishing.

| Area | Syarat minimum |
|---|---|
| Age gate | Manual untuk semua umur; Semi-Auto hanya jika TikTok age ≥31 hari; Full-Auto hanya jika TikTok age ≥90 hari. Status tanggal `unverified` ditangani secara konservatif. |
| Semi-Auto | Batch memiliki ringkasan item, platform, jadwal, metadata, quota, dan approval eksplisit user sebelum upload. |
| Full-Auto | User menetapkan start date, durasi policy, max posts/day, minimum interval menit, time window, active days, active platforms, content quota, retry limit, dan emergency stop. |
| Cross-post | Visual/audio utama dapat dipakai bersama, tetapi title, caption, tag/hashtag, mention, privacy, schedule, media rules, dan error handling divalidasi oleh adapter TikTok, Instagram, dan Facebook masing-masing. |
| Security | Session/auth material tidak disimpan plaintext; tersedia access control, encryption, rotation, revoke/logout, 2FA/CAPTCHA handoff, dan expiry recovery. |
| Reliability | Publish intent memiliki idempotency key, duplicate prevention, audit trail per platform, retry classification, dan emergency stop. |
| Go/no-go | Setiap adapter memiliki compliance review, threat model, test environment, acceptance criteria, rollback/recovery plan, dan keputusan go/no-go terpisah. |
