import { createHash } from 'node:crypto';

export class RateLimitError extends Error {
  constructor(message, { code = null, retryAfter = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'RateLimitError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class TelegramRateLimiter {
  constructor({
    maxRequestsPerSecond = 30,
    maxBurst = 10,
    clock = () => Date.now()
  } = {}) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.maxBurst = maxBurst;
    this.clock = clock;
    this.tokens = maxBurst;
    this.lastRefill = clock();
    this.requestTimes = [];
  }

  async acquire() {
    const now = this.clock();
    this._refill(now);
    
    if (this.tokens >= 1) {
      this.tokens--;
      this.requestTimes.push(now);
      this._cleanupRequestTimes(now);
      return true;
    }
    
    const waitTime = this._calculateWaitTime(now);
    await new Promise(r => setTimeout(r, waitTime));
    return this.acquire();
  }

  _refill(now) {
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.maxRequestsPerSecond;
    this.tokens = Math.min(this.maxBurst, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  _cleanupRequestTimes(now) {
    const windowMs = 1000;
    this.requestTimes = this.requestTimes.filter(t => now - t < windowMs);
  }

  _calculateWaitTime(now) {
    if (this.tokens >= 1) return 0;
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil((tokensNeeded / this.maxRequestsPerSecond) * 1000);
  }

  getCurrentUsage() {
    const now = this.clock();
    this._cleanupRequestTimes(now);
    return {
      requestsInLastSecond: this.requestTimes.length,
      availableTokens: Math.floor(this.tokens),
      maxBurst: this.maxBurst
    };
  }
}

export class TelegramRetryPolicy {
  constructor({
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    jitterFactor = 0.2,
    retryableStatusCodes = [429, 500, 502, 503, 504]
  } = {}) {
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.jitterFactor = jitterFactor;
    this.retryableStatusCodes = new Set(retryableStatusCodes);
  }

  isRetryable(error) {
    if (error instanceof RateLimitError) return true;
    if (error.status && this.retryableStatusCodes.has(error.status)) return true;
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') return true;
    return false;
  }

  async execute(fn, context = {}) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (!this.isRetryable(error)) {
          throw error;
        }
        
        if (attempt === this.maxRetries) {
          throw new RateLimitError(
            `Max retries (${this.maxRetries}) exceeded for ${context.operation ?? 'operation'}`,
            { code: 'ERR_MAX_RETRIES', retryAfter: null, cause: error }
          );
        }
        
        const delay = this._calculateDelay(attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    
    throw lastError;
  }

  _calculateDelay(attempt) {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
    const jitter = exponentialDelay * this.jitterFactor * Math.random();
    return Math.min(exponentialDelay + jitter, this.maxDelayMs);
  }
}

export class IdempotencyManager {
  constructor({ db, ttlSeconds = 86400, clock = () => new Date() } = {}) {
    this.db = db;
    this.ttlSeconds = ttlSeconds;
    this.clock = clock;
  }

  async checkAndStore(key, payload, userId) {
    if (!this.db) return { isDuplicate: false };
    
    const payloadHash = this._hashPayload(payload);
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    
    try {
      const insertResult = await this.db.query(
        `INSERT INTO telegram_idempotency (idempotency_key, user_id, payload_hash, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [key, userId, payloadHash, expiresAt]
      );
      
      if (insertResult.rowCount > 0) {
        return { isDuplicate: false };
      }
      
      // Key already exists, check if it's the same payload (idempotent) or different
      const existingResult = await this.db.query(
        `SELECT payload_hash FROM telegram_idempotency WHERE idempotency_key = $1`,
        [key]
      );
      
      if (existingResult.rows.length > 0) {
        const existingHash = existingResult.rows[0].payload_hash;
        return { isDuplicate: existingHash === payloadHash };
      }
      
      return { isDuplicate: false };
    } catch (error) {
      if (error.code === '23505') {
        return { isDuplicate: true };
      }
      throw error;
    }
  }

  async markConsumed(key, jobId) {
    if (!this.db) return;
    await this.db.query(
      `UPDATE telegram_idempotency SET consumed_at = NOW(), job_id = $2 WHERE idempotency_key = $1`,
      [key, jobId]
    );
  }

  async cleanup() {
    if (!this.db) return 0;
    const result = await this.db.query(
      `DELETE FROM telegram_idempotency WHERE expires_at < NOW() AND consumed_at IS NULL`
    );
    return result.rowCount;
  }

  _hashPayload(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}