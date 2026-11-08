#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/core/config.mjs';
import { runMigrationsUp, runMigrationsDown, getMigrationStatus, createMigration, MigrationError } from '../src/db/migrate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function dirname(path) {
  return path.replace(/\/[^/]*$/, '');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const config = await loadConfig();

  try {
    switch (command) {
      case 'up': {
        const targetVersion = args[1] ?? null;
        console.log('Running migrations up...', targetVersion ? `to ${targetVersion}` : '');
        const results = await runMigrationsUp(config, { targetVersion });
        for (const r of results) {
          console.log(`  ${r.version} (${r.name}): ${r.status}${r.executionTimeMs ? ` (${r.executionTimeMs}ms)` : ''}`);
        }
        console.log('Migrations completed.');
        break;
      }
      case 'down': {
        const steps = parseInt(args[1] ?? '1', 10);
        console.log(`Rolling back ${steps} migration(s)...`);
        const results = await runMigrationsDown(config, { steps });
        for (const r of results) {
          console.log(`  ${r.version} (${r.name}): ${r.status}`);
        }
        console.log('Rollback completed.');
        break;
      }
      case 'status': {
        console.log('Migration status:');
        const status = await getMigrationStatus(config);
        for (const s of status) {
          const mark = s.status === 'APPLIED' ? '✓' : s.status === 'PENDING' ? '○' : '✗';
          console.log(`  ${mark} ${s.version} (${s.name}) - ${s.status}`);
        }
        break;
      }
      case 'create': {
        const name = args.slice(1).join(' ');
        if (!name) {
          console.error('Usage: migrate create <name>');
          process.exit(1);
        }
        const migration = await createMigration(name);
        console.log(`Created migration: ${migration.filepath}`);
        break;
      }
      default:
        console.log(`
Usage: migrate <command> [args]

Commands:
  up [version]        Apply all pending migrations (or up to version)
  down [steps]        Roll back last N migrations (default: 1)
  status              Show migration status
  create <name>       Create new migration file

Examples:
  migrate up
  migrate up 003
  migrate down 2
  migrate status
  migrate create "add user preferences"
        `);
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof MigrationError) {
      console.error(`Migration error (${error.code}): ${error.message}`);
    } else {
      console.error('Error:', error.message);
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();