'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validate } = require('../src/ai/validate');
const { validateToolCall, getTool, toolNames, ALL_TOOLS } = require('../src/discord/tools');

test('the tool registry is not empty and contains no duplicate names', () => {
  const names = toolNames();
  assert.ok(names.length > 15, 'expected a useful number of tools');
  assert.equal(new Set(names).size, names.length);
});

test('every tool has a description and an object schema', () => {
  for (const tool of ALL_TOOLS) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 10, `${tool.name} needs a real description`);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(typeof tool.execute, 'function');
  }
});

test('an unknown tool is rejected', () => {
  const result = validateToolCall('rm_rf_slash', { path: '/' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /allowlist/i);
});

test('a missing required argument is rejected', () => {
  const result = validateToolCall('rename_channel', { channel: 'general' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /name is required/);
});

test('an argument of the wrong type is rejected', () => {
  const result = validateToolCall('set_channel_slowmode', { channel: 'general', seconds: 'fast' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /seconds must be of type integer/);
});

test('an unknown argument is rejected when additionalProperties is false', () => {
  const result = validateToolCall('create_channel', { name: 'x', evil: true });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /not an allowed property/);
});

test('an out-of-range number is rejected', () => {
  const result = validateToolCall('set_channel_slowmode', { channel: 'general', seconds: 999999 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /must be <= 21600/);
});

test('a value outside the enum is rejected', () => {
  const result = validateToolCall('create_channel', { name: 'x', type: 'hologram' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /must be one of/);
});

test('a valid call is accepted and normalised', () => {
  const result = validateToolCall('create_channel', {
    name: 'general',
    type: 'text',
    slowmode: 30,
  });
  assert.equal(result.ok, true);
  assert.equal(result.args.name, 'general');
  assert.equal(result.args.slowmode, 30);
});

test('arguments must be an object, not an array or a string', () => {
  assert.equal(validateToolCall('create_channel', ['a']).ok, false);
  assert.equal(validateToolCall('create_channel', 'a').ok, false);
});

test('the mini validator applies defaults', () => {
  const result = validate({}, { type: 'object', properties: { a: { type: 'string', default: 'x' } } });
  assert.equal(result.ok, true);
  assert.equal(result.value.a, 'x');
});

test('the mini validator rejects nested wrong types', () => {
  const result = validate(
    { list: [1, 'two'] },
    { type: 'object', properties: { list: { type: 'array', items: { type: 'number' } } } },
  );
  assert.equal(result.ok, false);
});

test('the mini validator rejects null unless nullable is set', () => {
  assert.equal(validate(null, { type: 'string' }).ok, false);
  assert.equal(validate(null, { type: 'string', nullable: true }).ok, true);
});

test('the mini validator enforces required properties', () => {
  const result = validate({}, { type: 'object', required: ['id'], properties: { id: { type: 'string' } } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /id is required/);
});

test('the mini validator enforces string length bounds', () => {
  const schema = { type: 'string', minLength: 2, maxLength: 4 };
  assert.equal(validate('a', schema).ok, false);
  assert.equal(validate('abcde', schema).ok, false);
  assert.equal(validate('abc', schema).ok, true);
});

test('getTool returns null for an unknown tool', () => {
  assert.equal(getTool('nope'), null);
});
