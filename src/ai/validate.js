'use strict';

/**
 * A small, dependency-free JSON-Schema subset validator.
 *
 * It exists so that every model-proposed action is checked against a strict
 * schema before it can touch Discord. Supported keywords:
 *
 *   type      : 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
 *   enum      : [ ... ]
 *   required  : [ ... ]
 *   properties: { name: <schema> }
 *   items     : <schema>
 *   default   : value applied when the property is absent
 *   minimum / maximum / minLength / maxLength / minItems / maxItems
 *   additionalProperties : false  -> unknown keys are rejected
 *   nullable  : true -> null accepted
 *
 * Unknown keywords are ignored, so the same schemas can be handed to a model
 * provider as plain JSON Schema.
 */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

/**
 * @param {*} value
 * @param {object} schema
 * @param {string} [path]
 * @returns {{ok: boolean, value: *, errors: string[]}}
 */
function validate(value, schema, path = '') {
  const errors = [];
  const label = path || 'value';

  if (!schema || typeof schema !== 'object') {
    return { ok: true, value, errors };
  }

  if (value === undefined) {
    if ('default' in schema) {
      return { ok: true, value: clone(schema.default), errors };
    }
    return { ok: true, value: undefined, errors };
  }

  if (value === null) {
    if (schema.nullable) return { ok: true, value: null, errors };
    errors.push(`${label} must not be null`);
    return { ok: false, value, errors };
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${label} must be of type ${schema.type} (received ${typeOf(value)})`);
    return { ok: false, value, errors };
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${label} must be one of: ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${label} must be at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${label} must be at most ${schema.maxLength} characters`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${label} must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${label} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${label} must contain at least ${schema.minItems} item(s)`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${label} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      const out = [];
      value.forEach((item, index) => {
        const res = validate(item, schema.items, `${label}[${index}]`);
        if (!res.ok) errors.push(...res.errors);
        else out.push(res.value);
      });
      if (errors.length === 0) value = out;
    }
  }

  if (typeOf(value) === 'object') {
    const properties = schema.properties || {};
    const result = {};

    for (const key of Object.keys(properties)) {
      const res = validate(value[key], properties[key], path ? `${path}.${key}` : key);
      if (!res.ok) {
        errors.push(...res.errors);
      } else if (res.value !== undefined) {
        result[key] = res.value;
      }
    }

    for (const key of schema.required || []) {
      const present = Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
      if (!present) {
        errors.push(`${path ? `${path}.` : ''}${key} is required`);
      }
    }

    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(properties));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) {
          errors.push(`${path ? `${path}.` : ''}${key} is not an allowed property`);
        }
      }
    } else {
      // Preserve undeclared properties so we can report them elsewhere.
      for (const key of Object.keys(value)) {
        if (!(key in result) && !(key in properties)) result[key] = value[key];
      }
    }

    value = result;
  }

  return { ok: errors.length === 0, value, errors };
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = clone(v);
  return out;
}

module.exports = { validate, clone };
