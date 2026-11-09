export class EmergencyStopError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'EmergencyStopError';
    this.code = code;
  }
}

export class EmergencyStopService {
  constructor({ db, clock = () => new Date() } = {}) {
    this.db = db;
    this.clock = clock;
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error(`EmergencyStop listener error (${event}):`, e); }
    }
  }

  async trigger(triggeredBy, reason, { scope = 'ALL', targetId = null } = {}) {
    if (!['ALL', 'PLATFORM', 'BATCH', 'JOB'].includes(scope)) {
      throw new EmergencyStopError('Invalid scope', { code: 'ERR_INVALID_SCOPE' });
    }

    const result = await this.db.query(
      `INSERT INTO emergency_stops (triggered_by, reason, scope, target_id, is_active, created_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       RETURNING *`,
      [triggeredBy, reason, scope, targetId]
    );

    const stop = result.rows[0];
    this._emit('triggered', stop);
    return stop;
  }

  async resume(stopId, resumedBy) {
    const result = await this.db.query(
      `UPDATE emergency_stops SET is_active = FALSE, resumed_at = NOW(), resumed_by = $2 WHERE stop_id = $1 RETURNING *`,
      [stopId, resumedBy]
    );

    if (result.rows.length === 0) {
      throw new EmergencyStopError('Emergency stop not found', { code: 'ERR_STOP_NOT_FOUND' });
    }

    this._emit('resumed', result.rows[0]);
    return result.rows[0];
  }

  async isActive({ scope = 'ALL', targetId = null } = {}) {
    let query = `SELECT * FROM emergency_stops WHERE is_active = TRUE`;
    const params = [];

    if (scope === 'ALL') {
      // Check global stops
    } else if (scope === 'PLATFORM') {
      query += ` AND scope = 'PLATFORM' AND target_id = $1`;
      params.push(targetId);
    } else if (scope === 'BATCH') {
      query += ` AND scope = 'BATCH' AND target_id = $1`;
      params.push(targetId);
    } else if (scope === 'JOB') {
      query += ` AND scope = 'JOB' AND target_id = $1`;
      params.push(targetId);
    }

    const result = await this.db.query(query, params);
    return result.rows.length > 0;
  }

  async getActiveStops({ scope = 'ALL', targetId = null } = {}) {
    let query = `SELECT * FROM emergency_stops WHERE is_active = TRUE`;
    const params = [];

    if (scope !== 'ALL') {
      query += ` AND scope = $1`;
      params.push(scope);
      if (targetId) {
        query += ` AND target_id = $2`;
        params.push(targetId);
      }
    }

    query += ` ORDER BY created_at DESC`;
    const result = await this.db.query(query, params);
    return result.rows;
  }

  async getHistory({ limit = 100, offset = 0 } = {}) {
    const result = await this.db.query(
      `SELECT * FROM emergency_stops ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  async checkAndEmit({ scope = 'ALL', targetId = null } = {}) {
    const active = await this.isActive({ scope, targetId });
    if (active) {
      this._emit('check_active', { scope, targetId, active: true });
    }
    return active;
  }
}