// Writes types/capabilities.d.ts from the schemas, so editors suggest each event's fields and
// underline a typo, in TypeScript and plain JavaScript alike. The schemas stay the one source.
//   node scripts/types.js           write it
//   node scripts/types.js --check   fail if it's out of date (npm run check, CI)
'use strict';

const fs = require('fs');
const path = require('path');
const { SCHEMA_DIR } = require('../src/schema');

const OUT = path.join(__dirname, '..', 'types', 'capabilities.d.ts');

/** "drops.farming" + 1 -> "DropsFarmingV1" */
const prefixOf = (cap, major) =>
  cap
    .split(/[.-]/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('') + `V${major}`;

const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/** A schema as a TypeScript type. */
function toType(schema, prefix, indent = '') {
  if (schema.$ref) return schema.$ref.startsWith('common:') ? schema.$ref.slice(7) : prefix + schema.$ref.slice(1);
  if (schema.anyOf) return schema.anyOf.map((s) => toType(s, prefix, indent)).join(' | ');
  const types = [].concat(schema.type ?? []);
  if (types.length > 1) return types.map((t) => toType({ ...schema, type: t }, prefix, indent)).join(' | ');
  switch (types[0]) {
    case 'string':
      if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
      // Open lists: the known values, and any other string (a later version may add some).
      if (schema['x-open']) return `${schema['x-open'].map((v) => JSON.stringify(v)).join(' | ')} | (string & {})`;
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${toType(schema.items ?? {}, prefix, indent)}>`;
    case 'object': {
      const inner = `${indent}  `;
      const lines = [];
      const required = new Set(schema.required ?? []);
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        if (sub.description) lines.push(`${inner}/** ${sub.description} */`);
        lines.push(`${inner}${key(k)}${required.has(k) ? '' : '?'}: ${toType(sub, prefix, inner)};`);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        lines.push(`${inner}[key: string]: ${toType(schema.additionalProperties, prefix, inner)};`);
      }
      return lines.length ? `{\n${lines.join('\n')}\n${indent}}` : 'Record<string, unknown>';
    }
    default:
      return 'unknown';
  }
}

function generate() {
  const common = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'common.json'), 'utf8')).defs;
  const out = ["// Generated from schemas/ by scripts/types.js. Don't edit it: change a schema and run `npm run types`.", ''];
  for (const [name, schema] of Object.entries(common)) {
    if (schema.description) out.push(`/** ${schema.description} */`);
    out.push(`export type ${name} = ${toType(schema, '')};`, '');
  }
  const events = [];
  const methods = [];
  const caps = fs
    .readdirSync(SCHEMA_DIR)
    .filter((d) => fs.statSync(path.join(SCHEMA_DIR, d)).isDirectory())
    .sort();
  for (const cap of caps) {
    const files = fs
      .readdirSync(path.join(SCHEMA_DIR, cap))
      .filter((f) => /^\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a) - parseInt(b));
    for (const file of files) {
      const s = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, cap, file), 'utf8'));
      const prefix = prefixOf(s.capability, s.major);
      out.push(`// ${s.capability} ${s.major}.${s.minor}: ${s.description}`);
      for (const [name, def] of Object.entries(s.defs ?? {})) {
        if (def.description) out.push(`/** ${def.description} */`);
        out.push(`export type ${prefix}${name} = ${toType(def, prefix)};`, '');
      }
      // The newest major of each capability is the one the maps below use.
      if (file === files[files.length - 1]) {
        for (const [ev, sch] of Object.entries(s.events ?? {})) events.push(`  ${JSON.stringify(ev)}: ${toType(sch, prefix, '  ')};`);
        for (const [m, sch] of Object.entries(s.methods ?? {})) {
          methods.push(`  ${JSON.stringify(m)}: { params: ${toType(sch.params, prefix, '    ')}; result: ${toType(sch.result, prefix, '    ')} };`);
        }
      }
    }
  }
  out.push('/** Every event, by name: its params. */', `export interface Events {\n${events.join('\n')}\n}`, '');
  out.push('/** Every method, by name: its params and result. */', `export interface Methods {\n${methods.join('\n')}\n}`, '');
  return out.join('\n');
}

if (require.main === module) {
  const text = generate();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== text) {
      process.stderr.write('types/capabilities.d.ts is out of date with schemas/: run `npm run types`.\n');
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
  }
}

module.exports = { generate, toType, prefixOf };
