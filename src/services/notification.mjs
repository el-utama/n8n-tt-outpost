export class NotificationError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'NotificationError';
    this.code = code;
  }
}

const STATE_MESSAGES = {
  RECEIVED: '📥 Menerima tema...',
  VALIDATING: '🔍 Memvalidasi input...',
  GENERATING_IDEATION: '💡 Menghasilkan ide konten...',
  SOURCING_MEDIA: '🖼️ Mencari media...',
  GENERATING_CAPTION: '✍️ Menulis caption...',
  GENERATING_TTS: '🎤 Menghasilkan voiceover...',
  COMPOSING_VIDEO: '🎬 Merangkai video...',
  VALIDATING_ARTIFACT: '✅ Memvalidasi artifact...',
  DELIVERING: '📤 Mengirimkan hasil...',
  COMPLETED: '✅ Selesai!',
  FAILED_RETRYABLE: '🔄 Gagal (akan dicoba lagi)',
  FAILED_FINAL: '❌ Gagal permanen',
  CANCEL_REQUESTED: '⏸️ Dibatalkan...',
  CANCELLED: '🛑 Dibatalkan'
};

export class NotificationService {
  constructor({
    botToken,
    db,
    clock = () => new Date()
  } = {}) {
    this.botToken = botToken;
    this.db = db;
    this.clock = clock;
    this.pendingNotifications = new Map();
    this.maxRetries = 3;
    this.retryBaseDelayMs = 1000;
  }

  async sendStatusUpdate(jobId, userId, status, metadata = {}) {
    const job = await this._getJob(jobId);
    if (!job || String(job.user_id) !== String(userId)) {
      throw new NotificationError('Job not found or unauthorized', { code: 'ERR_NOT_FOUND' });
    }

    const message = this._formatStatusMessage(job, status, metadata);
    
    try {
      await this._sendTelegramMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await this._queueNotification(userId, message, { parse_mode: 'Markdown' });
    }
  }

  async sendCompletion(jobId, userId, contentPackageId) {
    const job = await this._getJob(jobId);
    if (!job || String(job.user_id) !== String(userId)) {
      throw new NotificationError('Job not found or unauthorized', { code: 'ERR_NOT_FOUND' });
    }

    const packageInfo = await this._getContentPackage(contentPackageId);
    
    let message = `✅ *Job Selesai!*\n\n`;
    message += `📋 *Job ID:* \`${jobId}\`\n`;
    message += `📦 *Package:* \`${contentPackageId}\`\n\n`;
    
    if (packageInfo?.artifacts) {
      const videoArtifact = packageInfo.artifacts.find(a => a.artifact_type === 'video');
      if (videoArtifact) {
        message += `🎬 *Video:* Tersedia untuk download\n`;
        message += `Gunakan: \`/download ${videoArtifact.artifact_id}\`\n\n`;
      }
      
      const voiceoverArtifact = packageInfo.artifacts.find(a => a.artifact_type === 'audio');
      if (voiceoverArtifact) {
        message += `🎤 *Voiceover:* Tersedia untuk download\n`;
        message += `Gunakan: \`/download ${voiceoverArtifact.artifact_id}\`\n\n`;
      }
    }

    message += `📊 *Status:* COMPLETED`;

    try {
      await this._sendTelegramMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await this._queueNotification(userId, message, { parse_mode: 'Markdown' });
    }
  }

  async sendFailure(jobId, userId, error) {
    const job = await this._getJob(jobId);
    if (!job || String(job.user_id) !== String(userId)) return;

    const userMessage = this._sanitizeError(error);
    const message = `❌ *Job Gagal*\n\n` +
      `📋 *Job ID:* \`${jobId}\`\n` +
      `📊 *Status:* ${job.status}\n` +
      `⚠️ *Error:* ${userMessage}\n\n` +
      `${job.status === 'FAILED_RETRYABLE' ? '🔄 Sistem akan mencoba ulang otomatis.' : '🛑 Gagal permanen. Silakan buat job baru.'}`;

    try {
      await this._sendTelegramMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (sendError) {
      await this._queueNotification(userId, message, { parse_mode: 'Markdown' });
    }
  }

  async sendCancellation(jobId, userId, reason) {
    const message = `⏸️ *Job Dibatalkan*\n\n` +
      `📋 *Job ID:* \`${jobId}\`\n` +
      `📊 *Status:* CANCELLED\n` +
      `📝 *Alasan:* ${reason}\n\n` +
      `Gunakan /post untuk membuat konten baru.`;

    try {
      await this._sendTelegramMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await this._queueNotification(userId, message, { parse_mode: 'Markdown' });
    }
  }

  async sendEmergencyStop(userId, reason) {
    const message = `🚨 *Emergency Stop Aktif*\n\n` +
      `Semua pemrosesan otomatis dihentikan.\n` +
      `Alasan: ${reason}\n\n` +
      `Gunakan /post untuk membuat konten manual, atau hubungi admin untuk resume.`;

    try {
      await this._sendTelegramMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await this._queueNotification(userId, message, { parse_mode: 'Markdown' });
    }
  }

  _formatStatusMessage(job, status, metadata) {
    const stateMsg = STATE_MESSAGES[status] ?? `Status: ${status}`;
    let message = `${stateMsg}\n\n`;
    message += `📋 *Job ID:* \`${jobId}\`\n`;
    
    if (metadata.step) {
      message += `🔄 *Step:* ${metadata.step}\n`;
    }
    if (metadata.progress) {
      message += `📊 *Progress:* ${metadata.progress}%\n`;
    }
    if (metadata.warning) {
      message += `⚠️ *Warning:* ${metadata.warning}\n`;
    }
    if (metadata.nextAction) {
      message += `➡️ *Next:* ${metadata.nextAction}\n`;
    }
    
    return message;
  }

  _sanitizeError(error) {
    if (!error) return 'Unknown error';
    const msg = error.message ?? String(error);
    return msg
      .replace(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9_-]{20,}/g, '[REDACTED]')
      .replace(/[a-zA-Z0-9]{32,}/g, '[REDACTED]')
      .substring(0, 200);
  }

  async _sendTelegramMessage(chatId, text, options = {}) {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...options })
    });
    
    if (!response.ok) {
      throw new NotificationError(`Telegram send failed: ${response.status}`, { code: 'ERR_TELEGRAM_SEND' });
    }
  }

  async _queueNotification(chatId, text, options) {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.pendingNotifications.set(id, { chatId, text, options, retries: 0, createdAt: this.clock() });
  }

  async processQueue() {
    for (const [id, notif] of this.pendingNotifications.entries()) {
      if (notif.retries >= this.maxRetries) {
        this.pendingNotifications.delete(id);
        continue;
      }
      
      try {
        await this._sendTelegramMessage(notif.chatId, notif.text, notif.options);
        this.pendingNotifications.delete(id);
      } catch (error) {
        notif.retries++;
        notif.lastError = error.message;
        await new Promise(r => setTimeout(r, this.retryBaseDelayMs * notif.retries));
      }
    }
  }

  async _getJob(jobId) {
    if (!this.db) return null;
    const result = await this.db.query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
    return result.rows[0] ?? null;
  }

  async _getContentPackage(contentPackageId) {
    if (!this.db) return null;
    const result = await this.db.query('SELECT * FROM content_packages WHERE content_package_id = $1', [contentPackageId]);
    return result.rows[0] ?? null;
  }
}