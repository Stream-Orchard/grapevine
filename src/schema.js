// A small JSON Schema checker for the subset the capability schemas use, so the package needs no
// dependencies. Unknown properties are always allowed: a newer minor version may add fields, and
// apps must ignore what they don't know (PROTOCOL.md, "Versions").
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.join(__dirname, '..', 'schemas');
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const fits = (actual, wanted) => actual === wanted || (wanted === 'number' && actual === 'integer');

/**
 * Checks `value` against `schema`. Returns a list of problems ("drop.progress.done: expected integer"),
 * empty when it's valid.
 * @param {any} value
 * @param {any} schema
 * @param {(ref: string) => any} resolve looks up a "$ref"
 */
function check(value, schema, resolve, at = '') {
  if (schema.$ref) return check(value, resolve(schema.$ref), resolve, at);
  const where = at || '(message)';
  const problems = [];
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => fits(typeOf(value), t))) return [`${where}: expected ${types.join(' or ')}, got ${typeOf(value)}`];
  }
  if (schema.anyOf && !schema.anyOf.some((s) => check(value, s, resolve, at).length === 0)) problems.push(`${where}: matches none of the allowed shapes`);
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${where}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${where}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${where}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) problems.push(`${where}: doesn't match ${schema.pattern}`);
    if (schema.format === 'date-time' && !DATE_TIME.test(value)) problems.push(`${where}: not an ISO 8601 time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${where}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${where}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${where}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...check(item, schema.items, resolve, `${at}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${at ? `${at}.` : ''}${key}: missing`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...check(value[key], sub, resolve, at ? `${at}.${key}` : key));
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const [key, v] of Object.entries(value)) {
        if (!(key in (schema.properties ?? {}))) problems.push(...check(v, schema.additionalProperties, resolve, at ? `${at}.${key}` : key));
      }
    }
  }
  return problems;
}

/**
 * A capability's schemas, one file per major version: { capability, major, minor, events, methods, defs }.
 * "$ref" is "#Name" for the file's own defs and "common:Name" for the shared types.
 */
class Schemas {
  constructor() {
    this.common = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'common.json'), 'utf8')).defs;
    /** @type {Map<string, any>} "capability@major" -> schema file */
    this.byKey = new Map();
  }

  /** Loads every schema in the package, plus any extra folders (for apps adding their own capabilities). */
  static load(extraDirs = []) {
    const s = new Schemas();
    for (const dir of [SCHEMA_DIR, ...extraDirs]) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!fs.statSync(full).isDirectory()) continue;
        for (const file of fs.readdirSync(full).filter((f) => /^\d+\.json$/.test(f))) s.add(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')));
      }
    }
    return s;
  }

  add(schema) {
    if (!schema.capability || !Number.isInteger(schema.major) || !Number.isInteger(schema.minor)) throw new Error('A schema needs capability, major and minor');
    this.byKey.set(`${schema.capability}@${schema.major}`, schema);
  }

  get(capability, major) {
    return this.byKey.get(`${capability}@${major}`) ?? null;
  }

  /** "drops.farming.changed" -> "drops.farming": the capability a method or event belongs to. */
  capabilityOf(name) {
    let best = null;
    for (const key of this.byKey.keys()) {
      const cap = key.slice(0, key.lastIndexOf('@'));
      if (name.startsWith(`${cap}.`) && (!best || cap.length > best.length)) best = cap;
    }
    return best;
  }

  resolver(file) {
    return (ref) => {
      const found = ref.startsWith('common:') ? this.common[ref.slice(7)] : ref.startsWith('#') ? file.defs?.[ref.slice(1)] : undefined;
      if (!found) throw new Error(`Unknown schema reference ${ref}`);
      return found;
    };
  }

  /**
   * Checks an event's params, or a method's params or result, for one major version.
   * @param {'event' | 'params' | 'result'} kind
   * @returns {string[]} problems; empty when valid
   */
  validate(capability, major, kind, name, value) {
    const file = this.get(capability, major);
    if (!file) return [`no schema for ${capability}@${major}`];
    const schema = kind === 'event' ? file.events?.[name] : file.methods?.[name]?.[kind];
    if (!schema) return [`${name} isn't part of ${capability}@${major}`];
    return check(value, schema, this.resolver(file));
  }
}

module.exports = { check, Schemas, SCHEMA_DIR };
