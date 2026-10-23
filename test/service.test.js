'use strict';

/**
 * End-to-end tests for the AI administration pipeline:
 *
 *   request -> authorise -> rate limit -> inspect -> plan -> risk
 *           -> (auto execute | ask for confirmation) -> verify -> report -> audit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleAdminRequest, handlePlanButton } = require('../src/admin/service');
const { JsonStore } = require('../src/storage/json-driver');
const { AuditLogger } = require('../src/audit/audit');
const { makeGuild } = require('./helpers/mock-discord');
const { Cooldown, RateLimiter } = require('../src/core/rate-limiter');
const { STATUS } = require('../src/admin/confirmation');

function fakeProvider(responses) {
  let index = 0;
  const calls = [];
  return {
    kind: 'openai-compatible',
    model: 'test-model',
    calls,
    async chat(request) {
      calls.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    },
  };
}

function fakeInteraction({ guild, userId, prompt, dryRun = false }) {
  const replies = [];
  return {
    user: { id: userId },
    guild,
    options: {
      // Match the real Discord.js CommandInteractionOptionResolver API.
      getString: (name) => (name === 'prompt' ? prompt : null),
      getBoolean: (name) => (name === 'dry_run' ? dryRun : null),
    },
    customId: null,
    deferred: false,
    replied: false,
    replies,
    async deferReply() {
      this.deferred = true;
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.replied = true;
      replies.push(payload);
    },
    async reply(payload) {
      this.replied = true;
      replies.push(payload);
    },
  };
}

function makeConfig(overrides = {}) {
  return {
    aiAdminEnabled: true,
    aiWriteEnabled: true,
    discordGuildId: 'guild-1',
    aiAdminUserIds: [],
    aiAdminRoleIds: [],
    aiApiKey: 'test-key',
    aiMaxActions: 25,
    aiMaxPlanningRounds: 3,
    aiTemperature: 0.2,
    aiRequestCooldownMs: 0,
    aiConfirmTimeoutMs: 5 * 60_000,
    aiAuditChannelId: '',
    ...overrides,
  };
}

async function makeEnvironment() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-service-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();
  const config = makeConfig();
  const audit = new AuditLogger({ storage, config });
  return {
    storage,
    audit,
    config,
    limiter: new RateLimiter({ limit: 50, windowMs: 60_000 }),
    cooldown: new Cooldown(),
  };
}

test('an unauthorised request never reaches the AI provider', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  const provider = fakeProvider([{ text: 'sure', toolCalls: [] }]);

  await assert.rejects(
    () =>
      handleAdminRequest({
        interaction: fakeInteraction({ guild, userId: 'random-user', prompt: 'delete everything' }),
        guild,
        config: env.config,
        storage: env.storage,
        audit: env.audit,
        logger: null,
        limiter: env.limiter,
        cooldown: env.cooldown,
        provider,
      }),
    /configured administrators/i,
  );

  assert.equal(provider.calls.length, 0, 'the AI must not be contacted for an unauthorised user');
  await env.storage.close();
});

test('a request for the wrong guild is refused', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ id: 'other-guild', ownerId: 'owner-1' });
  const provider = fakeProvider([{ text: 'sure', toolCalls: [] }]);

  await assert.rejects(
    () =>
      handleAdminRequest({
        interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create a channel' }),
        guild,
        config: env.config,
        storage: env.storage,
        audit: env.audit,
        logger: null,
        limiter: env.limiter,
        cooldown: env.cooldown,
        provider,
      }),
    /restricted to the configured server/i,
  );
  assert.equal(provider.calls.length, 0);
  await env.storage.close();
});

test('a missing AI key produces a clear setup error instead of a crash', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  env.config.aiApiKey = '';

  await assert.rejects(
    () =>
      handleAdminRequest({
        interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create a channel' }),
        guild,
        config: env.config,
        storage: env.storage,
        audit: env.audit,
        logger: null,
        limiter: env.limiter,
        cooldown: env.cooldown,
        provider: fakeProvider([{ text: '', toolCalls: [] }]),
      }),
    /AI_API_KEY/,
  );
  await env.storage.close();
});

test('a safe request is executed automatically and audited', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    {
      text: null,
      toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }],
    },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create a Support category' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  assert.equal(result.kind, 'executed');
  assert.equal(result.report.succeeded.length, 1);
  assert.equal(result.report.failed.length, 0);
  assert.ok(guild.channels.cache.find((c) => c.name === 'Support'));

  const auditEntries = await env.storage.listAudit('guild-1', 10);
  const events = auditEntries.map((e) => e.event);
  assert.ok(events.includes('planned'));
  assert.ok(events.includes('executed'));
  await env.storage.close();
});

test('a destructive request asks for confirmation instead of running', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({
    ownerId: 'owner-1',
    channels: [{ id: 'c1', name: 'spam' }],
  });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    {
      text: null,
      toolCalls: [{ id: '1', name: 'delete_channel', arguments: { channel: 'spam' } }],
    },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'delete the spam channel' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  assert.equal(result.kind, 'awaiting_confirmation');
  assert.equal(result.plan.risk, 'confirm');
  assert.equal(result.plan.requesterId, 'owner-1');
  assert.ok(guild.channels.cache.has('c1'), 'nothing may be deleted before confirmation');

  const stored = await env.storage.getPlan(result.plan.id);
  assert.equal(stored.status, STATUS.PENDING);
  await env.storage.close();
});

test('only the requester can confirm a pending plan', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1', channels: [{ id: 'c1', name: 'spam' }] });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'delete_channel', arguments: { channel: 'spam' } }] },
  ]);

  const pending = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'delete spam' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  const interaction = fakeInteraction({ guild, userId: 'someone-else', prompt: '' });
  interaction.customId = `ai_admin:confirm:${pending.plan.id}`;
  const result = await handlePlanButton({
    interaction,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    client: null,
  });

  assert.equal(result.kind, 'unauthorised');
  assert.ok(guild.channels.cache.has('c1'), 'the channel must survive an unauthorised confirmation');
  const stored = await env.storage.getPlan(pending.plan.id);
  assert.equal(stored.status, STATUS.PENDING);
  await env.storage.close();
});

test('the requester can confirm a plan and the change is applied', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1', channels: [{ id: 'c1', name: 'spam' }] });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'delete_channel', arguments: { channel: 'spam' } }] },
  ]);

  const pending = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'delete spam' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  const interaction = fakeInteraction({ guild, userId: 'owner-1', prompt: '' });
  interaction.customId = `ai_admin:confirm:${pending.plan.id}`;
  const result = await handlePlanButton({
    interaction,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    client: null,
  });

  assert.equal(result.kind, 'executed');
  assert.equal(result.report.succeeded.length, 1);
  assert.equal(guild.channels.cache.has('c1'), false);
  await env.storage.close();
});

test('the requester can cancel a plan', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1', channels: [{ id: 'c1', name: 'spam' }] });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'delete_channel', arguments: { channel: 'spam' } }] },
  ]);

  const pending = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'delete spam' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  const interaction = fakeInteraction({ guild, userId: 'owner-1', prompt: '' });
  interaction.customId = `ai_admin:cancel:${pending.plan.id}`;
  const result = await handlePlanButton({
    interaction,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    client: null,
  });

  assert.equal(result.kind, 'cancelled');
  assert.ok(guild.channels.cache.has('c1'));
  const stored = await env.storage.getPlan(pending.plan.id);
  assert.equal(stored.status, STATUS.CANCELLED);
  await env.storage.close();
});

test('a destructive bulk plan needs a second confirmation', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({
    ownerId: 'owner-1',
    channels: [
      { id: 'c1', name: 'a' },
      { id: 'c2', name: 'b' },
      { id: 'c3', name: 'c' },
    ],
  });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    {
      text: null,
      toolCalls: [
        { id: '1', name: 'delete_channel', arguments: { channel: 'a' } },
        { id: '2', name: 'delete_channel', arguments: { channel: 'b' } },
        { id: '3', name: 'delete_channel', arguments: { channel: 'c' } },
      ],
    },
  ]);

  const pending = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'delete a, b and c' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  assert.equal(pending.plan.risk, 'confirm_twice');

  const first = fakeInteraction({ guild, userId: 'owner-1', prompt: '' });
  first.customId = `ai_admin:confirm:${pending.plan.id}`;
  const firstResult = await handlePlanButton({
    interaction: first,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    client: null,
  });

  assert.equal(firstResult.kind, 'second_confirmation');
  assert.ok(guild.channels.cache.has('c1'), 'nothing may be deleted yet');

  const second = fakeInteraction({ guild, userId: 'owner-1', prompt: '' });
  second.customId = `ai_admin:confirm_twice:${pending.plan.id}`;
  const secondResult = await handlePlanButton({
    interaction: second,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    client: null,
  });

  assert.equal(secondResult.kind, 'executed');
  assert.equal(secondResult.report.succeeded.length, 3);
  assert.equal(guild.channels.cache.size, 0);
  await env.storage.close();
});

test('a dry run produces a plan but changes nothing', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }] },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({
      guild,
      userId: 'owner-1',
      prompt: 'create a Support category',
      dryRun: true,
    }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  assert.equal(result.kind, 'dry_run');
  assert.equal(guild.channels.cache.find((c) => c.name === 'Support'), undefined);
  await env.storage.close();
});

test('a partial failure is reported precisely', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    {
      text: null,
      toolCalls: [
        { id: '1', name: 'create_channel', arguments: { name: 'x', category: 'missing' } },
        { id: '2', name: 'create_category', arguments: { name: 'Support' } },
      ],
    },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create stuff' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  assert.equal(result.kind, 'executed');
  assert.equal(result.report.succeeded.length, 1);
  assert.equal(result.report.failed.length, 1);
  assert.match(result.report.summary, /1 change applied, 1 failed/);

  const auditEntries = await env.storage.listAudit('guild-1', 10);
  assert.ok(auditEntries.some((e) => e.event === 'partial_failure'));
  await env.storage.close();
});

test('writes can be disabled without breaking the rest of the bot', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  env.config.aiWriteEnabled = false;
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }] },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create a Support category' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });

  assert.equal(result.kind, 'executed');
  assert.equal(result.report.succeeded.length, 0);
  assert.equal(result.report.skipped.length, 1);
  assert.equal(guild.channels.cache.find((c) => c.name === 'Support'), undefined);
  await env.storage.close();
});

test('the cooldown blocks a second request from the same user', async () => {
  const env = await makeEnvironment();
  env.config.aiRequestCooldownMs = 60_000;
  const guild = makeGuild({ ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }] },
  ]);

  const base = {
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  };

  await handleAdminRequest({
    ...base,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'one' }),
  });

  await assert.rejects(
    () =>
      handleAdminRequest({
        ...base,
        interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'two' }),
      }),
    /wait \d+s/i,
  );
  await env.storage.close();
});
