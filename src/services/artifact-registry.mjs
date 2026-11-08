import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

export class ArtifactRegistryError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'ArtifactRegistryError';
    this.code = code;
  }
}

const RETENTION_CLASSES = {
  TEMPORARY: { days: 1, description: 'Intermediate files' },
  DELIVERY: { days: 30, description: 'User-facing after delivery' },
  PUBLISHED_REFERENCE: { days: 90, description: 'Referenced by publish results' },
  SOURCE_ASSET: { days: 365, description: 'Reusable sourced media' },
  AUDIT_TOMBSTONE: { days: 3650, description: 'Minimal record after deletion' }
};

const ARTIFACT_STATUS = {
  CREATED: 'CREATED',
  ACTIVE: 'ACTIVE',
  DELIVERED: 'DELIVERED',
  RETENTION_EXPIRED: 'RETENTION_EXPIRED',
  CLEANUP_PENDING: 'CLEANUP_PENDING',
  DELETED: 'DELETED',
  QUARANTINED: 'QUARANTINED',
  RESTORE_PENDING: 'RESTORE_PENDING'
};

export class ArtifactRegistry {
  constructor({
    storage,
    db,
    config = {},
    clock = () => new Date()
  } = {}) {
    this.storage = storage;
    this.db = db;
    this.config = {
      basePath: config.basePath ?? './data/artifacts',
      maxSizeBytes: config.maxSizeBytes ?? 10 * 1024 * 1024 * 1024, // 10GB
      ...config
    };
    this.clock = clock;
    this.artifacts = new Map(); // In-memory for testing
  }

  async registerArtifact({
    jobId,
    contentPackageId,
    userId,
    bytes,
    artifactType,
    mimeType,
    width = null,
    height = null,
    durationSec = null,
    retentionClass = 'TEMPORARY',
    metadata = {},
    isSourceAsset = false
  } = {}) {
    // Validate inputs
    if (!userId) throw new ArtifactRegistryError('userId required', { code: 'ERR_INVALID_INPUT' });
    if (!jobId) throw new ArtifactRegistryError('jobId required', { code: 'ERR_INVALID_INPUT' });
    if (!contentPackageId) throw new ArtifactRegistryError('contentPackageId required', { code: 'ERR_INVALID_INPUT' });
    if (!bytes || bytes.length === 0) throw new ArtifactRegistryError('Empty bytes', { code: 'ERR_EMPTY_BYTES' });
    if (!artifactType) throw new ArtifactRegistryError('artifactType required', { code: 'ERR_INVALID_INPUT' });
    if (!mimeType) throw new ArtifactRegistryError('mimeType required', { code: 'ERR_INVALID_INPUT' });

    // Check quota
    await this._checkQuota(userId, bytes.length);

    // Compute hash
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    // Check for existing artifact with same hash (deduplication)
    const existing = await this._findByHash(sha256, userId);
    if (existing) {
      return existing;
    }

    // Create artifact record
    const artifactId = randomUUID();
    // Use asset:// for source media, artifact:// for generated artifacts
    const uriPrefix = (isSourceAsset || ['image'].includes(artifactType)) ? 'asset' : 'artifact';
    const artifactUri = `${uriPrefix}://${artifactType}/${artifactId}`;
    const now = this.clock();
    const retentionDays = RETENTION_CLASSES[retentionClass]?.days ?? 1;
    const retentionUntil = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    const record = {
      artifact_id: artifactId,
      artifact_uri: artifactUri,
      owner_user_id: userId,
      job_id: jobId,
      content_package_id: contentPackageId,
      artifact_type: artifactType,
      mime_type: mimeType,
      sha256,
      size_bytes: bytes.length,
      width,
      height,
      duration_sec: durationSec,
      status: ARTIFACT_STATUS.CREATED,
      retention_class: retentionClass,
      retention_until: retentionUntil.toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      metadata
    };

    // Store bytes
    await this.storage.write(artifactUri, bytes);

    // Persist record
    await this._persistRecord(record);

    // Update status to ACTIVE
    record.status = ARTIFACT_STATUS.ACTIVE;
    record.updated_at = this.clock().toISOString();
    await this._persistRecord(record);

    return {
      artifact_id: artifactId,
      artifact_uri: artifactUri,
      artifact_type: artifactType,
      mime_type: mimeType,
      sha256,
      size_bytes: bytes.length,
      width,
      height,
      duration_sec: durationSec,
      retention_until: record.retention_until
    };
  }

  async registerAsset({
    jobId,
    contentPackageId,
    userId,
    bytes,
    mediaType,
    width = null,
    height = null,
    durationSec = null,
    source = {},
    sceneIndex = null,
    retentionClass = 'SOURCE_ASSET',
    isSourceAsset = true
  } = {}) {
    const artifact = await this.registerArtifact({
      jobId,
      contentPackageId,
      userId,
      bytes,
      artifactType: mediaType,
      mimeType: mediaType === 'image' ? 'image/png' : mediaType === 'video' ? 'video/mp4' : 'audio/mpeg',
      width,
      height,
      durationSec,
      retentionClass,
      metadata: { source, sceneIndex },
      isSourceAsset
    });

    return {
      asset_id: artifact.artifact_id,
      asset_uri: artifact.artifact_uri,
      media_type: mediaType,
      width: artifact.width,
      height: artifact.height,
      duration_sec: artifact.duration_sec,
      sha256: artifact.sha256,
      source
    };
  }

  async getArtifact(artifactUri) {
    if (!artifactUri.startsWith('artifact://') && !artifactUri.startsWith('asset://')) {
      throw new ArtifactRegistryError('Invalid URI scheme', { code: 'ERR_INVALID_URI' });
    }

    const artifactId = artifactUri.split('/').pop();
    const record = this.artifacts.get(artifactId);
    if (!record) {
      // Try DB
      const dbRecord = await this._fetchFromDb(artifactId);
      if (!dbRecord) {
        throw new ArtifactRegistryError('Artifact not found', { code: 'ERR_ARTIFACT_NOT_FOUND' });
      }
      return dbRecord;
    }
    return record;
  }

  async getArtifactBytes(artifactUri) {
    const record = await this.getArtifact(artifactUri);
    return this.storage.read(artifactUri);
  }

  async createDownloadLink(artifactUri, userId, { expiresInHours = 24 } = {}) {
    const record = await this.getArtifact(artifactUri);
    
    // Ownership check
    if (record.owner_user_id !== userId) {
      throw new ArtifactRegistryError('Ownership mismatch', { code: 'ERR_ARTIFACT_OWNERSHIP' });
    }
    
    // Status check
    if ([ARTIFACT_STATUS.DELETED, ARTIFACT_STATUS.CLEANUP_PENDING].includes(record.status)) {
      throw new ArtifactRegistryError('Artifact not available', { code: 'ERR_ARTIFACT_UNAVAILABLE' });
    }
    
    // Retention check
    if (new Date() > new Date(record.retention_until)) {
      throw new ArtifactRegistryError('Artifact expired', { code: 'ERR_LINK_EXPIRED' });
    }

    // Generate signed/expiring link (mock implementation)
    const linkId = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    
    return {
      download_url: `https://api.example.com/artifacts/${artifactUri.replace('artifact://', '')}/download?token=${linkId}`,
      expires_at: expiresAt.toISOString(),
      artifact_uri: artifactUri
    };
  }

  async markDelivered(artifactUri) {
    const record = await this.getArtifact(artifactUri);
    record.status = ARTIFACT_STATUS.DELIVERED;
    record.updated_at = this.clock().toISOString();
    await this._persistRecord(record);
    return record;
  }

  async quarantine(artifactUri, reason) {
    const record = await this.getArtifact(artifactUri);
    record.status = ARTIFACT_STATUS.QUARANTINED;
    record.metadata = { ...record.metadata, quarantine_reason: reason, quarantined_at: this.clock().toISOString() };
    record.updated_at = this.clock().toISOString();
    await this._persistRecord(record);
    return record;
  }

  async cleanupExpired() {
    const now = this.clock();
    const expired = [];
    
    for (const [id, record] of this.artifacts.entries()) {
      if (record.status === ARTIFACT_STATUS.ACTIVE && now > new Date(record.retention_until)) {
        // Check dependencies
        const hasActiveRefs = await this._hasActiveReferences(record);
        if (!hasActiveRefs) {
          expired.push(record);
        }
      }
    }

    const results = [];
    for (const record of expired) {
      try {
        record.status = ARTIFACT_STATUS.CLEANUP_PENDING;
        record.updated_at = this.clock().toISOString();
        await this._persistRecord(record);

        await this.storage.delete(record.artifact_uri);
        
        // Keep tombstone
        record.status = ARTIFACT_STATUS.DELETED;
        record.bytes_deleted_at = this.clock().toISOString();
        await this._persistRecord(record);

        results.push({ artifact_id: record.artifact_id, status: 'DELETED' });
      } catch (error) {
        results.push({ artifact_id: record.artifact_id, status: 'FAILED', error: error.message });
      }
    }

    return results;
  }

  async getUserStorageStats(userId) {
    let totalBytes = 0;
    let artifactCount = 0;
    const byType = {};

    for (const record of this.artifacts.values()) {
      if (record.owner_user_id === userId) {
        totalBytes += record.size_bytes;
        artifactCount++;
        byType[record.artifact_type] = (byType[record.artifact_type] ?? 0) + record.size_bytes;
      }
    }

    return { totalBytes, artifactCount, byType };
  }

  // Private methods
  async _checkQuota(userId, additionalBytes) {
    const stats = await this.getUserStorageStats(userId);
    if (stats.totalBytes + additionalBytes > this.config.maxSizeBytes) {
      throw new ArtifactRegistryError('Storage quota exceeded', { code: 'ERR_STORAGE_QUOTA' });
    }
  }

  async _findByHash(sha256, userId) {
    for (const record of this.artifacts.values()) {
      if (record.sha256 === sha256 && record.owner_user_id === userId) {
        return {
          artifact_id: record.artifact_id,
          artifact_uri: record.artifact_uri,
          artifact_type: record.artifact_type,
          mime_type: record.mime_type,
          sha256: record.sha256,
          size_bytes: record.size_bytes,
          width: record.width,
          height: record.height,
          duration_sec: record.duration_sec,
          retention_until: record.retention_until
        };
      }
    }
    return null;
  }

  async _hasActiveReferences(record) {
    // Check if artifact is referenced by active jobs, approvals, or publish intents
    // This would query the database in production
    return false;
  }

  async _persistRecord(record) {
    this.artifacts.set(record.artifact_id, { ...record });
    if (this.db) {
      // Persist to PostgreSQL
      await this.db.query(
        `INSERT INTO artifacts (artifact_id, artifact_uri, owner_user_id, job_id, content_package_id, artifact_type, mime_type, sha256, size_bytes, width, height, duration_sec, status, retention_class, retention_until, created_at, updated_at, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (artifact_id) DO UPDATE SET status=$13, retention_class=$14, retention_until=$15, updated_at=$17, metadata=$18`,
        [record.artifact_id, record.artifact_uri, record.owner_user_id, record.job_id, record.content_package_id, record.artifact_type, record.mime_type, record.sha256, record.size_bytes, record.width, record.height, record.duration_sec, record.status, record.retention_class, record.retention_until, record.created_at, record.updated_at, JSON.stringify(record.metadata)]
      );
    }
  }

  async _fetchFromDb(artifactId) {
    if (!this.db) return null;
    const result = await this.db.query('SELECT * FROM artifacts WHERE artifact_id = $1', [artifactId]);
    return result.rows[0] ?? null;
  }
}

export class MockStorage {
  constructor() {
    this.files = new Map();
  }

  async write(uri, bytes) {
    this.files.set(uri, Buffer.from(bytes));
  }

  async read(uri) {
    const data = this.files.get(uri);
    if (!data) throw new Error('File not found');
    return data;
  }

  async delete(uri) {
    return this.files.delete(uri);
  }
}