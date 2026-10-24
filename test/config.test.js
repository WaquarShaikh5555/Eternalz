'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { build, validate, describe } = require('../src/config/env');
const { redact } = require('../src/core/logger');

test('missing configuration is reported without printing secrets', () => {
  const config = build({});
  const result = validate(config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /DISCORD_TOKEN/.test(e)));
  assert.ok(result.errors.some((e) => /DISCORD_CLIENT_ID/.test(e)));
  assert.ok(result.errors.some((e) => /DISCORD_GUILD_ID/.test(e)));
  assert.ok(!result.errors.join(' ').includes('undefined'));
});

test('a missing AI key is a warning, not a fatal error', () => {
  const config = build({
    DISCORD_TOKEN: 'token-value',
    DISCORD_CLIENT_ID: 'client-value',
    DISCORD_GUILD_ID: 'guild-value',
  });
  const result = validate(config);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => /AI_API_KEY/.test(w)));
});

test('the description never contains the token or the API key', () => {
  const config = build({
    DISCORD_TOKEN: 'super-secret-discord-token',
    DISCORD_CLIENT_ID: '1234567890',
    DISCORD_GUILD_ID: '9876543210',
    AI_API_KEY: 'super-secret-ai-key',
    AI_PROVIDER: 'groq',
  });
  const text = JSON.stringify(describe(config));
  assert.ok(!text.includes('super-secret-discord-token'));
  assert.ok(!text.includes('super-secret-ai-key'));
  assert.match(text, /"apiKeyConfigured":true/);
});

test('the provider preset supplies a base URL and a model', () => {
  const config = build({ AI_PROVIDER: 'groq' });
  assert.match(config.aiBaseUrl, /api\.groq\.com/);
  assert.ok(config.aiModel.length > 0);

  const router = build({ AI_PROVIDER: 'openrouter' });
  assert.match(router.aiBaseUrl, /openrouter\.ai/);

  const gemini = build({ AI_PROVIDER: 'gemini' });
  assert.match(gemini.aiBaseUrl, /generativelanguage/);
});

test('an explicit base URL and model win over the preset', () => {
  const config = build({
    AI_PROVIDER: 'groq',
    AI_BASE_URL: 'https://example.test/v1/',
    AI_MODEL: 'my-model',
  });
  assert.equal(config.aiBaseUrl, 'https://example.test/v1');
  assert.equal(config.aiModel, 'my-model');
});

test('the administrator id list accepts comma, space and mention formats', () => {
  const config = build({ AI_ADMIN_USER_IDS: '111111111111111111, 222222222222222222 <@333333333333333333>' });
  assert.deepEqual(config.aiAdminUserIds, [
    '111111111111111111',
    '222222222222222222',
    '333333333333333333',
  ]);
});

test('multi-guild access is opt-in and warns without explicit admin user ids', () => {
  assert.equal(build({}).aiMultiGuild, false);
  const config = build({
    DISCORD_TOKEN: 't',
    DISCORD_CLIENT_ID: 'c',
    DISCORD_GUILD_ID: 'g',
    AI_MULTI_GUILD: 'true',
  });
  assert.equal(config.aiMultiGuild, true);
  assert.ok(validate(config).warnings.some((warning) => /AI_MULTI_GUILD/.test(warning)));
});

test('the emergency switches default to enabled and can be turned off', () => {
  assert.equal(build({}).aiAdminEnabled, true);
  assert.equal(build({}).aiWriteEnabled, true);
  assert.equal(build({ AI_ADMIN_ENABLED: 'false' }).aiAdminEnabled, false);
  assert.equal(build({ AI_WRITE_ENABLED: '0' }).aiWriteEnabled, false);
  assert.equal(build({ AI_ADMIN_ENABLED: 'true' }).aiAdminEnabled, true);
});

test('an unsupported provider is reported as an error', () => {
  const config = build({
    DISCORD_TOKEN: 't',
    DISCORD_CLIENT_ID: 'c',
    DISCORD_GUILD_ID: 'g',
    AI_PROVIDER: 'mystery',
    AI_API_KEY: 'k',
  });
  const result = validate(config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /mystery/.test(e)));
});

test('the logger redacts secret-looking values', () => {
  const redacted = redact({
    apiKey: 'sk-1234567890abcdefghijklmnop',
    token: 'abcdefghijklmnopqrstuvwxyz',
    nested: { password: 'hunter2' },
    safe: 'hello',
  });
  assert.equal(redacted.apiKey, '[redacted]');
  assert.equal(redacted.token, '[redacted]');
  assert.equal(redacted.nested.password, '[redacted]');
  assert.equal(redacted.safe, 'hello');
});
