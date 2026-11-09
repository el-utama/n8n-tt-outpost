import { createHash } from 'node:crypto';

export class BatchApprovalError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'BatchApprovalError';
    this.code = code;
  }
}

export class BatchApprovalService {
  constructor({ db, clock = () => new Date() } = {}) {
    this.db = db;
    this.clock = clock;
  }

  async createBatch(context) {
    const {
      userId,
      publishIntentId,
      contentPackageIds,
      platformTargets,
      proposedSchedule,
      previewPayload,
    } = context;

    // Verify ownership of all content packages
    for (const pkgId of contentPackageIds) {
      const pkg = await this._getContentPackage(pkgId);
      if (!pkg || String(pkg.user_id) !== String(userId)) {
        throw new BatchApprovalError('Content package not found or ownership mismatch', { code: 'ERR_CONTENT_PACKAGE_OWNERSHIP' });
      }
    }

    // Compute batch hash
    const batchData = {
      publish_intent_id: publishIntentId,
      content_package_ids: contentPackageIds.sort(),
      platform_targets: platformTargets.sort(),
      proposed_schedule: proposedSchedule,
      preview_payload: previewPayload,
    };
    const batchHash = createHash('sha256').update(JSON.stringify(batchData)).digest('hex');

    // Create batch approval record
    const expiresAt = new Date(this.clock().getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const result = await this.db.query(
      `INSERT INTO batch_approvals (user_id, publish_intent_id, batch_hash, item_count, platform_targets, proposed_schedule, preview_payload, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_APPROVAL', $8)
       RETURNING *`,
      [
        userId,
        publishIntentId,
        batchHash,
        contentPackageIds.length,
        JSON.stringify(platformTargets),
        proposedSchedule ?? null,
        JSON.stringify(previewPayload),
        expiresAt,
      ]
    );

    return result.rows[0];
  }

  async getPreview(batchId, userId) {
    const batch = await this._getBatch(batchId);
    if (!batch) throw new BatchApprovalError('Batch not found', { code: 'ERR_BATCH_NOT_FOUND' });
    if (String(batch.user_id) !== String(userId)) {
      throw new BatchApprovalError('Ownership mismatch', { code: 'ERR_BATCH_OWNERSHIP' });
    }

    // Return safe preview without sensitive data
    return {
      batch_id: batch.batch_id,
      expires_at: batch.expires_at,
      item_count: batch.item_count,
      platform_targets: batch.platform_targets,
      proposed_schedule: batch.proposed_schedule,
      preview_payload: batch.preview_payload,
      quota_impact: batch.preview_payload?.quota_impact,
      warnings: batch.preview_payload?.warnings,
    };
  }

  async approve(batchId, userId, { batchHash } = {}) {
    const batch = await this._getBatch(batchId);
    if (!batch) throw new BatchApprovalError('Batch not found', { code: 'ERR_BATCH_NOT_FOUND' });
    if (String(batch.user_id) !== String(userId)) {
      throw new BatchApprovalError('Ownership mismatch', { code: 'ERR_BATCH_OWNERSHIP' });
    }
    if (batch.status !== 'PENDING_APPROVAL') {
      throw new BatchApprovalError(`Cannot approve batch in status: ${batch.status}`, { code: 'ERR_INVALID_STATUS' });
    }
    if (batch.expires_at && this.clock() > new Date(batch.expires_at)) {
      await this._updateStatus(batchId, 'EXPIRED');
      throw new BatchApprovalError('Approval expired', { code: 'ERR_APPROVAL_EXPIRED' });
    }
    if (batchHash && batch.batch_hash !== batchHash) {
      throw new BatchApprovalError('Batch hash mismatch', { code: 'ERR_BATCH_HASH_MISMATCH' });
    }

    const updated = await this._updateStatus(batchId, 'APPROVED', { approved_by: userId, approved_at: this.clock() });
    return updated;
  }

  async reject(batchId, userId) {
    const batch = await this._getBatch(batchId);
    if (!batch) throw new BatchApprovalError('Batch not found', { code: 'ERR_BATCH_NOT_FOUND' });
    if (String(batch.user_id) !== String(userId)) {
      throw new BatchApprovalError('Ownership mismatch', { code: 'ERR_BATCH_OWNERSHIP' });
    }
    if (batch.status !== 'PENDING_APPROVAL') {
      throw new BatchApprovalError(`Cannot reject batch in status: ${batch.status}`, { code: 'ERR_INVALID_STATUS' });
    }

    const updated = await this._updateStatus(batchId, 'REJECTED', { approved_by: userId, approved_at: this.clock() });
    return updated;
  }

  async invalidate(batchId, reason = 'PACKAGE_MUTATED') {
    const batch = await this._getBatch(batchId);
    if (!batch) throw new BatchApprovalError('Batch not found', { code: 'ERR_BATCH_NOT_FOUND' });
    if (['APPROVED', 'PENDING_APPROVAL'].includes(batch.status)) {
      await this._updateStatus(batchId, 'INVALIDATED');
    }
    return { batch_id: batchId, invalidated: true, reason };
  }

  async checkAndInvalidateOnChange(publishIntentId, contentPackageIds) {
    const batches = await this.db.query(
      `SELECT batch_id, batch_hash FROM batch_approvals 
       WHERE publish_intent_id = $1 AND status IN ('APPROVED', 'PENDING_APPROVAL')`,
      [publishIntentId]
    );

    for (const batch of batches.rows) {
      // Would recompute hash and compare
      await this.invalidate(batch.batch_id, 'PACKAGE_MUTATED');
    }
  }

  async _getBatch(batchId) {
    const result = await this.db.query('SELECT * FROM batch_approvals WHERE batch_id = $1', [batchId]);
    return result.rows[0] ?? null;
  }

  async _getContentPackage(pkgId) {
    const result = await this.db.query('SELECT * FROM content_packages WHERE content_package_id = $1', [pkgId]);
    return result.rows[0] ?? null;
  }

  async _updateStatus(batchId, status, extra = {}) {
    const fields = ['status = $2', 'updated_at = NOW()'];
    const values = [batchId, status];
    let paramIndex = 3;

    for (const [key, value] of Object.entries(extra)) {
      fields.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }

    values.push(batchId);
    const result = await this.db.query(
      `UPDATE batch_approvals SET ${fields.join(', ')} WHERE batch_id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async cleanupExpired() {
    const result = await this.db.query(
      `UPDATE batch_approvals SET status = 'EXPIRED', updated_at = NOW()
       WHERE status = 'PENDING_APPROVAL' AND expires_at < NOW()`
    );
    return result.rowCount;
  }
}