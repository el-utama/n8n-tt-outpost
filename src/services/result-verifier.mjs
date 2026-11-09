import { SchemaValidator } from '../core/schema-validator.mjs';

export class ResultVerifierError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'ResultVerifierError';
    this.code = code;
  }
}

export class ResultVerifier {
  constructor({
    adapters = {},
    db,
    clock = () => new Date(),
    maxVerificationDelayMs = 30000,
  } = {}) {
    this.adapters = adapters;
    this.db = db;
    this.clock = clock;
    this.maxVerificationDelayMs = maxVerificationDelayMs;
  }

  async verify(publishResult) {
    const adapter = this.adapters[publishResult.platform];
    if (!adapter) {
      throw new ResultVerifierError(`No adapter for platform: ${publishResult.platform}`, { code: 'ERR_NO_ADAPTER' });
    }

    const verification = await adapter.verify(publishResult);
    
    if (verification.verified) {
      await this._updateResultStatus(publishResult.publish_result_id, 'PUBLISHED', {
        remote_post_id: verification.remote_post_id,
        remote_url: verification.remote_url,
        verified_at: verification.published_at ?? this.clock().toISOString(),
      });
      return { status: 'PUBLISHED', verification };
    }

    // Not verified - could be pending or failed
    if (verification.reason === 'NO_MOCK_RECORD' || verification.reason === 'PENDING_VERIFICATION') {
      await this._updateResultStatus(publishResult.publish_result_id, 'PENDING_VERIFICATION');
      return { status: 'PENDING_VERIFICATION', verification };
    }

    return { status: 'FAILED_VERIFICATION', verification };
  }

  async verifyBatch(publishResults) {
    const results = [];
    for (const result of publishResults) {
      try {
        const verified = await this.verify(result);
        results.push({ publish_result_id: result.publish_result_id, ...verified });
      } catch (error) {
        results.push({ 
          publish_result_id: result.publish_result_id, 
          status: 'VERIFICATION_ERROR', 
          error: error.message 
        });
      }
    }
    return results;
  }

  async checkPendingVerifications({ maxAgeMs = 300000 } = {}) {
    const cutoff = new Date(this.clock().getTime() - maxAgeMs);
    const result = await this.db.query(
      `SELECT * FROM publish_results 
       WHERE status IN ('UPLOADING', 'PENDING_VERIFICATION') 
       AND created_at < $1`,
      [cutoff]
    );

    const verified = [];
    for (const pr of result.rows) {
      try {
        const adapter = this.adapters[pr.platform];
        if (!adapter) continue;
        
        const verification = await adapter.verify(pr);
        if (verification.verified) {
          await this._updateResultStatus(pr.publish_result_id, 'PUBLISHED', {
            remote_post_id: verification.remote_post_id,
            remote_url: verification.remote_url,
            verified_at: verification.published_at ?? this.clock().toISOString(),
          });
          verified.push({ publish_result_id: pr.publish_result_id, verification });
        }
      } catch (error) {
        // Log error but continue
      }
    }
    return verified;
  }

  async _updateResultStatus(publishResultId, status, extra = {}) {
    const fields = ['status = $2', 'updated_at = NOW()'];
    const values = [publishResultId, status];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(extra)) {
      fields.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }

    await this.db.query(
      `UPDATE publish_results SET ${fields.join(', ')} WHERE publish_result_id = $${paramIndex}`,
      values
    );
  }

  async getVerificationStatus(publishResultId) {
    const result = await this.db.query(
      'SELECT * FROM publish_results WHERE publish_result_id = $1',
      [publishResultId]
    );
    return result.rows[0] ?? null;
  }
}