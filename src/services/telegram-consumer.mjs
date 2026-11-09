import { createHash } from 'node:crypto';

export class TelegramConsumerError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'TelegramConsumerError';
    this.code = code;
  }
}

export class TelegramConsumer {
  constructor({
    botToken,
    db,
    allowlist,
    clock = () => new Date(),
    pollTimeout = 30,
    maxRetries = 3,
    retryBaseDelayMs = 1000
  } = {}) {
    if (!botToken) throw new TelegramConsumerError('botToken required', { code: 'ERR_CONFIG' });
    if (!db) throw new TelegramConsumerError('db required', { code: 'ERR_CONFIG' });
    
    this.botToken = botToken;
    this.db = db;
    this.allowlist = new Set(allowlist ?? []);
    this.clock = clock;
    this.pollTimeout = pollTimeout;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.running = false;
    this.offset = 0;
    this.updateIdempotency = new Map();
    this.cleanupInterval = null;
  }

  async initialize() {
    const cursor = await this._loadCursor();
    this.offset = cursor ?? 0;
    await this._startCleanup();
  }

  async start() {
    this.running = true;
  }

  async stop() {
    this.running = false;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async _loadCursor() {
    try {
      const result = await this.db.query(
        'SELECT cursor_value FROM telegram_cursor WHERE id = 1'
      );
      return result.rows[0]?.cursor_value ?? 0;
    } catch {
      return 0;
    }
  }

  async _saveCursor(offset) {
    await this.db.query(
      `INSERT INTO telegram_cursor (id, cursor_value, updated_at) 
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET cursor_value = $1, updated_at = NOW()`,
      [offset]
    );
  }

  async _startCleanup() {
    this.cleanupInterval = setInterval(async () => {
      const now = this.clock().getTime();
      for (const [key, timestamp] of this.updateIdempotency.entries()) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
          this.updateIdempotency.delete(key);
        }
      }
    }, 60 * 60 * 1000);
  }

  async _getUpdates() {
    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;
    const params = new URLSearchParams({
      offset: String(this.offset + 1),
      timeout: String(this.pollTimeout),
      allowed_updates: JSON.stringify(['message', 'callback_query'])
    });

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${url}?${params}`, {
          signal: AbortSignal.timeout((this.pollTimeout + 10) * 1000)
        });
        
        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.retryBaseDelayMs * attempt;
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw new TelegramConsumerError(`Telegram API error: ${response.status}`, { 
            code: 'ERR_TELEGRAM_API', 
            cause: new Error(String(response.status)) 
          });
        }
        
        const data = await response.json();
        if (!data.ok) {
          throw new TelegramConsumerError(`Telegram API returned ok=false`, { 
            code: 'ERR_TELEGRAM_API', 
            cause: new Error(data.description) 
          });
        }
        
        return data.result ?? [];
      } catch (error) {
        lastError = error;
        if (error instanceof TelegramConsumerError) throw error;
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, this.retryBaseDelayMs * attempt));
        }
      }
    }
    throw lastError;
  }

  _isAllowlisted(userId) {
    return this.allowlist.has(String(userId));
  }

  _getIdempotencyKey(update) {
    const payload = JSON.stringify({ update_id: update.update_id, user_id: update.message?.from?.id });
    return createHash('sha256').update(payload).digest('hex').substring(0, 32);
  }

  async _checkAndMarkIdempotent(updateId, userId) {
    const key = this._getIdempotencyKey({ update_id: updateId, message: { from: { id: userId } } });
    const existing = this.updateIdempotency.get(key);
    if (existing) return false;
    this.updateIdempotency.set(key, this.clock().getTime());
    return true;
  }

  async pollOnce() {
    const updates = await this._getUpdates();
    const processed = [];
    
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id);
      
      if (update.message) {
        const userId = update.message.from?.id;
        if (!userId) continue;
        
        if (!this._isAllowlisted(userId)) {
          await this._sendMessage(userId, 'Access denied. You are not authorized to use this bot.');
          continue;
        }
        
        if (!(await this._checkAndMarkIdempotent(update.update_id, userId))) {
          continue;
        }
        
        processed.push({ type: 'message', update, userId });
      } else if (update.callback_query) {
        const userId = update.callback_query.from?.id;
        if (!userId) continue;
        
        if (!this._isAllowlisted(userId)) {
          await this._answerCallbackQuery(update.callback_query.id, 'Access denied.');
          continue;
        }
        
        if (!(await this._checkAndMarkIdempotent(update.callback_query.id, userId))) {
          continue;
        }
        
        processed.push({ type: 'callback', update, userId });
      }
    }
    
    await this._saveCursor(this.offset);
    return processed;
  }

  async _sendMessage(chatId, text, options = {}) {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...options })
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  async _answerCallbackQuery(callbackQueryId, text) {
    const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: true })
      });
    } catch (error) {
      console.error('Failed to answer callback:', error);
    }
  }

  async _sendDocument(chatId, document, caption) {
    const url = `https://api.telegram.org/bot${this.botToken}/sendDocument`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, document, caption })
      });
    } catch (error) {
      console.error('Failed to send document:', error);
    }
  }
}