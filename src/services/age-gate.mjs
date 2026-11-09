export class AgeGateError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'AgeGateError';
    this.code = code;
  }
}

export class AgeGateService {
  constructor({ db, clock = () => new Date() } = {}) {
    this.db = db;
    this.clock = clock;
  }

  async evaluate(accountId, platform) {
    const account = await this._getAccount(accountId);
    if (!account) {
      throw new AgeGateError('Account not found', { code: 'ERR_ACCOUNT_NOT_FOUND' });
    }

    if (account.platform !== platform) {
      throw new AgeGateError(`Account platform mismatch: ${account.platform} vs ${platform}`, { code: 'ERR_PLATFORM_MISMATCH' });
    }

    const ageGate = await this._getAgeGate(accountId, platform);
    if (!ageGate) {
      return this._createDefault(accountId, platform);
    }

    return ageGate;
  }

  async update(accountId, platform, { ageDays, verifiedAt, status }) {
    const existing = await this._getAgeGate(accountId, platform);
    
    if (!existing) {
      return this._create(accountId, platform, { ageDays, verifiedAt, status });
    }

    const updates = {};
    if (ageDays !== undefined) updates.age_days = ageDays;
    if (verifiedAt !== undefined) updates.verified_at = verifiedAt;
    if (status !== undefined) updates.age_gate_status = status;
    updates.updated_at = this.clock();

    return this._update(existing.age_gate_id, updates);
  }

  async verify(accountId, platform, { ageDays, verificationMethod = 'manual' }) {
    const status = this._calculateStatus(ageDays);
    
    return this.update(accountId, platform, {
      ageDays,
      verifiedAt: this.clock().toISOString(),
      status,
    });
  }

  _calculateStatus(ageDays) {
    if (ageDays < 31) return 'verified_0_30';
    if (ageDays < 90) return 'verified_31_90';
    return 'verified_90_plus';
  }

  isEligibleForMode(ageGate, mode) {
    if (mode === 'MANUAL') return { eligible: true };

    if (!ageGate || ageGate.age_gate_status === 'unverified') {
      return { eligible: false, reason: 'AGE_UNVERIFIED' };
    }

    const requiredAge = mode === 'FULL_AUTO' ? 90 : 31;
    if (ageGate.age_days !== null && ageGate.age_days < requiredAge) {
      return { eligible: false, reason: 'AGE_BELOW_THRESHOLD' };
    }

    return { eligible: true };
  }

  async _getAccount(accountId) {
    const result = await this.db.query('SELECT * FROM accounts WHERE account_id = $1', [accountId]);
    return result.rows[0] ?? null;
  }

  async _getAgeGate(accountId, platform) {
    const result = await this.db.query(
      'SELECT * FROM age_gates WHERE account_id = $1 AND platform = $2',
      [accountId, platform]
    );
    return result.rows[0] ?? null;
  }

  async _create(accountId, platform, { ageDays, verifiedAt, status }) {
    const ageGateStatus = status ?? this._calculateStatus(ageDays);
    const ageDaysValue = ageDays ?? null;
    const verifiedAtValue = verifiedAt ?? (ageDays !== null ? this.clock().toISOString() : null);

    const result = await this.db.query(
      `INSERT INTO age_gates (account_id, platform, age_gate_status, age_days, verified_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [accountId, platform, ageGateStatus, ageDaysValue, verifiedAtValue]
    );
    return result.rows[0];
  }

  async _update(ageGateId, updates) {
    const fields = [];
    const values = [ageGateId];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }

    if (fields.length === 0) return null;

    const result = await this.db.query(
      `UPDATE age_gates SET ${fields.join(', ')} WHERE age_gate_id = $1 RETURNING *`,
      values
    );
    return result.rows[0] ?? null;
  }
}