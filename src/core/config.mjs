import { readFile } from 'node:fs/promises';
import { SchemaValidator, SchemaValidationError } from './schema-validator.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConfigError extends Error {
  constructor(message, { cause = null } = {}) {
    super(message, { cause });
    this.name = 'ConfigError';
    this.code = 'ERR_CONFIG';
  }
}

export class Config {
  constructor(data) {
    Object.assign(this, data);
    Object.freeze(this);
  }

  static async load({ env = process.env, configPath = null, schemaPath = null } = {}) {
    const configFile = configPath ?? join(__dirname, '..', '..', 'config', 'schema.json');
    const schemaFile = schemaPath ?? configFile;

    let schema;
    try {
      schema = JSON.parse(await readFile(schemaFile, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Failed to load config schema: ${schemaFile}`, { cause: error });
    }

    const validator = new SchemaValidator({ schemas: [schema] });

    const raw = {
      nodeEnv: env.NODE_ENV ?? 'development',
      featureStage: env.FEATURE_STAGE ?? 'MVP_MANUAL',
      enableF5Publisher: env.ENABLE_F5_PUBLISHER === 'true',
      enableRealProviderCalls: env.ENABLE_REAL_PROVIDER_CALLS === 'true',
      timezone: env.TIMEZONE ?? 'Asia/Jakarta',
      database: {
        url: env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/n8n_tt_outpost',
        pool: {
          min: parseInt(env.PG_POOL_MIN ?? '2', 10),
          max: parseInt(env.PG_POOL_MAX ?? '10', 10),
          idleTimeoutMs: parseInt(env.PG_IDLE_TIMEOUT_MS ?? '30000', 10),
          connectionTimeoutMs: parseInt(env.PG_CONNECTION_TIMEOUT_MS ?? '5000', 10)
        }
      },
      nemotron: {
        baseUrl: env.NEMOTRON_BASE_URL ?? 'http://localhost:8000/v1',
        apiKey: env.NEMOTRON_API_KEY ?? '',
        modelId: env.NEMOTRON_MODEL_ID ?? null,
        servingEngine: env.NEMOTRON_SERVING_ENGINE ?? null,
        timeoutSeconds: parseInt(env.NEMOTRON_TIMEOUT_SECONDS ?? '30', 10),
        temperature: parseFloat(env.NEMOTRON_TEMPERATURE ?? '0'),
        topP: parseFloat(env.NEMOTRON_TOP_P ?? '1'),
        maxOutputTokens: parseInt(env.NEMOTRON_MAX_OUTPUT_TOKENS ?? '4096', 10)
      },
      telegram: {
        botToken: env.TELEGRAM_BOT_TOKEN ?? '',
        webhookUrl: env.TELEGRAM_WEBHOOK_URL ?? null,
        allowlist: (env.TELEGRAM_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean)
      },
      artifactStorage: {
        path: env.ARTIFACT_STORAGE_PATH ?? './data/artifacts',
        retentionDays: parseInt(env.ARTIFACT_RETENTION_DAYS ?? '30', 10),
        downloadExpiryHours: parseInt(env.ARTIFACT_DOWNLOAD_EXPIRY_HOURS ?? '24', 10)
      },
      logging: {
        level: env.LOG_LEVEL ?? 'info',
        format: env.LOG_FORMAT ?? 'json',
        redactSecrets: env.LOG_REDACT_SECRETS !== 'false'
      },
      scheduler: {
        enabled: env.SCHEDULER_ENABLED === 'true',
        concurrency: parseInt(env.QUEUE_CONCURRENCY ?? '3', 10),
        leaseTtlSeconds: parseInt(env.QUEUE_LEASE_TTL_SECONDS ?? '300', 10),
        maxRetries: parseInt(env.QUEUE_MAX_RETRIES ?? '3', 10)
      },
      publisher: {
        enabled: env.PUBLISHER_ENABLED === 'true',
        tiktok: env.TIKTOK_ADAPTER_ENABLED === 'true',
        instagram: env.INSTAGRAM_ADAPTER_ENABLED === 'true',
        facebook: env.FACEBOOK_ADAPTER_ENABLED === 'true'
      }
    };

    try {
      validator.validate(schema.$id, raw);
    } catch (error) {
      if (error instanceof SchemaValidationError) {
        const details = error.errors.map(e => `${e.instancePath}: ${e.message}`).join('; ');
        throw new ConfigError(`Config validation failed: ${details}`, { cause: error });
      }
      throw error;
    }

    return new Config(raw);
  }

  getDatabaseUrl() {
    return this.database.url;
  }

  getNemotronProfile() {
    const n = this.nemotron;
    return {
      model_id: n.modelId ?? 'nemotron-default',
      serving_engine: n.servingEngine ?? 'unknown',
      timeout_seconds: n.timeoutSeconds,
      tool_calling: true,
      structured_output: true,
      max_output_tokens: n.maxOutputTokens,
      temperature: n.temperature,
      top_p: n.topP
    };
  }

  isFeatureEnabled(feature) {
    switch (feature) {
      case 'F5_PUBLISHER':
        return this.enableF5Publisher && this.featureStage === 'F5_PUBLISHER';
      case 'F4_SCHEDULER':
        return this.featureStage === 'F4_SCHEDULER' || this.featureStage === 'F5_PUBLISHER';
      case 'REAL_PROVIDER_CALLS':
        return this.enableRealProviderCalls;
      default:
        return false;
    }
  }

  toSafeObject() {
    const safe = { ...this };
    safe.nemotron = { ...safe.nemotron, apiKey: '***' };
    safe.telegram = { ...safe.telegram, botToken: '***' };
    safe.database = { ...safe.database, url: safe.database.url.replace(/:([^:@]+)@/, ':***@') };
    return safe;
  }
}

export async function loadConfig(options = {}) {
  return Config.load(options);
}