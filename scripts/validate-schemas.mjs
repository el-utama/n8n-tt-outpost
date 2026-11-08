import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../contracts/', import.meta.url);
const files = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
for (const name of files) {
  const data = JSON.parse(await readFile(new URL(name, root), 'utf8'));
  if (typeof data.$schema !== 'string' || typeof data.$id !== 'string' || typeof data.title !== 'string') {
    throw new Error(`Invalid schema metadata: ${name}`);
  }
  if (data.type !== 'object') throw new Error(`Top-level schema must be object: ${name}`);
  console.log(`VALID ${name} title=${data.title}`);
}
console.log(`SCHEMA_COUNT=${files.length}`);
