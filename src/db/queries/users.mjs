import { getPool, withTransaction, DatabaseError } from '../pool.mjs';

export async function createUser(userData) {
  const pool = getPool();
  const { user_id, username, first_name, last_name, language_code, is_bot, timezone, is_allowlisted } = userData;
  const result = await pool.query(
    `INSERT INTO users (user_id, username, first_name, last_name, language_code, is_bot, timezone, is_allowlisted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       language_code = EXCLUDED.language_code,
       is_bot = EXCLUDED.is_bot,
       timezone = EXCLUDED.timezone,
       is_allowlisted = EXCLUDED.is_allowlisted,
       updated_at = NOW()
     RETURNING *`,
    [user_id, username, first_name, last_name, language_code, is_bot, timezone ?? 'Asia/Jakarta', is_allowlisted ?? false]
  );
  return result.rows[0];
}

export async function getUserById(userId) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function updateUserAllowlist(userId, isAllowlisted) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE users SET is_allowlisted = $2, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
    [userId, isAllowlisted]
  );
  return result.rows[0] ?? null;
}

export async function getAllowlistedUsers() {
  const pool = getPool();
  const result = await pool.query('SELECT user_id FROM users WHERE is_allowlisted = TRUE');
  return result.rows.map(r => r.user_id);
}

export async function updateUserTimezone(userId, timezone) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE users SET timezone = $2, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
    [userId, timezone]
  );
  return result.rows[0] ?? null;
}