import pg from 'pg';
const { Pool } = pg;

import { Config } from '../core/config.mjs';

export class DatabaseError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'DatabaseError';
    this.code = code;
  }
}

let _pool = null;

export function createPool(config) {
  if (_pool) return _pool;

  const poolConfig = {
    connectionString: config.getDatabaseUrl(),
    min: config.database.pool.min,
    max: config.database.pool.max,
    idleTimeoutMillis: config.database.pool.idleTimeoutMs,
    connectionTimeoutMillis: config.database.pool.connectionTimeoutMs,
    ssl: config.database.url.includes('sslmode=require') ? { rejectUnauthorized: false } : false
  };

  _pool = new Pool(poolConfig);

  _pool.on('error', (err) => {
    console.error('Unexpected pool error:', err);
  });

  return _pool;
}

export function getPool() {
  if (!_pool) throw new DatabaseError('Pool not initialized. Call createPool(config) first.', { code: 'ERR_POOL_NOT_INITIALIZED' });
  return _pool;
}

export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export async function healthCheck(pool = null) {
  const p = pool ?? getPool();
  const client = await p.connect();
  try {
    await client.query('SELECT 1');
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error.message };
  } finally {
    client.release();
  }
}

export async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withRetry(pool, callback, { maxRetries = 3, baseDelayMs = 100 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callback(pool);
    } catch (error) {
      lastError = error;
      const isRetryable = error.code === '40P01' || error.code === '40001' || error.message?.includes('deadlock');
      if (!isRetryable || attempt === maxRetries) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}