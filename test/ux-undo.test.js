'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  handleAdminRequest,
  handlePlanButton,
} = require('../src/admin/service');
const {
  renderAdminResult,
  handleConversationButton,
  DISMISS_BUTTON,
  DESIGN_BUTTON,
} = require('../src/admin/interactions');
const { clearConversations } = require('../src/admin/conversation');
const { createUndoState, publicUndoState, assertUndoPreconditions } = require('../src/admin/undo');
const { executePlan } = require('../src/admin/executor');
const { STATUS } = require('../src/admin/confirmation');
const { JsonStore } = require('../src/storage/json-driver');
const { AuditLogger } = require('../src/audit/audit');
const { Cooldown, RateLimiter } = require('../src/core/rate-limiter');
const { makeGuild } = require('./helpers/mock-discord');

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
    aiMaxPromptLength: 4000,
    aiTemperature: 0.2,
    aiRequestCooldownMs: 0,
    aiConfirmTimeoutMs: 300000,
    aiAuditChannelId: '',
    ...overrides,
  };
}

async function environment(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-ux-'));
  const storage = new JsonStore({ file: path.join(directory, 'store.json') });
  await storage.init();
  const config = makeConfig(overrides);
  return {
    storage,
    config,
    audit: new AuditLogger({ storage, config }),
    limiter: new RateLimiter({ limit: 50, windowMs: 60000 }),
    cooldown: new Cooldown(),
  };
}

function provider(responses = []) {
  const calls = [];
  let index = 0;
  return {
    kind: 'openai-compatible',
    calls,
    async chat(request) {
      calls.push(request);
      if (!responses.length) throw new Error('The direct planner should not call the provider.');
      return responses[Math.min(index++, responses.length - 1)];
    },
  };
}

function slash(guild, prompt, userId = 'owner-1') {
  return {
    user: { id: userId },
    guild,
    options: {
      getString: (name) => (name === 'prompt' ? prompt : null),
      getBoolean: () => false,
    },
    deferred: false,
    replied: false,
    payloads: [],
    async reply(payload) { this.replied = true; this.payloads.push(payload); },
    async editReply(payload) { this.replied = true; this.payloads.push(payload); },
    async deferReply() { this.deferred = true; },
  };
}

function button(guild, customId, userId = 'owner-1') {
  return {
    user: { id: userId },
    guild,
    customId,
    message: {},
    deferred: false,
    replied: false,
    payloads: [],
    async deferUpdate() { this.deferred = true; },
    async reply(payload) { this.replied = true; this.payloads.push(payload); },
    async editReply(payload) { this.replied = true; this.payloads.push(payload); },
  };
}

function runtime(env, guild, aiProvider) {
  return {
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider: aiProvider,
    client: null,
  };
}

test.beforeEach(() => clearConversations());

test('design choices lead to an exact confirmation plan, not an immediate arbitrary change', async () => {
  const env = await environment();
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });
  const aiProvider = provider([
    { text: 'I have enough information.', toolCalls: [] },
    {
      text: 'A small community layout.',
      toolCalls: [{ id: 'design-1', name: 'create_category', arguments: { name: 'Community' } }],
    },
  ]);
  const initial = slash(guild, 'improve overall looks of the server');
  const options = await handleAdminRequest({
    ...runtime(env, guild, aiProvider),
    interaction: initial,
  });
  assert.equal(options.kind, 'design_options');
  assert.equal(aiProvider.calls.length, 0);

  await renderAdminResult(initial, options, { prompt: 'improve overall looks of the server' });
  const components = initial.payloads.at(-1).components[0].toJSON().components;
  const choice = components.find((component) => component.custom_id.startsWith(`${DESIGN_BUTTON}:`));
  assert.ok(choice);
  assert.equal(components.find((component) => component.custom_id.startsWith(`${DISMISS_BUTTON}:`)).label, 'Close');

  const selected = button(guild, choice.custom_id);
  const planned = await handleConversationButton(selected, runtime(env, guild, aiProvider));
  assert.equal(planned.kind, 'awaiting_confirmation');
  assert.equal(guild.channels.cache.some((channel) => channel.name === 'Community'), false);

  const confirmed = button(guild, `ai_admin:confirm:${planned.plan.id}`);
  const executed = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: confirmed,
  });
  assert.equal(executed.kind, 'executed');
  assert.ok(guild.channels.cache.some((channel) => channel.name === 'Community'));
  await env.storage.close();
});

test('instruction wording cannot become an arbitrary redesign resource name', async () => {
  const env = await environment();
  const guild = makeGuild({
    id: 'guild-1',
    ownerId: 'owner-1',
    channels: [{ id: 'channel-1', name: 'general' }],
  });
  const aiProvider = provider([
    { text: null, toolCalls: [] },
    {
      text: null,
      toolCalls: [{ id: 'bad-design', name: 'rename_channel', arguments: { channel: 'general', name: 'look improving' } }],
    },
  ]);
  const result = await handleAdminRequest({
    ...runtime(env, guild, aiProvider),
    interaction: slash(guild, 'improve overall looks of the server\n\nDesign direction selected by the administrator: Clean & minimal.'),
  });
  assert.equal(result.kind, 'no_action');
  assert.match(result.rejected.at(-1).reason, /repeats the instruction/);
  assert.equal(guild.channels.cache.get('channel-1').name, 'general');
  await env.storage.close();
});

test('Close only closes an executed result; Undo then restores the captured channel name', async () => {
  const env = await environment();
  const guild = makeGuild({
    id: 'guild-1',
    ownerId: 'owner-1',
    channels: [{ id: 'channel-1', name: 'general' }],
  });
  const aiProvider = provider();
  const initial = slash(guild, 'rename #general to lobby');
  const result = await handleAdminRequest({
    ...runtime(env, guild, aiProvider),
    interaction: initial,
  });
  assert.equal(result.kind, 'executed');
  assert.equal(result.undo.available, true);
  assert.equal(guild.channels.cache.get('channel-1').name, 'lobby');
  assert.equal(aiProvider.calls.length, 0);

  await renderAdminResult(initial, result, { prompt: 'rename #general to lobby' });
  const row = initial.payloads.at(-1).components[0].toJSON();
  const close = row.components.find((component) => component.custom_id.startsWith(`${DISMISS_BUTTON}:`));
  const closed = await handleConversationButton(button(guild, close.custom_id));
  assert.equal(closed.kind, 'closed');
  assert.equal(guild.channels.cache.get('channel-1').name, 'lobby', 'Close must not roll back or cancel execution');

  const undoInteraction = button(guild, `ai_admin:undo:${result.undo.planId}`);
  const undone = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: undoInteraction,
  });
  assert.equal(undone.kind, 'undone');
  assert.equal(guild.channels.cache.get('channel-1').name, 'general');
  const stored = await env.storage.getPlan(result.undo.planId);
  assert.equal(stored.status, STATUS.UNDONE);

  const repeated = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: button(guild, `ai_admin:undo:${result.undo.planId}`),
  });
  assert.equal(repeated.kind, 'undo_unavailable');
  assert.equal(guild.channels.cache.get('channel-1').name, 'general');
  await env.storage.close();
});

test('Undo refuses to overwrite a newer manual edit', async () => {
  const env = await environment();
  const guild = makeGuild({
    id: 'guild-1',
    ownerId: 'owner-1',
    channels: [{ id: 'channel-1', name: 'general' }],
  });
  const aiProvider = provider();
  const result = await handleAdminRequest({
    ...runtime(env, guild, aiProvider),
    interaction: slash(guild, 'rename #general to lobby'),
  });
  await guild.channels.cache.get('channel-1').setName('newer-name');
  const stale = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: button(guild, `ai_admin:undo:${result.undo.planId}`),
  });
  assert.equal(stale.kind, 'undo_stale');
  assert.equal(guild.channels.cache.get('channel-1').name, 'newer-name');
  await env.storage.close();
});

test('the bot can rename itself with ChangeNickname and undo the nickname', async () => {
  const env = await environment();
  const guild = makeGuild({
    id: 'guild-1',
    ownerId: 'owner-1',
    botPermissions: ['ChangeNickname'],
  });
  const aiProvider = provider();
  const result = await handleAdminRequest({
    ...runtime(env, guild, aiProvider),
    interaction: slash(guild, 'rename yourself to Helper'),
  });
  assert.equal(result.kind, 'executed');
  assert.equal(guild.members.me.nickname, 'Helper');
  assert.equal(result.undo.available, true);

  const undone = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: button(guild, `ai_admin:undo:${result.undo.planId}`),
  });
  assert.equal(undone.kind, 'undone');
  assert.equal(guild.members.me.nickname || '', '');
  await env.storage.close();
});

test('a confirmed reversible server rename also supports verified Undo', async () => {
  const env = await environment();
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1', name: 'Before' });
  const aiProvider = provider();
  const pending = await handleAdminRequest({
    ...runtime(env, guild, aiProvider),
    interaction: slash(guild, 'rename server to After'),
  });
  assert.equal(pending.kind, 'awaiting_confirmation');
  assert.equal(guild.name, 'Before');

  const executed = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: button(guild, `ai_admin:confirm:${pending.plan.id}`),
  });
  assert.equal(executed.kind, 'executed');
  assert.equal(guild.name, 'After');
  assert.equal(executed.undo.available, true);

  const undone = await handlePlanButton({
    ...runtime(env, guild, aiProvider),
    interaction: button(guild, `ai_admin:undo:${pending.plan.id}`),
  });
  assert.equal(undone.kind, 'undone');
  assert.equal(guild.name, 'Before');
  await env.storage.close();
});

test('role, channel-move and overwrite reversals are validated and executable', async () => {
  const guild = makeGuild({
    channels: [
      { id: 'category-1', name: 'Community', type: 4 },
      { id: 'channel-1', name: 'general', parentId: 'category-1' },
    ],
    roles: [{ id: 'role-1', name: 'Members', position: 1 }],
  });
  const ctx = { guild, storage: {}, actorMember: null };
  const config = { aiWriteEnabled: true };
  const original = await executePlan({
    actions: [
      { tool: 'edit_role', args: { role: 'role-1', color: '#112233' } },
      { tool: 'move_channel', args: { channel: 'channel-1', category: '' } },
      { tool: 'set_permission_overwrite', args: { channel: 'channel-1', target: 'role-1', allow: ['ViewChannel'], deny: [] } },
    ],
    ctx,
    config,
    delayMs: 0,
  });
  assert.deepEqual(original.failed, []);
  const undo = createUndoState(original);
  assert.deepEqual(undo.actions.map((action) => action.tool), [
    'delete_permission_overwrite',
    'move_channel',
    'edit_role',
  ]);
  await assertUndoPreconditions(guild, undo.actions);
  const reversed = await executePlan({ actions: undo.actions, ctx, config, delayMs: 0 });
  assert.deepEqual(reversed.failed, []);
  assert.deepEqual(reversed.skipped, []);
  assert.equal(guild.roles.cache.get('role-1').hexColor, '#000000');
  assert.equal(guild.channels.cache.get('channel-1').parentId, 'category-1');
  assert.equal(guild.channels.cache.get('channel-1').permissionOverwrites.cache.size, 0);
});

test('high-risk permission restoration is not a one-click Undo', () => {
  const state = createUndoState({
    succeeded: [{
      tool: 'edit_role',
      description: 'Edit a role',
      data: { id: 'role-1', name: 'Members', permissions: [] },
      reversal: {
        kind: 'edit_role',
        role: 'role-1',
        previous: { name: 'Members', permissions: ['Administrator'] },
      },
    }],
  });
  assert.equal(state.actions.length, 0);
  assert.match(state.unavailable[0].reason, /high-risk/);
});

test('irreversible results do not receive a fake Undo promise', () => {
  const state = createUndoState({
    succeeded: [{
      tool: 'delete_channel',
      description: 'Delete a channel',
      reversal: null,
      note: 'Deletion is not reversible by the bot.',
    }],
  });
  const view = publicUndoState({ id: 'plan-1', undo: state });
  assert.equal(state.actions.length, 0);
  assert.equal(view.available, false);
  assert.match(view.unavailable[0].reason, /not reversible/);
});
