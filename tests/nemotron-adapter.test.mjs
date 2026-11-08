import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NemotronAdapter, NemotronAdapterError } from '../src/adapters/nemotron.mjs';
import { SchemaValidationError, SchemaValidator } from '../src/core/schema-validator.mjs';

const loadJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

async function setup() {
  const toolSchema = await loadJson('../contracts/tool-call.schema.json');
  const responseSchema = await loadJson('../contracts/nemotron-response.schema.json');
  const tool = await loadJson('./fixtures/tool-definition.json');
  const validator = new SchemaValidator({ schemas: [toolSchema, responseSchema] });
  const profile = {
    model_id: 'nemotron-test',
    serving_engine: 'vllm',
    timeout_seconds: 1,
    tool_calling: true,
    structured_output: true,
    max_output_tokens: 256,
    temperature: 0,
    top_p: 1
  };
  return { toolSchema, responseSchema, tool, validator, profile };
}

function mockFetch(body, { delayMs = 0 } = {}) {
  return async (_url, _options) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { ok: true, status: 200, json: async () => body };
  };
}

test('normalizes a valid Nemotron tool call and validates arguments', async () => {
  const { tool, validator, profile, responseSchema } = await setup();
  const adapter = new NemotronAdapter({
    profile,
    validator,
    allowNetwork: true,
    env: { NEMOTRON_BASE_URL: 'http://mock.local/v1' },
    fetchImpl: mockFetch({
      id: 'chatcmpl-test',
      model: 'nemotron-test',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: '<think>internal reasoning</think>',
          tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_project_file', arguments: '{"relative_path":"docs/design.md"}' } }]
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
    })
  });
  const result = await adapter.complete({
    messages: [{ role: 'user', content: 'Read design' }],
    tools: [tool],
    allowedTools: ['read_project_file']
  });
  assert.equal(result.tool_calls[0].name, 'read_project_file');
  assert.deepEqual(result.tool_calls[0].arguments, { relative_path: 'docs/design.md' });
  assert.equal(result.content, '');
  validator.validate(responseSchema.$id, result);
});

test('rejects a tool outside the allowlist before provider call', async () => {
  const { tool, validator, profile } = await setup();
  const adapter = new NemotronAdapter({ profile, validator, allowNetwork: true, env: { NEMOTRON_BASE_URL: 'http://mock.local' }, fetchImpl: mockFetch({}) });
  await assert.rejects(
    adapter.complete({ messages: [{ role: 'user', content: 'x' }], tools: [tool], allowedTools: ['safe_other_tool'] }),
    (error) => error instanceof NemotronAdapterError && error.code === 'ERR_TOOL_NOT_ALLOWED'
  );
});

test('rejects invalid tool arguments against the tool parameter schema', async () => {
  const { tool, validator, profile } = await setup();
  const adapter = new NemotronAdapter({
    profile,
    validator,
    allowNetwork: true,
    env: { NEMOTRON_BASE_URL: 'http://mock.local' },
    fetchImpl: mockFetch({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', function: { name: 'read_project_file', arguments: '{"relative_path":42}' } }] } }] })
  });
  await assert.rejects(
    adapter.complete({ messages: [{ role: 'user', content: 'x' }], tools: [tool] }),
    (error) => error instanceof SchemaValidationError || error.code === 'ERR_SCHEMA_VALIDATION'
  );
});

test('blocks network calls by default', async () => {
  const { tool, validator, profile } = await setup();
  const adapter = new NemotronAdapter({ profile, validator, env: { NEMOTRON_BASE_URL: 'http://mock.local' }, fetchImpl: mockFetch({}) });
  await assert.rejects(
    adapter.complete({ messages: [{ role: 'user', content: 'x' }], tools: [tool] }),
    (error) => error instanceof NemotronAdapterError && error.code === 'ERR_PROVIDER_CALL_DISABLED'
  );
});

test('validates structured JSON output against the requested schema', async () => {
  const { tool, validator, profile } = await setup();
  const structuredSchema = {
    $id: 'https://n8n-tt-outpost.local/schemas/test-structured-output.schema.json',
    title: 'TestStructuredOutput',
    type: 'object',
    required: ['decision'],
    properties: { decision: { type: 'string', enum: ['ALLOW', 'HOLD', 'DENY'] } },
    additionalProperties: false
  };
  validator.addSchema(structuredSchema);
  const adapter = new NemotronAdapter({
    profile,
    validator,
    allowNetwork: true,
    env: { NEMOTRON_BASE_URL: 'http://mock.local' },
    fetchImpl: mockFetch({
      id: 'chatcmpl-structured',
      model: 'nemotron-test',
      choices: [{ finish_reason: 'stop', message: { content: '{"decision":"HOLD"}', tool_calls: [] } }],
      usage: {}
    })
  });
  const result = await adapter.complete({
    messages: [{ role: 'user', content: 'Return a policy decision' }],
    tools: [],
    responseSchema: structuredSchema
  });
  assert.equal(result.content, '{"decision":"HOLD"}');
});

test('classifies timeout as retryable', async () => {
  const { tool, validator, profile } = await setup();
  const adapter = new NemotronAdapter({
    profile,
    validator,
    allowNetwork: true,
    env: { NEMOTRON_BASE_URL: 'http://mock.local' },
    fetchImpl: async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
  });
  await assert.rejects(
    adapter.complete({ messages: [{ role: 'user', content: 'x' }], tools: [tool] }),
    (error) => error instanceof NemotronAdapterError && error.code === 'ERR_PROVIDER_TIMEOUT' && error.retryable === true
  );
});
