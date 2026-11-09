import { SchemaValidator } from '../core/schema-validator.mjs';
import { JobStateService } from './job-state.mjs';
import { ContentQCService } from './content-qc.mjs';
import { ArtifactRegistry } from './artifact-registry.mjs';
import { CancellationService } from './cancellation.mjs';

export class TelegramRouterError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'TelegramRouterError';
    this.code = code;
  }
}

const COMMAND_SCHEMA = {
  $id: 'https://n8n-tt-outpost.local/schemas/telegram-command.schema.json',
  title: 'TelegramCommand',
  type: 'object',
  required: ['command', 'userId'],
  properties: {
    command: { type: 'string', enum: ['post', 'status', 'download', 'batal', 'mode', 'account', 'help', 'start'] },
    userId: { type: 'string' },
    args: { type: 'string', default: '' },
    jobId: { type: ['string', 'null'] },
    artifactId: { type: ['string', 'null'] },
    batchId: { type: ['string', 'null'] }
  },
  additionalProperties: false
};

export class TelegramRouter {
  constructor({
    jobStateService,
    contentQCService,
    artifactRegistry,
    cancellationService,
    db,
    config = {},
    clock = () => new Date()
  } = {}) {
    this.jobStateService = jobStateService;
    this.contentQCService = contentQCService;
    this.artifactRegistry = artifactRegistry;
    this.cancellationService = cancellationService;
    this.db = db;
    this.config = {
      maxThemeLength: config.maxThemeLength ?? 500,
      downloadExpiryHours: config.downloadExpiryHours ?? 24,
      ...config
    };
    this.clock = clock;
    this.validator = new SchemaValidator({ schemas: [COMMAND_SCHEMA] });
  }

  async route(update) {
    if (!update.message?.text) return null;

    const text = update.message.text.trim();
    const userId = String(update.message.from.id);
    const chatId = update.message.chat.id;

    const parsed = this._parseCommand(text);
    if (!parsed) return this._sendHelp(chatId, userId);

    const { command, args } = parsed;

    try {
      this.validator.validate(COMMAND_SCHEMA.$id, { command, userId, args });
    } catch (error) {
      return this._sendError(chatId, 'Invalid command format');
    }

    switch (command) {
      case 'start':
      case 'help':
        return this._sendHelp(chatId, userId);
      case 'post':
        return this._handlePost(chatId, userId, args);
      case 'status':
        return this._handleStatus(chatId, userId, args);
      case 'download':
        return this._handleDownload(chatId, userId, args);
      case 'batal':
        return this._handleBatal(chatId, userId, args);
      case 'mode':
        return this._handleMode(chatId, userId, args);
      case 'account':
        return this._handleAccount(chatId, userId, args);
      default:
        return this._sendError(chatId, 'Unknown command');
    }
  }

  _parseCommand(text) {
    const match = text.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (!match) return null;
    return { command: match[1].toLowerCase(), args: match[2]?.trim() ?? '' };
  }

  async _sendMessage(chatId, text, options = {}) {
    return { chat_id: chatId, text, ...options };
  }

  _sendHelp(chatId, userId) {
    return this._sendMessage(chatId, 
      `🤖 *n8n-tt-outpost Bot*\n\n` +
      `*Available Commands:*\n` +
      `/post <tema> - Buat konten baru\n` +
      `/status [job_id] - Cek status job\n` +
      `/download <artifact_id> - Download artifact\n` +
      `/batal <job_id> - Batalkan job\n` +
      `/mode manual - Set mode manual (default)\n` +
      `/account - Info akun\n` +
      `/help - Tampilkan bantuan\n\n` +
      `*Note:* MVP hanya mendukung mode Manual. Semi-Auto dan Full-Auto belum tersedia.`,
      { parse_mode: 'Markdown' }
    );
  }

  _sendError(chatId, message) {
    return this._sendMessage(chatId, `❌ ${message}`);
  }

  async _handlePost(chatId, userId, args) {
    const theme = args.trim();
    if (!theme) {
      return this._sendError(chatId, 'Tema tidak boleh kosong. Gunakan: /post <tema>');
    }
    if (theme.length > this.config.maxThemeLength) {
      return this._sendError(chatId, `Tema terlalu panjang (maks ${this.config.maxThemeLength} karakter)`);
    }

    const idempotencyKey = `post_${userId}_${this.clock().getTime()}_${Math.random().toString(36).substring(7)}`;

    try {
      const { job, created } = await this.jobStateService.createJob({
        job_id: crypto.randomUUID(),
        user_id: BigInt(userId),
        idempotency_key: idempotencyKey,
        theme_raw: theme,
        theme_normalized: theme,
        content_profile: { tone: 'informative', language: 'id-ID', target_format: 'video_9_16', target_duration_sec: 60 },
        timezone: 'Asia/Jakarta',
        max_attempts: 3
      });

      if (!created) {
        return this._sendMessage(chatId, `⚠️ Job sudah ada dengan tema serupa. Job ID: ${job.job_id}`);
      }

      return this._sendMessage(chatId, 
        `✅ Job dibuat!\n` +
        `📋 *Job ID:* \`${job.job_id}\`\n` +
        `📝 *Tema:* ${theme}\n` +
        `⏳ *Status:* RECEIVED\n\n` +
        `Gunakan /status ${job.job_id} untuk cek progress.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Post error:', error);
      return this._sendError(chatId, 'Gagal membuat job. Silakan coba lagi.');
    }
  }

  async _handleStatus(chatId, userId, args) {
    const jobId = args.trim();
    
    try {
      let job;
      if (jobId) {
        job = await this.jobStateService.getJobById(jobId);
        if (!job || String(job.user_id) !== userId) {
          return this._sendError(chatId, 'Job tidak ditemukan atau tidak memiliki akses');
        }
      } else {
        const jobs = await this.jobStateService.getJobsByUser(BigInt(userId), { limit: 1 });
        job = jobs[0];
      }

      if (!job) {
        return this._sendMessage(chatId, 'Tidak ada job yang ditemukan.');
      }

      const statusText = this._formatJobStatus(job);
      return this._sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Status error:', error);
      return this._sendError(chatId, 'Gagal mengambil status');
    }
  }

  _formatJobStatus(job) {
    const stateEmoji = {
      RECEIVED: '📥', VALIDATING: '🔍', GENERATING_IDEATION: '💡',
      SOURCING_MEDIA: '🖼️', GENERATING_CAPTION: '✍️', GENERATING_TTS: '🎤',
      COMPOSING_VIDEO: '🎬', VALIDATING_ARTIFACT: '✅', DELIVERING: '📤',
      COMPLETED: '✅', FAILED_RETRYABLE: '🔄', FAILED_FINAL: '❌',
      CANCEL_REQUESTED: '⏸️', CANCELLED: '🛑'
    };

    const emoji = stateEmoji[job.status] ?? '❓';
    let text = `${emoji} *Job Status*\n\n`;
    text += `📋 *Job ID:* \`${job.job_id}\`\n`;
    text += `📊 *Status:* ${job.status}\n`;
    text += `🔢 *Attempt:* ${job.attempt}/${job.max_attempts}\n`;
    
    if (job.error) {
      text += `⚠️ *Error:* ${job.error.message ?? JSON.stringify(job.error)}\n`;
    }
    
    if (job.content_package_id) {
      text += `📦 *Package:* ${job.content_package_id}\n`;
    }

    return text;
  }

  async _handleDownload(chatId, userId, args) {
    const artifactId = args.trim();
    if (!artifactId) {
      return this._sendError(chatId, 'Artifact ID diperlukan. Gunakan: /download <artifact_id>');
    }

    try {
      const artifactUri = `artifact://${artifactId}`;
      const link = await this.artifactRegistry.createDownloadLink(artifactUri, BigInt(userId), {
        expiresInHours: this.config.downloadExpiryHours
      });

      return this._sendMessage(chatId, 
        `📥 *Download Link*\n\n` +
        `🔗 [Download Artifact](${link.download_url})\n` +
        `⏰ *Expired:* ${new Date(link.expires_at).toLocaleString('id-ID')}\n` +
        `📦 *Artifact:* \`${artifactId}\``,
        { parse_mode: 'Markdown', disable_web_page_preview: true }
      );
    } catch (error) {
      if (error.code === 'ERR_ARTIFACT_NOT_FOUND') {
        return this._sendError(chatId, 'Artifact tidak ditemukan');
      }
      if (error.code === 'ERR_ARTIFACT_OWNERSHIP') {
        return this._sendError(chatId, 'Anda tidak memiliki akses ke artifact ini');
      }
      if (error.code === 'ERR_LINK_EXPIRED') {
        return this._sendError(chatId, 'Link download telah kedaluwarsa');
      }
      console.error('Download error:', error);
      return this._sendError(chatId, 'Gagal membuat link download');
    }
  }

  async _handleBatal(chatId, userId, args) {
    const jobId = args.trim();
    if (!jobId) {
      return this._sendError(chatId, 'Job ID diperlukan. Gunakan: /batal <job_id>');
    }

    try {
      const job = await this.jobStateService.getJobById(jobId);
      if (!job || String(job.user_id) !== userId) {
        return this._sendError(chatId, 'Job tidak ditemukan atau tidak memiliki akses');
      }

      if (!this.jobStateService.canCancel(job)) {
        return this._sendMessage(chatId, `⚠️ Job tidak dapat dibatalkan (status: ${job.status})`);
      }

      await this.cancellationService.requestCancel(jobId, { actor: 'user', reason: 'user_requested' });
      
      return this._sendMessage(chatId, 
        `⏸️ *Cancellation Requested*\n\n` +
        `📋 *Job ID:* \`${jobId}\`\n` +
        `📊 *Status:* CANCEL_REQUESTED\n` +
        `Sistem akan menghentikan pemrosesan segera.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Batal error:', error);
      return this._sendError(chatId, 'Gagal membatalkan job');
    }
  }

  async _handleMode(chatId, userId, args) {
    const mode = args.trim().toLowerCase();
    
    if (mode !== 'manual') {
      return this._sendMessage(chatId, 
        `⚠️ *Mode ${mode} tidak tersedia di MVP*\n\n` +
        `MVP hanya mendukung mode Manual.\n` +
        `Semi-Auto dan Full-Auto akan tersedia di rilis mendatang setelah review compliance dan security.`,
        { parse_mode: 'Markdown' }
      );
    }

    return this._sendMessage(chatId, 
      `✅ *Mode diatur ke Manual*\n\n` +
      `Ini adalah mode default dan satu-satunya mode yang tersedia di MVP.`,
      { parse_mode: 'Markdown' }
    );
  }

  async _handleAccount(chatId, userId, args) {
    try {
      const accounts = await this.db.query(
        'SELECT platform, account_handle, age_gate_status, ownership_verified, created_at FROM accounts WHERE user_id = $1',
        [BigInt(userId)]
      );

      if (accounts.rows.length === 0) {
        return this._sendMessage(chatId, 
          `📭 *Belum ada akun terdaftar*\n\n` +
          `Gunakan fitur ini untuk menambahkan metadata akun platform nanti.`,
          { parse_mode: 'Markdown' }
        );
      }

      let text = `👤 *Akun Terdaftar*\n\n`;
      for (const acc of accounts.rows) {
        const ageStatus = {
          unverified: '❓ Unverified',
          verified_0_30: '🔴 0-30 hari',
          verified_31_90: '🟡 31-90 hari',
          verified_90_plus: '🟢 90+ hari'
        }[acc.age_gate_status] ?? acc.age_gate_status;

        text += `• *${acc.platform.toUpperCase()}*\n`;
        text += `  Handle: @${acc.account_handle}\n`;
        text += `  Age Gate: ${ageStatus}\n`;
        text += `  Ownership: ${acc.ownership_verified ? '✅ Verified' : '❌ Not Verified'}\n`;
        text += `  Created: ${new Date(acc.created_at).toLocaleDateString('id-ID')}\n\n`;
      }

      return this._sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Account error:', error);
      return this._sendError(chatId, 'Gagal mengambil info akun');
    }
  }
}