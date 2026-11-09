import { createHash } from 'node:crypto';

export class RetentionCleanupError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'RetentionCleanupError';
    this.code = code;
  }
}

export const RETENTION_CLASS = {
  TEMPORARY: { days: 1, description: 'Intermediate TTS/video files' },
  DELIVERY: { days: 30, description: 'User-facing artifact after Telegram delivery' },
  PUBLISHED_REFERENCE: { days: 90, description: 'Artifact referenced by publish result/audit' },
  SOURCE_ASSET: { days: 365, description: 'Reusable sourced media with license metadata' },
  AUDIT_TOMBSTONE: { days: 3650, description: 'Minimal record after bytes are deleted' }
};

export class RetentionCleanupService {
  constructor({
    db,
    artifactRegistry,
    clock = () => new Date(),
    batchSize = 100,
    cleanupIntervalMs = 3600000
  } = {}) {
    if (!db) throw new RetentionCleanupError('db required', { code: 'ERR_CONFIG' });
    if (!artifactRegistry) throw new RetentionCleanupError('artifactRegistry required', { code: 'ERR_CONFIG' });
    
    this.db = db;
    this.artifactRegistry = artifactRegistry;
    this.clock = clock;
    this.batchSize = batchSize;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.running = false;
    this.cleanupInterval = null;
    this.listeners = new Map();
    this.stats = { scanned: 0, deleted: 0, errors: 0, lastRun: null };
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(handler);
  }

  _emit(event, data) {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) {
      try { h(data); } catch (e) { console.error(`Retention listener error (${event}):`, e); }
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.cleanupInterval = setInterval(() => this.runCleanup(), this.cleanupIntervalMs);
    this._emit('started', { timestamp: this.clock().toISOString() });
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    this._emit('stopped', { timestamp: this.clock().toISOString() });
  }

  async runCleanup() {
    if (!this.running) return;
    
    this._emit('cleanup:started', { timestamp: this.clock().toISOString() });
    
    let totalDeleted = 0;
    let totalErrors = 0;
    let hasMore = true;
    
    while (hasMore) {
      const result = await this._cleanupBatch(this.batchSize);
      totalDeleted += result.deleted;
      totalErrors += result.errors;
      hasMore = result.hasMore;
      
      if (!hasMore) break;
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    this.stats.scanned += totalDeleted + totalErrors;
    this.stats.deleted += totalDeleted;
    this.stats.errors += totalErrors;
    this.stats.lastRun = this.clock().toISOString();
    
    this._emit('cleanup:completed', { 
      deleted: totalDeleted, 
      errors: totalErrors, 
      stats: { ...this.stats } 
    });
    
    return { deleted: totalDeleted, errors: totalErrors };
  }

  async _cleanupBatch(batchSize) {
    const expired = await this._getExpiredArtifacts(batchSize);
    if (expired.length === 0) return { deleted: 0, errors: 0, hasMore: false };
    
    let deleted = 0;
    let errors = 0;
    
    for (const artifact of expired) {
      try {
        const canDelete = await this._canDelete(artifact);
        if (!canDelete) {
          await this._markRetentionExtended(artifact);
          continue;
        }
        
        await this._deleteArtifact(artifact);
        deleted++;
        
        this._emit('artifact:deleted', { artifactId: artifact.artifact_id });
      } catch (error) {
        errors++;
        this._emit('artifact:delete_failed', { artifactId: artifact.artifact_id, error: error.message });
      }
    }
    
    return { deleted, errors, hasMore: expired.length >= batchSize };
  }

  async _getExpiredArtifacts(limit) {
    const result = await this.db.query(
      `SELECT a.* FROM artifacts a
       WHERE a.retention_until < NOW()
       AND a.status IN ('ACTIVE', 'DELIVERED', 'RETENTION_EXPIRED')
       ORDER BY a.retention_until ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async _canDelete(artifact) {
    const refs = await this.db.query(
      `SELECT 1 FROM jobs j WHERE j.content_package_id = $1 AND j.status NOT IN ('COMPLETED', 'FAILED_FINAL', 'CANCELLED')
       UNION ALL
       SELECT 1 FROM queue_jobs qj WHERE qj.metadata->>'artifact_id' = $1 AND qj.status NOT IN ('COMPLETED', 'DEAD_LETTER')
       UNION ALL
       SELECT 1 FROM publish_intent pi WHERE pi.content_package_id = $1 AND pi.status NOT IN ('PUBLISHED', 'FAILED')
       UNION ALL
       SELECT 1 FROM batch_approval ba WHERE ba.content_package_id = $1 AND ba.status IN ('PENDING', 'APPROVED')
       LIMIT 1`,
      [artifact.content_package_id]
    );
    
    return refs.rows.length === 0;
  }

  async _markRetentionExtended(artifact) {
    const newRetention = new Date(this.clock().getTime() + 86400000);
    await this.db.query(
      `UPDATE artifacts SET retention_until = $2, updated_at = NOW() WHERE artifact_id = $1`,
      [artifact.artifact_id, newRetention]
    );
    this._emit('retention:extended', { artifactId: artifact.artifact_id, newRetention });
  }

  async _deleteArtifact(artifact) {
    try {
      await this.artifactRegistry.getArtifactBytes(artifact.artifact_uri);
    } catch (e) {
      // Bytes might already be gone
    }
    
    await this.artifactRegistry.storage.delete(artifact.artifact_uri).catch(() => {});
    
    await this.db.query(
      `UPDATE artifacts SET status = 'DELETED', bytes_deleted_at = NOW(), updated_at = NOW() WHERE artifact_id = $1`,
      [artifact.artifact_id]
    );
    
    await this.db.query(
      `INSERT INTO audit_events (action, user_id, job_id, content_package_id, details)
       VALUES ('ARTIFACT_CLEANUP', $1, $2, $3, $4)`,
      [artifact.owner_user_id, artifact.job_id, artifact.content_package_id, { artifact_id: artifact.artifact_id, reason: 'retention_expired' }]
    );
  }

  async cleanupOrphanedArtifacts({ limit = 100 } = {}) {
    const result = await this.db.query(
      `SELECT a.* FROM artifacts a
       LEFT JOIN jobs j ON a.job_id = j.job_id
       LEFT JOIN content_packages cp ON a.content_package_id = cp.content_package_id
       WHERE (j.job_id IS NULL OR j.status IN ('FAILED_FINAL', 'CANCELLED'))
       AND (cp.content_package_id IS NULL)
       AND a.status = 'ACTIVE'
       ORDER BY a.created_at ASC
       LIMIT $1`,
      [limit]
    );
    
    let deleted = 0;
    let errors = 0;
    
    for (const artifact of result.rows) {
      try {
        await this._deleteArtifact(artifact);
        deleted++;
      } catch (error) {
        errors++;
      }
    }
    
    return { deleted, errors };
  }

  async cleanupExpiredIdempotencyKeys() {
    const result = await this.db.query(
      `DELETE FROM telegram_idempotency WHERE expires_at < NOW() AND consumed_at IS NULL`
    );
    return result.rowCount;
  }

  async cleanupOldAuditEvents({ olderThanDays = 365 } = {}) {
    const result = await this.db.query(
      `DELETE FROM audit_events WHERE timestamp < NOW() - INTERVAL '$1 days'`,
      [olderThanDays]
    );
    return result.rowCount;
  }

  async cleanupOldStateEvents({ olderThanDays = 90 } = {}) {
    const result = await this.db.query(
      `DELETE FROM state_events WHERE timestamp < NOW() - INTERVAL '$1 days'`,
      [olderThanDays]
    );
    return result.rowCount;
  }

  getStats() {
    return { ...this.stats };
  }

  async getRetentionReport() {
    const result = await this.db.query(
      `SELECT 
         retention_class,
         status,
         COUNT(*) as count,
         MIN(retention_until) as earliest_expiry,
         MAX(retention_until) as latest_expiry
       FROM artifacts
       WHERE retention_until IS NOT NULL
       GROUP BY retention_class, status
       ORDER BY retention_class, status`
    );
    return result.rows;
  }
}

export class RetentionPolicy {
  static getClass(name) {
    return RETENTION_CLASS[name.toUpperCase()] ?? RETENTION_CLASS.TEMPORARY;
  }

  static calculateExpiry(className, from = new Date()) {
    const cls = this.getClass(className);
    return new Date(from.getTime() + cls.days * 24 * 60 * 60 * 1000);
  }

  static getDescription(className) {
    const cls = this.getClass(className);
    return cls.description;
  }
}