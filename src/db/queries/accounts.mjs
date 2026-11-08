import { getPool, withTransaction, DatabaseError } from '../pool.mjs';

export async function createAccount(data) {
  const pool = getPool();
  const { account_id, user_id, platform, account_handle, account_metadata, ownership_verified, ownership_method, age_gate_status } = data;
  const result = await pool.query(
    `INSERT INTO accounts (account_id, user_id, platform, account_handle, account_metadata, ownership_verified, ownership_method, age_gate_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, platform, account_handle) DO UPDATE SET
       account_metadata = EXCLUDED.account_metadata,
       ownership_verified = EXCLUDED.ownership_verified,
       ownership_method = EXCLUDED.ownership_method,
       age_gate_status = EXCLUDED.age_gate_status,
       updated_at = NOW()
     RETURNING *`,
    [account_id, user_id, platform, account_handle, account_metadata ?? {}, ownership_verified ?? false, ownership_method, age_gate_status ?? 'unverified']
  );
  return result.rows[0];
}

export async function getAccountById(accountId) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM accounts WHERE account_id = $1', [accountId]);
  return result.rows[0] ?? null;
}

export async function getAccountsByUser(userId, { platform = null } = {}) {
  const pool = getPool();
  let query = 'SELECT * FROM accounts WHERE user_id = $1';
  const params = [userId];
  if (platform) {
    query += ' AND platform = $2';
    params.push(platform);
  }
  const result = await pool.query(query, params);
  return result.rows;
}

export async function updateAccountAgeGate(accountId, ageGateStatus, verifiedAt = null) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE accounts SET age_gate_status = $2, age_gate_verified_at = $3, updated_at = NOW() WHERE account_id = $1 RETURNING *`,
    [accountId, ageGateStatus, verifiedAt ?? new Date()]
  );
  return result.rows[0] ?? null;
}

export async function updateAccountOwnership(accountId, verified, method) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE accounts SET ownership_verified = $2, ownership_method = $3, updated_at = NOW() WHERE account_id = $1 RETURNING *`,
    [accountId, verified, method]
  );
  return result.rows[0] ?? null;
}

export async function updateAccountMetadata(accountId, metadata) {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE accounts SET account_metadata = $2, updated_at = NOW() WHERE account_id = $1 RETURNING *`,
    [accountId, metadata]
  );
  return result.rows[0] ?? null;
}