import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, getPool, withTransaction, DatabaseError } from './pool.mjs';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function dirname(path) {
  return path.replace(/\/[^/]*$/, '');
}

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const MIGRATION_TABLE = 'schema_migrations';

export class MigrationError extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'MigrationError';
    this.code = code;
  }
}

async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version       VARCHAR(255) PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      checksum      VARCHAR(64) NOT NULL,
      applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_time_ms INTEGER NOT NULL
    )
  `);
}

function computeChecksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function getAppliedMigrations(pool) {
  const result = await pool.query(`SELECT version, checksum FROM ${MIGRATION_TABLE} ORDER BY version`);
  return new Map(result.rows.map(r => [r.version, r.checksum]));
}

async function getMigrationFiles() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files;
}

async function readMigration(file) {
  const content = await import('node:fs/promises').then(fs => fs.readFile(join(MIGRATIONS_DIR, file), 'utf8'));
  const version = file.split('_')[0];
  const name = file.replace('.sql', '');
  return { version, name, content, checksum: computeChecksum(content) };
}

export async function runMigrationsUp(config, { targetVersion = null } = {}) {
  const pool = createPool(config);
  await ensureMigrationTable(pool);

  const applied = await getAppliedMigrations(pool);
  const files = await getMigrationFiles();

  const results = [];

  for (const file of files) {
    const { version, name, content, checksum } = await readMigration(file);

    if (targetVersion && version > targetVersion) break;

    if (applied.has(version)) {
      const existingChecksum = applied.get(version);
      if (existingChecksum !== checksum) {
        throw new MigrationError(`Migration ${version} (${name}) checksum mismatch. Expected ${existingChecksum}, got ${checksum}. Manual intervention required.`, { code: 'ERR_CHECKSUM_MISMATCH' });
      }
      results.push({ version, name, status: 'SKIPPED', reason: 'Already applied' });
      continue;
    }

    const start = Date.now();
    try {
      await withTransaction(pool, async (client) => {
        await client.query(content);
        await client.query(
          `INSERT INTO ${MIGRATION_TABLE} (version, name, checksum, execution_time_ms) VALUES ($1, $2, $3, $4)`,
          [version, name, checksum, Date.now() - start]
        );
      });
      results.push({ version, name, status: 'APPLIED', executionTimeMs: Date.now() - start });
    } catch (error) {
      throw new MigrationError(`Failed to apply migration ${version} (${name}): ${error.message}`, { cause: error, code: 'ERR_MIGRATION_FAILED' });
    }
  }

  await closePool();
  return results;
}

export async function runMigrationsDown(config, { steps = 1 } = {}) {
  const pool = createPool(config);
  await ensureMigrationTable(pool);

  const applied = await getAppliedMigrations(pool);
  const files = await getMigrationFiles();

  const appliedVersions = Array.from(applied.keys()).sort((a, b) => b.localeCompare(a));
  const toRollback = appliedVersions.slice(0, steps);

  const results = [];

  for (const version of toRollback) {
    const file = files.find(f => f.startsWith(version + '_'));
    if (!file) {
      results.push({ version, status: 'FAILED', reason: 'Migration file not found' });
      continue;
    }

    const { name } = await readMigration(file);

    try {
      await withTransaction(pool, async (client) => {
        await client.query(`DELETE FROM ${MIGRATION_TABLE} WHERE version = $1`, [version]);
      });
      results.push({ version, name, status: 'ROLLED_BACK' });
    } catch (error) {
      throw new MigrationError(`Failed to rollback migration ${version} (${name}): ${error.message}`, { cause: error, code: 'ERR_ROLLBACK_FAILED' });
    }
  }

  await closePool();
  return results;
}

export async function getMigrationStatus(config) {
  const pool = createPool(config);
  await ensureMigrationTable(pool);

  const applied = await getAppliedMigrations(pool);
  const files = await getMigrationFiles();

  const status = [];
  for (const file of files) {
    const { version, name, checksum } = await readMigration(file);
    const appliedChecksum = applied.get(version);
    status.push({
      version,
      name,
      status: applied.has(version) ? (appliedChecksum === checksum ? 'APPLIED' : 'CHECKSUM_MISMATCH') : 'PENDING',
      checksum,
      appliedChecksum
    });
  }

  await closePool();
  return status;
}

export async function createMigration(name) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
  const version = timestamp;
  const filename = `${version}_${name.toLowerCase().replace(/\s+/g, '_')}.sql`;
  const filepath = join(MIGRATIONS_DIR, filename);

  const template = `-- Migration ${version}: ${name}
-- Description: 
-- Author: n8n-tt-outpost
-- Date: ${new Date().toISOString().split('T')[0]}

-- TODO: Add migration statements here

`;

  await import('node:fs/promises').then(fs => fs.writeFile(filepath, template, 'utf8'));
  return { version, name, filepath };
}