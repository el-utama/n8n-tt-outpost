import { SchemaValidationError } from '../core/schema-validator.mjs';

export class NemotronAdapterError extends Error {
  constructor(code, message, { retryable = false, status = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'NemotronAdapterError';
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = status;
  }
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NemotronAdapterError('ERR_CONFIG_INVALID', `${name} must be a non-empty string`);
  }
}

function stripReasoningTags(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function parseObjectArguments(raw, toolName) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') {
    throw new NemotronAdapterError('ERR_TOOL_ARGUMENTS_INVALID', `Tool ${toolName} arguments are not an object`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch (cause) {
    throw new NemotronAdapterError('ERR_TOOL_ARGUMENTS_INVALID', `Tool ${toolName} arguments are invalid JSON`, { cause });
  }
}

export class NemotronAdapter {
  constructor({
    profile,
    validator,
    env = process.env,
    fetchImpl = globalThis.fetch,
    allowNetwork = false,
    apiKeyReference = 'NEMOTRON_API_KEY',
    baseUrlReference = null,
    clock = () => Date.now()
  } = {}) {
    if (!profile || typeof profile !== 'object') throw new NemotronAdapterError('ERR_CONFIG_INVALID', 'Model profile is required');
    assertString(profile.model_id, 'profile.model_id');
    assertString(profile.serving_engine, 'profile.serving_engine');
    if (!Number.isInteger(profile.timeout_seconds) || profile.timeout_seconds < 1) {
      throw new NemotronAdapterError('ERR_CONFIG_INVALID', 'profile.timeout_seconds must be a positive integer');
    }
    if (profile.tool_calling !== true) {
      throw new NemotronAdapterError('ERR_TOOL_CALLING_UNAVAILABLE', 'Model profile does not enable tool calling');
    }
    if (typeof fetchImpl !== 'function') throw new NemotronAdapterError('ERR_RUNTIME_UNAVAILABLE', 'fetch implementation is unavailable');
    this.profile = profile;
    this.validator = validator;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.allowNetwork = allowNetwork;
    this.apiKeyReference = apiKeyReference;
    this.baseUrlReference = baseUrlReference ?? profile.base_url_reference ?? 'NEMOTRON_BASE_URL';
    this.clock = clock;
  }

  validateToolDefinitions(tools, allowedTools = null) {
    if (!Array.isArray(tools)) throw new NemotronAdapterError('ERR_TOOL_SCHEMA_INVALID', 'tools must be an array');
    const names = new Set();
    for (const tool of tools) {
      const fn = tool?.function;
      assertString(fn?.name, 'tool.function.name');
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(fn.name)) {
        throw new NemotronAdapterError('ERR_TOOL_SCHEMA_INVALID', `Invalid tool name: ${fn.name}`);
      }
      if (names.has(fn.name)) throw new NemotronAdapterError('ERR_TOOL_SCHEMA_INVALID', `Duplicate tool: ${fn.name}`);
      if (!fn.parameters || fn.parameters.type !== 'object') {
        throw new NemotronAdapterError('ERR_TOOL_SCHEMA_INVALID', `Tool ${fn.name} must have object parameters schema`);
      }
      if (allowedTools && !allowedTools.has(fn.name)) {
        throw new NemotronAdapterError('ERR_TOOL_NOT_ALLOWED', `Tool is not allowlisted: ${fn.name}`);
      }
      names.add(fn.name);
    }
    return names;
  }

  #endpoint() {
    const baseUrl = this.env[this.baseUrlReference];
    assertString(baseUrl, `Environment reference ${this.baseUrlReference}`);
    return baseUrl.replace(/\/+$/, '') + '/chat/completions';
  }

  #headers() {
    const headers = { 'content-type': 'application/json' };
    const apiKey = this.env[this.apiKeyReference];
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return headers;
  }

  #normalize(raw, toolDefinitions, responseSchema = null) {
    const choice = raw?.choices?.[0];
    const message = choice?.message;
    if (!message || typeof message !== 'object') {
      throw new NemotronAdapterError('ERR_PROVIDER_RESPONSE_INVALID', 'Provider response has no valid choice message');
    }
    const definitions = new Map(toolDefinitions.map((tool) => [tool.function.name, tool.function]));
    const toolCalls = [];
    for (const call of message.tool_calls ?? []) {
      const name = call?.function?.name;
      if (!definitions.has(name)) throw new NemotronAdapterError('ERR_TOOL_NOT_ALLOWED', `Provider requested unknown tool: ${name}`);
      const args = parseObjectArguments(call.function.arguments, name);
      if (this.validator) {
        try {
          this.validator.validate(definitions.get(name).parameters.$id ?? definitions.get(name).parameters, args);
        } catch (error) {
          if (error instanceof Error && error.code === 'ERR_SCHEMA_VALIDATION') throw error;
          throw new NemotronAdapterError('ERR_TOOL_ARGUMENTS_SCHEMA_INVALID', `Arguments failed validation for ${name}`, { cause: error });
        }
      }
      toolCalls.push({ id: String(call.id ?? `${name}-${toolCalls.length + 1}`), name, arguments: args });
    }
    const content = stripReasoningTags(message.content ?? null);
    if (responseSchema && content !== null && this.validator) {
      let parsed;
      try { parsed = JSON.parse(content); } catch (cause) {
        throw new NemotronAdapterError('ERR_STRUCTURED_OUTPUT_INVALID', 'Model content is not valid JSON', { cause });
      }
      this.validator.validate(responseSchema.$id ?? responseSchema, parsed);
    }
    const result = {
      request_id: String(raw.id ?? `local-${this.clock()}`),
      model: String(raw.model ?? this.profile.model_id),
      content,
      tool_calls: toolCalls,
      finish_reason: choice.finish_reason ?? null,
      usage: {
        prompt_tokens: raw.usage?.prompt_tokens ?? null,
        completion_tokens: raw.usage?.completion_tokens ?? null,
        total_tokens: raw.usage?.total_tokens ?? null
      }
    };
    return result;
  }

  async complete({ messages, tools = [], allowedTools = null, responseSchema = null, temperature = this.profile.temperature, topP = this.profile.top_p, maxOutputTokens = this.profile.max_output_tokens, signal = null } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) throw new NemotronAdapterError('ERR_REQUEST_INVALID', 'messages must be a non-empty array');
    const allowSet = allowedTools ? new Set(allowedTools) : null;
    this.validateToolDefinitions(tools, allowSet);
    if (responseSchema && !this.profile.structured_output) {
      throw new NemotronAdapterError('ERR_STRUCTURED_OUTPUT_UNAVAILABLE', 'Model profile does not enable structured output');
    }
    if (!this.allowNetwork) {
      throw new NemotronAdapterError('ERR_PROVIDER_CALL_DISABLED', 'External Nemotron calls are disabled by configuration');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.profile.timeout_seconds * 1000);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    const payload = {
      model: this.profile.model_id,
      messages,
      tools,
      tool_choice: tools.length ? 'auto' : undefined,
      temperature,
      top_p: topP,
      max_tokens: maxOutputTokens,
      response_format: responseSchema ? { type: 'json_schema', json_schema: { name: responseSchema.title ?? 'structured_response', strict: true, schema: responseSchema } } : undefined
    };
    try {
      const response = await this.fetchImpl(this.#endpoint(), { method: 'POST', headers: this.#headers(), body: JSON.stringify(payload), signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new NemotronAdapterError(retryable ? 'ERR_PROVIDER_RETRYABLE' : 'ERR_PROVIDER_REJECTED', 'Nemotron provider request failed', { retryable, status: response.status });
      }
      return this.#normalize(body, tools, responseSchema);
    } catch (error) {
      if (error instanceof NemotronAdapterError || error instanceof SchemaValidationError) throw error;
      if (error?.name === 'AbortError') throw new NemotronAdapterError('ERR_PROVIDER_TIMEOUT', 'Nemotron request timed out', { retryable: true, cause: error });
      throw new NemotronAdapterError('ERR_PROVIDER_NETWORK', 'Nemotron provider network error', { retryable: true, cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
