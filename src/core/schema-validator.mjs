import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export class SchemaValidationError extends Error {
  constructor(schemaId, errors) {
    super(`Schema validation failed: ${schemaId}`);
    this.name = 'SchemaValidationError';
    this.code = 'ERR_SCHEMA_VALIDATION';
    this.schemaId = schemaId;
    this.errors = (errors ?? []).map((error) => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
      message: error.message
    }));
  }
}

export class SchemaValidator {
  constructor({ schemas = [] } = {}) {
    this.ajv = new Ajv2020({ allErrors: true, strict: true, removeAdditional: false });
    addFormats(this.ajv);
    for (const schema of schemas) this.addSchema(schema);
  }

  addSchema(schema) {
    if (!schema || typeof schema !== 'object' || typeof schema.$id !== 'string') {
      throw new TypeError('Schema must be an object with a string $id');
    }
    this.ajv.addSchema(schema, schema.$id);
    return this;
  }

  validate(schemaId, value) {
    const validate = typeof schemaId === 'object'
      ? this.ajv.compile(schemaId)
      : this.ajv.getSchema(schemaId);
    if (!validate) throw new Error(`Unknown schema: ${schemaId}`);
    const valid = validate(value);
    if (!valid) throw new SchemaValidationError(typeof schemaId === 'string' ? schemaId : schemaId.$id ?? 'inline-schema', validate.errors);
    return true;
  }
}
