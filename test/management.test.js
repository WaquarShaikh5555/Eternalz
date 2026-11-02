'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { handleAdminRequest, handlePlanButton } = require('../src/admin/service');
const { getTool, validateToolCall } = require('../src/discord/tools');
const { assessAction, RISK } = require('../src/admin/risk');
const { JsonStore } = require('../src/storage/json-driver');
const { AuditLogger } = require('../src/audit/audit');
const { Cooldown, RateLimiter } = require('../src/core/rate-limiter');
const { makeGuild } = require('./helpers/mock-discord');

function fakeInteraction({ guild, userId, prompt }) {
  const replies = [];
  return {
    user: { id: userId },
    guild,
    options: {
      getString: (name) => (name === 'prompt' ? prompt : null),
      getBoolean: () => null,
    },
    customId: null,
    replies,
    async deferReply() {},
    async deferUpdate() {},
    async editReply(payload) { replies.push(payload); },
    async reply(payload) { replies.push(payload); },
  };
}

async function makeEnvironment() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-management-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();
  const config = {
    aiAdminEnabled: true,
    aiWriteEnabled: true,
    discordGuildId: 'guild-1',
    aiAdminUserIds: [],
    aiAdminRoleIds: [],
    aiApiKey: 'test-key',
    aiMaxActions: 25,
    aiMaxPlanningRounds: 3,
    aiTemperature: 0,
    aiRequestCooldownMs: 0,
    aiConfirmTimeoutMs: 300000,
    aiAuditChannelId: '',
  };
  return {
    storage,
    config,
    audit: new AuditLogger({ storage, config }),
    limiter: new RateLimiter({ limit: 50, windowMs: 60000 }),
    cooldown: new Cooldown(),
  };
}

const owner = { id: 'owner-1', username: 'owner', permissions: ['Administrator'] };
const target = { id: '123456789012345678', username: 'member', permissions: [], roles: ['r1'] };

function noProvider() {
  return { kind: 'test', chat: async () => { throw new Error('Direct request should not call AI'); } };
}

async function setup(guild) {
  const env = await makeEnvironment();
  const common = {
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider: noProvider(),
  };
  return { env, common };
}

async function confirmPlan(guild, env, result, userId = 'owner-1') {
  const interaction = fakeInteraction({ guild, userId });
  interaction.customId = `ai_admin:confirm:${result.plan.id}`;
  const output = await handlePlanButton({
    guild,
    interaction,
    storage: env.storage,
    audit: env.audit,
    config: env.config,
    logger: null,
  });
  assert.equal(output.kind, 'executed');
  assert.equal(output.report.failed.length, 0, JSON.stringify(output.report.failed));
  return output;
}

test('direct multi-step nickname, topic and slowmode changes execute without a provider', async () => {
  const guild = makeGuild({
    ownerId: 'owner-1',
    channels: [{ id: 'c1', name: 'general', type: ChannelType.GuildText }],
    roles: [{ id: 'r1', name: 'Member', position: 1 }, { id: 'r2', name: 'Eternalz', position: 10 }],
    members: [owner, { ...target, roles: ['r1'] }, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const { env, common } = await setup(guild);
  const renamed = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'change @member nickname to Helpful Member' }),
  });
  assert.equal(renamed.kind, 'executed');
  assert.equal(renamed.report.failed.length, 0, JSON.stringify(renamed.report.failed));
  assert.equal(guild.members.cache.get(target.id).nickname, 'Helpful Member');
  const topic = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'set the topic of #general to "Welcome everyone"' }),
  });
  assert.equal(topic.kind, 'executed');
  assert.equal(guild.channels.cache.get('c1').topic, 'Welcome everyone');
  const slowmode = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'set slowmode in #general to 30 seconds' }),
  });
  assert.equal(slowmode.kind, 'executed');
  assert.equal(guild.channels.cache.get('c1').rateLimitPerUser, 30);
  await env.storage.close();
});

test('server rename and NSFW changes require requester-bound confirmation', async () => {
  const guild = makeGuild({
    ownerId: 'owner-1',
    channels: [{ id: 'c1', name: 'general', type: ChannelType.GuildText }],
    roles: [{ id: 'r2', name: 'Eternalz', position: 10 }],
    members: [owner, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const { env, common } = await setup(guild);
  const originalName = guild.name;
  const renamed = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'rename the server to Eternalz HQ' }),
  });
  assert.equal(renamed.kind, 'awaiting_confirmation');
  assert.equal(guild.name, originalName);
  await confirmPlan(guild, env, renamed);
  assert.equal(guild.name, 'Eternalz HQ');

  const nsfw = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'mark #general as nsfw' }),
  });
  assert.equal(nsfw.kind, 'awaiting_confirmation');
  assert.equal(guild.channels.cache.get('c1').nsfw, false);
  await confirmPlan(guild, env, nsfw);
  assert.equal(guild.channels.cache.get('c1').nsfw, true);
  await env.storage.close();
});

test('invite creation is confirmed and uses validated expiry and use limits', async () => {
  const guild = makeGuild({
    ownerId: 'owner-1',
    channels: [{ id: 'c1', name: 'general', type: ChannelType.GuildText, permissions: ['ViewChannel', 'CreateInstantInvite'] }],
    roles: [{ id: 'r2', name: 'Eternalz', position: 10 }],
    members: [owner, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const { env, common } = await setup(guild);
  const result = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'create an invite for #general that allows 5 uses' }),
  });
  assert.equal(result.kind, 'awaiting_confirmation');
  assert.equal(result.plan.actions[0].args.maxUses, 5);
  assert.equal(result.plan.actions[0].args.maxAgeSeconds, 86400);
  assert.equal(guild.__invited.length, 0);
  await confirmPlan(guild, env, result);
  assert.equal(guild.__invited.length, 1);
  assert.equal(guild.__invited[0].maxUses, 5);
  assert.equal(guild.__invited[0].unique, true);
  await env.storage.close();
});

test('voice disconnect requires confirmation and verifies the resulting voice state', async () => {
  const guild = makeGuild({
    ownerId: 'owner-1',
    roles: [{ id: 'r1', name: 'Member', position: 1 }, { id: 'r2', name: 'Eternalz', position: 10 }],
    members: [owner, { ...target, roles: ['r1'], voiceChannelId: 'voice-1' }, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const { env, common } = await setup(guild);
  const result = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'disconnect @member from voice' }),
  });
  assert.equal(result.kind, 'awaiting_confirmation');
  assert.equal(guild.members.cache.get(target.id).voice.channelId, 'voice-1');
  await confirmPlan(guild, env, result);
  assert.equal(guild.members.cache.get(target.id).voice.channelId, null);
  await env.storage.close();
});

test('voice move uses the destination channel and verifies the resulting state', async () => {
  const guild = makeGuild({
    ownerId: 'owner-1',
    channels: [{ id: 'voice-2', name: 'voice-2', type: ChannelType.GuildVoice, permissions: ['ViewChannel', 'Connect', 'MoveMembers'] }],
    roles: [{ id: 'r1', name: 'Member', position: 1 }, { id: 'r2', name: 'Eternalz', position: 10 }],
    members: [owner, { ...target, roles: ['r1'], voiceChannelId: 'voice-1' }, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const { env, common } = await setup(guild);
  const result = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'move @member to voice #voice-2' }),
  });
  assert.equal(result.kind, 'awaiting_confirmation');
  assert.equal(guild.members.cache.get(target.id).voice.channelId, 'voice-1');
  await confirmPlan(guild, env, result);
  assert.equal(guild.members.cache.get(target.id).voice.channelId, 'voice-2');
  await env.storage.close();
});

test('clear timeout removes an active restriction only after confirmation', async () => {
  const guild = makeGuild({
    ownerId: 'owner-1',
    roles: [{ id: 'r1', name: 'Member', position: 1 }, { id: 'r2', name: 'Eternalz', position: 10 }],
    members: [owner, { ...target, roles: ['r1'] }, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const member = guild.members.cache.get(target.id);
  member.communicationDisabledUntilTimestamp = Date.now() + 60000;
  const { env, common } = await setup(guild);
  const result = await handleAdminRequest({
    ...common,
    interaction: fakeInteraction({ guild, userId: 'owner-1', prompt: 'unmute @member' }),
  });
  assert.equal(result.kind, 'awaiting_confirmation');
  assert.ok(member.communicationDisabledUntilTimestamp > Date.now());
  await confirmPlan(guild, env, result);
  assert.equal(member.communicationDisabledUntilTimestamp, null);
  await env.storage.close();
});

test('clear timeout and invite access changes are never auto-executed', () => {
  const invite = validateToolCall('create_invite', { channel: 'general' });
  assert.equal(invite.ok, true);
  assert.equal(invite.args.maxAgeSeconds, 86400);
  assert.equal(invite.args.maxUses, 0);
  assert.equal(invite.args.temporary, false);

  for (const [tool, args] of [
    ['clear_timeout', { member: '@member' }],
    ['unban_member', { member: '123456789012345678' }],
    ['create_invite', { channel: 'general' }],
    ['disconnect_member_voice', { member: '@member' }],
  ]) {
    assert.equal(assessAction({ tool, args, toolDef: getTool(tool) }).level, RISK.CONFIRM);
  }
});

test('voice move is not reported as successful when fresh voice state is stale', async () => {
  const guild = makeGuild({
    channels: [{ id: 'voice-2', name: 'voice-2', type: ChannelType.GuildVoice, permissions: ['ViewChannel', 'Connect', 'MoveMembers'] }],
    roles: [{ id: 'r1', name: 'Member', position: 1 }, { id: 'r2', name: 'Eternalz', position: 10 }],
    members: [{ ...target, roles: ['r1'], voiceChannelId: 'voice-1' }, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const member = guild.members.cache.get(target.id);
  member.voice.fetch = async () => ({ channelId: 'voice-1' });
  await assert.rejects(
    () => getTool('move_member_voice').execute(
      { guild, actorMember: null },
      { member: target.id, channel: 'voice-2' },
    ),
    /did not confirm the voice move/,
  );
});

test('clear timeout does not report success if the timeout remains active', async () => {
  const guild = makeGuild({
    roles: [{ id: 'r1', name: 'Member', position: 1 }, { id: 'r2', name: 'Eternalz', position: 10 }],
    members: [{ ...target, roles: ['r1'] }, { id: 'bot-1', username: 'Eternalz', permissions: ['Administrator'], roles: ['r2'] }],
  });
  const member = guild.members.cache.get(target.id);
  member.communicationDisabledUntilTimestamp = Date.now() + 60000;
  member.timeout = async () => member; // Simulate Discord accepting but not applying the edit.
  await assert.rejects(
    () => getTool('clear_timeout').execute({ guild, actorMember: null }, { member: target.id }),
    /still active/,
  );
});
