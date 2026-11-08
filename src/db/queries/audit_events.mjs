import { getPool } from '../pool.mjs';

export async function writeAuditEvent(event) {
  const pool = getPool();
  const { action, user_id, job_id, account_id, content_package_id, publish_intent_id, details, ip_address, user_agent } = event;
  const result = await pool.query(
    `INSERT INTO audit_events (action, user_id, job_id, account_id, content_package_id, publish_intent_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING audit_id, timestamp`,
    [action, user_id, job_id, account_id, content_package_id, publish_intent_id, details, ip_address, user_agent]
  );
  return result.rows[0];
}

export async function getAuditEventsByJob(jobId, { limit = 100, offset = 0 } = {}) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM audit_events WHERE job_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
    [jobId, limit, offset]
  );
  return result.rows;
}

export async function getAuditEventsByUser(userId, { limit = 100, offset = 0, action = null } = {}) {
  const pool = getPool();
  let query = 'SELECT * FROM audit_events WHERE user_id = $1';
  const params = [userId];
  if (action) {
    query += ' AND action = $2';
    params.push(action);
  }
  query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getAuditEventsByAction(action, { limit = 100, offset = 0, since = null } = {}) {
  const pool = getPool();
  let query = 'SELECT * FROM audit_events WHERE action = $1';
  const params = [action];
  if (since) {
    query += ' AND timestamp >= $2';
    params.push(since);
  }
  query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);
  const result = await pool.query(query, params);
  return result.rows;
}