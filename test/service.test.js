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
const { makeGuild, makePermissions } = require('./helpers/mock-discord');
const { Cooldown, RateLimiter } = require('../src/core/rate-limiter');
const { STATUS } = require('../src/admin/confirmation');
const { grantGuildAdmin, grantKey } = require('../src/admin/grants');

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

test('a configured administrator can execute a safe plan in another guild in multi-guild mode', async () => {
  const env = await makeEnvironment();
  env.config.aiMultiGuild = true;
  env.config.aiAdminUserIds = ['admin-1'];
  const guild = makeGuild({
    id: 'other-guild',
    ownerId: 'someone-else',
    members: [{ id: 'admin-1', username: 'admin', permissions: ['Administrator'] }],
  });
  const provider = fakeProvider([
    { text: 'The server is ready.', toolCalls: [] },
    {
      text: null,
      toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }],
    },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'admin-1', prompt: 'create a Support category' }),
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
  assert.equal(result.report.failed.length, 0);
  assert.ok(guild.channels.cache.find((channel) => channel.name === 'Support'));
  assert.ok(provider.calls.length >= 2);
  const auditEntries = await env.storage.listAudit('other-guild', 10);
  assert.ok(auditEntries.some((entry) => entry.event === 'executed'));
  await env.storage.close();
});

test('an unconfigured server administrator cannot use multi-guild AI access', async () => {
  const env = await makeEnvironment();
  env.config.aiMultiGuild = true;
  env.config.aiAdminUserIds = ['admin-1'];
  const guild = makeGuild({
    id: 'other-guild',
    ownerId: 'someone-else',
    members: [{ id: 'other-admin', permissions: ['Administrator'] }],
  });
  const provider = fakeProvider([{ text: 'should not be called', toolCalls: [] }]);

  await assert.rejects(
    () => handleAdminRequest({
      interaction: fakeInteraction({ guild, userId: 'other-admin', prompt: 'create a channel' }),
      guild,
      config: env.config,
      storage: env.storage,
      audit: env.audit,
      logger: null,
      limiter: env.limiter,
      cooldown: env.cooldown,
      provider,
    }),
    /configured AI administrators/,
  );
  assert.equal(provider.calls.length, 0);
  await env.storage.close();
});

test('multi-guild confirmation rejects an administrator whose access was revoked', async () => {
  const env = await makeEnvironment();
  env.config.aiMultiGuild = true;
  env.config.aiAdminUserIds = ['admin-1'];
  const guild = makeGuild({
    id: 'other-guild',
    ownerId: 'someone-else',
    channels: [{ id: 'c1', name: 'spam' }],
    members: [{ id: 'admin-1', permissions: ['Administrator'] }],
  });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'delete_channel', arguments: { channel: 'spam' } }] },
  ]);

  const pending = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'admin-1', prompt: 'delete spam' }),
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  });
  assert.equal(pending.kind, 'awaiting_confirmation');

  guild.members.cache.get('admin-1').permissions = makePermissions([]);
  const interaction = fakeInteraction({ guild, userId: 'admin-1', prompt: '' });
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
  assert.ok(guild.channels.cache.has('c1'));
  assert.equal((await env.storage.getPlan(pending.plan.id)).status, STATUS.CANCELLED);
  await env.storage.close();
});

test('a persisted add-admin grant works only in the guild where it was issued', async () => {
  const env = await makeEnvironment();
  env.config.aiMultiGuild = true;
  const guild = makeGuild({ id: 'granted-guild', ownerId: 'someone-else' });
  await grantGuildAdmin(env.storage, {
    guildId: guild.id,
    userId: 'member-1',
    addedBy: 'owner-user',
  });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }] },
  ]);

  const result = await handleAdminRequest({
    interaction: fakeInteraction({ guild, userId: 'member-1', prompt: 'create Support' }),
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
  assert.equal(result.report.failed.length, 0);

  const callsBeforeOtherGuild = provider.calls.length;
  const otherGuild = makeGuild({ id: 'not-granted-guild', ownerId: 'someone-else' });
  await assert.rejects(
    () => handleAdminRequest({
      interaction: fakeInteraction({ guild: otherGuild, userId: 'member-1', prompt: 'create Support' }),
      guild: otherGuild,
      config: env.config,
      storage: env.storage,
      audit: env.audit,
      logger: null,
      limiter: env.limiter,
      cooldown: env.cooldown,
      provider,
    }),
    /configured AI administrators/,
  );
  assert.equal(provider.calls.length, callsBeforeOtherGuild);
  await env.storage.close();
});

test('a granted administrator still needs confirmation and is rechecked after revocation', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ channels: [{ id: 'general-channel', name: 'general' }] });
  await grantGuildAdmin(env.storage, {
    guildId: guild.id,
    userId: 'member-1',
    addedBy: 'owner-user',
  });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'delete_channel', arguments: { channel: 'general' } }] },
  ]);
  const interaction = fakeInteraction({ guild, userId: 'member-1', prompt: 'delete general' });

  const result = await handleAdminRequest({
    interaction,
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
  assert.ok(guild.channels.cache.find((channel) => channel.name === 'general'));

  // Removing the stored grant must affect an already-created confirmation.
  await env.storage.setSetting(guild.id, grantKey('member-1'), null);
  interaction.customId = `ai_admin:confirm:${result.plan.id}`;
  const confirmation = await handlePlanButton({
    interaction,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    client: null,
  });
  assert.equal(confirmation.kind, 'unauthorised');
  assert.ok(guild.channels.cache.find((channel) => channel.name === 'general'));
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

test('a separate rename-it follow-up reuses the created channel instead of creating a duplicate', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'create_channel', arguments: { name: 'old-channel' } }] },
    { text: null, toolCalls: [] },
    // Simulate a model repeating the previous mistake. The application guard
    // must still turn this lone create into the explicitly requested rename.
    { text: null, toolCalls: [{ id: '2', name: 'create_channel', arguments: { name: 'new-channel' } }] },
  ]);
  const common = {
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
  };

  const created = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create a channel called old-channel' }),
  });
  assert.equal(created.kind, 'executed');
  const original = guild.channels.cache.find((channel) => channel.name === 'old-channel');
  assert.ok(original);
  const originalId = original.id;
  const countAfterCreate = guild.channels.cache.size;

  const renamed = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'rename it to new-channel' }),
  });

  assert.equal(renamed.kind, 'executed');
  assert.equal(renamed.report.succeeded[0].tool, 'rename_channel');
  assert.equal(guild.channels.cache.size, countAfterCreate, 'no duplicate channel may be created');
  assert.equal(guild.channels.cache.get(originalId).name, 'new-channel');
  const secondRequest = provider.calls[2].messages[1].content;
  assert.match(secondRequest, /<recent_admin_context>/);
  assert.ok(secondRequest.includes(originalId), 'the follow-up must receive the earlier channel id');
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

const moderationScenarios = [
  {
    tool: 'timeout_member',
    args: {},
    verify(guild, targetId) {
      const target = guild.members.cache.get(targetId);
      assert.ok(target.communicationDisabledUntilTimestamp > Date.now());
    },
  },
  {
    tool: 'kick_member',
    args: {},
    verify(guild, targetId) {
      assert.ok(guild.__kicked.some((member) => member.id === targetId));
    },
  },
  {
    tool: 'ban_member',
    args: {},
    verify(guild, targetId) {
      assert.ok(guild.__banned.some((member) => member.id === targetId));
    },
  },
];

for (const scenario of moderationScenarios) {
  test(`${scenario.tool} accepts a Discord mention and executes only after confirmation`, async () => {
    const env = await makeEnvironment();
    const targetId = '123456789012345678';
    const guild = makeGuild({
      ownerId: 'owner-1',
      members: [{ id: targetId, username: 'spammer' }],
    });
    const provider = fakeProvider([
      { text: null, toolCalls: [] },
      {
        text: null,
        toolCalls: [{
          id: '1',
          name: scenario.tool,
          arguments: { member: `<@${targetId}>`, ...scenario.args },
        }],
      },
    ]);
    const common = {
      guild,
      config: env.config,
      storage: env.storage,
      audit: env.audit,
      logger: null,
      limiter: env.limiter,
      cooldown: env.cooldown,
      provider,
    };

    const pending = await handleAdminRequest({
      ...common,
      interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: `moderate <@${targetId}>` }),
    });
    assert.equal(pending.kind, 'awaiting_confirmation');
    assert.equal(pending.plan.risk, 'confirm');
    assert.equal(guild.__banned.length, 0);
    assert.equal(guild.__kicked.length, 0);
    assert.equal(guild.members.cache.get(targetId).communicationDisabledUntilTimestamp, null);
    if (scenario.tool === 'timeout_member') {
      assert.equal(pending.plan.actions[0].args.minutes, 5, 'a mute without a duration defaults to five minutes');
    }

    const confirmation = fakeInteraction({ guild, userId: 'owner-1', prompt: '' });
    confirmation.customId = `ai_admin:confirm:${pending.plan.id}`;
    const executed = await handlePlanButton({
      interaction: confirmation,
      guild,
      config: env.config,
      storage: env.storage,
      audit: env.audit,
      logger: null,
      client: null,
    });

    assert.equal(executed.kind, 'executed');
    scenario.verify(guild, targetId);
    await env.storage.close();
  });
}

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
