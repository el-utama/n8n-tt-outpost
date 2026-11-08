# OpenCode Desktop + Nemotron Setup

Dokumen ini menjelaskan cara menghubungkan OpenCode Desktop ke Nemotron melalui endpoint OpenAI-compatible. Ia tidak mengaktifkan provider atau melakukan login secara otomatis.

## 1. Jalur utama: provider NVIDIA bawaan OpenCode Desktop

Jika OpenCode Desktop Anda sudah menyediakan provider NVIDIA dan Anda dapat menghubungkannya menggunakan NVIDIA API key, gunakan jalur tersebut untuk pekerjaan coding-agent. Anda tidak perlu memasang Nemotron lokal, vLLM, atau mengelola GPU model untuk mulai membangun project.

Pilih model Nemotron dari model catalog/OpenCode setelah provider NVIDIA tersambung. Model ID, endpoint, dan credential dikelola oleh OpenCode Desktop. Jangan membuat custom provider hanya untuk mengulang koneksi yang sudah disediakan OpenCode.

## 2. Jalur alternatif: endpoint OpenAI-compatible langsung

Nemotron harus sudah berjalan melalui serving engine yang menyediakan endpoint OpenAI-compatible, biasanya dengan base URL berakhiran `/v1`. Model ID yang dipakai OpenCode harus sama dengan ID yang dikembalikan oleh endpoint `GET /v1/models`.

Simpan nilai berikut sebagai environment variable pada proses OpenCode Desktop:

```text
NEMOTRON_BASE_URL=http://127.0.0.1:8000/v1
NEMOTRON_API_KEY=local-or-provider-key
```

Jika server lokal tidak memerlukan key, gunakan nilai dummy hanya jika serving engine memang menerimanya.

## 3. Membuat project config bila provider NVIDIA tidak otomatis muncul

Salin `opencode.example.jsonc` menjadi `opencode.jsonc` di root project. Ganti `REPLACE_WITH_MODEL_ID` dengan model ID aktual dari `/v1/models`. Jangan menebak model ID.

Konfigurasi memakai provider custom dengan `@ai-sdk/openai-compatible`, `options.baseURL`, environment substitution, dan model key `provider_id/model_id`. OpenCode menggabungkan konfigurasi project dengan konfigurasi global; project config berlaku untuk project ini.

## 4. Jangan membingungkan dua layer

OpenCode Desktop adalah coding-agent UI dan provider client. `src/adapters/nemotron.mjs` adalah adapter runtime proyek yang memakai fetch dan contract validation. OpenCode Desktop tidak otomatis meneruskan credential provider internal ke runtime n8n. Jika runtime aplikasi perlu memanggil Nemotron secara langsung, credential harus diberikan melalui secret manager/environment reference secara terpisah; jangan menyalin key ke repository.

OpenCode tidak boleh dijadikan pengganti policy engine, job-state, database transaction, atau publisher adapter.

## 5. Tool calling

Sebelum memakai tool calling:

1. pastikan model profile `tool_calling=true`;
2. pastikan serving engine memakai parser tool-call yang sesuai varian Nemotron;
3. jalankan `npm run check`;
4. jalankan unit test adapter;
5. lakukan mock test dengan `ENABLE_REAL_PROVIDER_CALLS=false`;
6. hanya setelah hasil valid, pertimbangkan endpoint nyata.

Adapter akan menolak tool yang tidak allowlisted, arguments yang bukan JSON object, dan arguments yang gagal schema validation.

## 6. Safety defaults

Tetap gunakan:

```text
FEATURE_STAGE=MVP_MANUAL
ENABLE_F5_PUBLISHER=false
ENABLE_REAL_PROVIDER_CALLS=false
```

Mengubah `ENABLE_REAL_PROVIDER_CALLS` bukan langkah setup rutin. Nilai tersebut hanya boleh aktif pada environment terisolasi setelah model capability probe, schema validation, mock test, dan approval gate lulus.

## 7. Troubleshooting

- Model tidak muncul: periksa `GET /v1/models` dan cocokkan ID persis.
- 404: base URL atau `/v1` salah.
- tool call menjadi teks: parser atau model template tidak cocok.
- arguments invalid: tool schema atau parser perlu diperiksa; jangan mem-bypass validator.
- timeout: sesuaikan timeout setelah benchmark, bukan dengan menghapus timeout.
- output berisi reasoning tags: adapter membersihkan tags pada content, tetapi tool result tetap harus diverifikasi.

## 7. References

- OpenCode provider configuration: https://opencode.ai/docs/providers/
- OpenCode models: https://opencode.ai/docs/models/
- OpenCode config: https://opencode.ai/docs/config/
