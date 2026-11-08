# REVIEW STRUKTUR SKILL — n8n-tt-outpost

**Tanggal:** 2026-11-08  
**Scope:** Semua `skills/*/SKILL.md` yang tersedia setelah batch `batch-approval` dan `storage-retention`.  
**Status:** Review struktural; belum ada runtime implementation.

## 1. Inventory

| Skill | Status struktur | Baris | Fokus |
|---|---|---:|---|
| `job-state` | Valid | 226 | Job lifecycle deterministik |
| `orchestrator` | Valid | 264 | Routing dan koordinasi |
| `policy-engine` | Valid | 115 | Age gate dan policy preflight |
| `content-ideation` | Valid | 96 | Ideation non-faktual |
| `content-qc` | Valid | 137 | Quality control package/artifact |
| `telegram` | Valid | 151 | Interface Telegram aman |
| `caption-writer` | Valid | 89 | Caption, CTA, hashtag dasar |
| `media-sourcing` | Valid | 103 | Asset dan terms/license |
| `tts` | Valid | 94 | Voiceover dan audio artifact |
| `video-composer` | Valid | 121 | Video 9:16 dan composition |
| `batch-approval` | Valid | 134 | Approval Semi-Auto per batch |
| `storage-retention` | Valid | 163 | Artifact, retention, cleanup |

## 2. Checks yang dilakukan

Semua skill diperiksa untuk:

- file `SKILL.md` tersedia;
- YAML frontmatter berada di awal file;
- field `name` tersedia dan sesuai nama folder;
- satu field `description` tersedia;
- panjang di bawah 500 baris;
- referensi ke source-of-truth/design/rules atau kontrak relevan;
- bagian input/kontrak atau procedure yang dapat dipahami;
- failure modes;
- side effects;
- quality checks;
- pembatasan security dan ownership bila skill memiliki side effect.

Hasil: **12/12 skill lulus pemeriksaan dasar.**

## 3. Temuan positif

### 3.1 Boundary AI dan deterministik jelas

`job-state`, `policy-engine`, `content-qc`, dan `storage-retention` menyatakan bahwa enforcement penting harus dilakukan deterministic service. `orchestrator` juga tidak memiliki kewenangan untuk melewati policy engine.

### 3.2 Publishing tidak bocor ke MVP

`telegram`, `batch-approval`, dan `orchestrator` secara eksplisit membedakan MVP Manual-only dari F5 produk final. Semi-Auto dan Full-Auto belum dapat aktif hanya karena skill tersedia.

### 3.3 Kontrak artifact konsisten

Skill media, TTS, video, QC, dan storage menggunakan logical URI `asset://` atau `artifact://`, hash, ownership, retention, dan tidak menerima physical path arbitrary.

### 3.4 Platform adapter tetap terisolasi

Belum ada adapter platform pada batch ini, tetapi content skills tidak mengunci output pada payload TikTok. Ini sesuai desain cross-post.

### 3.5 Semua skill memiliki failure modes dan quality checks

Kegagalan retryable, final, hold, approval, quota, ownership, dan storage sudah ditulis pada skill yang relevan.

## 4. Minor consistency findings

Tidak ada blocker struktural, tetapi format body belum sepenuhnya seragam:

1. `job-state` dan `orchestrator` memakai heading bernomor, sementara skill lain memakai heading tanpa nomor.
2. Nama bagian output bervariasi: `Outputs`, `Output`, `Output contract`, atau `Batch preview output`.
3. `telegram` menggunakan `Supported commands` dan `Command routing` sebagai struktur utama, sehingga tidak memiliki heading `Inputs`/`Outputs` eksplisit seperti content skills.
4. Skill deterministik seperti `storage-retention` dan `batch-approval` tidak selalu memerlukan bagian `LLM boundary`, tetapi alasan bahwa skill tersebut bukan LLM skill sebaiknya ditulis eksplisit bila akan dibaca Orchestrator.
5. Beberapa skill memiliki `Procedure`, sementara yang lain memakai `Lifecycle`, `Preflight sequence`, atau `Required checks`. Ini valid secara makna, tetapi parser dokumentasi masa depan akan lebih mudah jika ada alias atau template standar.

## 5. Keputusan review

Temuan di atas **tidak menghalangi penggunaan skill sebagai draft kontrak**. Tidak ada perubahan arsitektur yang diperlukan.

Struktur minimal yang akan dipakai untuk skill berikutnya:

1. YAML frontmatter: `name`, `description`;
2. `Purpose`;
3. `Inputs` atau `Trigger/Scope`;
4. `Outputs` atau `Decision/Contract`;
5. `Procedure/Lifecycle/Checks`;
6. `Rules/Hard rules`;
7. `Failure modes`;
8. `Side effects`;
9. `Quality checks`;
10. `Handoff` bila ada downstream skill.

Untuk skill yang hanya berupa deterministic service, `LLM boundary` boleh diganti dengan pernyataan eksplisit bahwa skill tidak melakukan reasoning LLM.

## 6. Rekomendasi sinkronisasi berikutnya

Sebelum skill adapter platform dibuat, lakukan satu standardisasi ringan:

- tambahkan alias heading `Inputs` dan `Outputs` pada `telegram`;
- tambahkan bagian `Handoff` pada skill yang mengirim output ke skill downstream;
- tambahkan bagian `LLM boundary` atau `Deterministic boundary` pada `batch-approval` dan `storage-retention`;
- gunakan heading tanpa nomor untuk seluruh skill baru, atau buat validator yang menerima kedua gaya;
- setelah adapter dibuat, tambahkan `platform-payload.schema.json` dan `publish-result.schema.json`.

## 7. Kesimpulan

Struktur skill saat ini sudah **layak untuk dilanjutkan ke batch adapter dan publishing support**. Semua skill masih berstatus draft dokumentasi, belum terpasang sebagai runtime skill, dan belum menjalankan side effect apa pun.
