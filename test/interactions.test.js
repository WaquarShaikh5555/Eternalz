'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractPrompt, handleAdminRequest } = require('../src/admin/service');
const {
  renderAdminResult,
  handleConversationButton,
  handleConversationModal,
  REFINE_BUTTON,
  REFINE_MODAL,
} = require('../src/admin/interactions');
const {
  createConversation,
  getConversation,
  clearConversations,
} = require('../src/admin/conversation');
const { JsonStore } = require('../src/storage/json-driver');
const { AuditLogger } = require('../src/audit/audit');
const { Cooldown, RateLimiter } = require('../src/core/rate-limiter');
const { makeGuild } = require('./helpers/mock-discord');

function fakeProvider(responses) {
  let index = 0;
  return {
    kind: 'openai-compatible',
    model: 'test-model',
    async chat() {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
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
    aiMaxPromptLength: 2000,
    aiTemperature: 0.2,
    aiRequestCooldownMs: 60_000,
    aiConfirmTimeoutMs: 300_000,
    aiAuditChannelId: '',
    ...overrides,
  };
}

async function makeEnvironment() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-interactions-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();
  const config = makeConfig();
  return {
    storage,
    config,
    audit: new AuditLogger({ storage, config }),
    limiter: new RateLimiter({ limit: 1, windowMs: 60_000 }),
    cooldown: new Cooldown(),
  };
}

function messageInteraction(guild, userId = 'owner-1') {
  const payloads = [];
  return {
    user: { id: userId },
    guild,
    deferred: false,
    replied: false,
    payloads,
    message: {},
    async deferReply() {
      this.deferred = true;
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.replied = true;
      payloads.push(payload);
    },
    async reply(payload) {
      this.replied = true;
      payloads.push(payload);
    },
  };
}

test.beforeEach(() => clearConversations());

test('extractPrompt uses the real Discord.js getString method', () => {
  const interaction = {
    options: {
      getString: (name) => (name === 'prompt' ? 'make the server look better' : null),
    },
  };
  assert.equal(extractPrompt(interaction), 'make the server look better');
});

test('a real slash-command prompt is not mistaken for an empty request', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    {
      text: 'I will use a clean layout.',
      toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Community' } }],
    },
  ]);

  const interaction = {
    user: { id: 'owner-1' },
    guild,
    options: {
      getString: (name) =>
        name === 'prompt'
          ? 'change the overall looks of the server and make it better change whatever you want'
          : null,
      getBoolean: () => false,
    },
  };

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

  assert.equal(result.kind, 'executed');
  assert.equal(result.report.succeeded.length, 1);
  assert.ok(guild.channels.cache.find((channel) => channel.name === 'Community'));
  await env.storage.close();
});

test('a no-action answer includes an Answer / refine popup button', async () => {
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });
  const interaction = messageInteraction(guild);

  await renderAdminResult(
    interaction,
    { kind: 'no_action', notes: 'Which style would you prefer?', rejected: [] },
    { prompt: 'improve the server' },
  );

  const payload = interaction.payloads.at(-1);
  assert.equal(payload.components.length, 1);
  const row = payload.components[0].toJSON();
  const refine = row.components.find((component) => component.custom_id.startsWith(`${REFINE_BUTTON}:`));
  assert.ok(refine, 'the refine button should be present');
  const sessionId = refine.custom_id.slice(`${REFINE_BUTTON}:`.length);
  assert.equal(getConversation(sessionId).prompt, 'improve the server');
});

test('only the original requester can open the follow-up popup', async () => {
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });
  const session = createConversation({
    guildId: 'guild-1',
    requesterId: 'owner-1',
    prompt: 'improve the server',
  });

  const other = messageInteraction(guild, 'someone-else');
  other.customId = `${REFINE_BUTTON}:${session.id}`;
  await handleConversationButton(other);
  assert.equal(other.payloads[0].ephemeral, true);
  assert.match(other.payloads[0].content, /Only the person/);

  const owner = messageInteraction(guild);
  owner.customId = `${REFINE_BUTTON}:${session.id}`;
  let shownModal = null;
  owner.showModal = async (modal) => {
    shownModal = modal;
  };
  const result = await handleConversationButton(owner);
  assert.equal(result.kind, 'modal');
  assert.ok(shownModal);
  assert.equal(shownModal.toJSON().custom_id, `${REFINE_MODAL}:${session.id}`);
});

test('an expired follow-up cannot be used', async () => {
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });
  const session = createConversation({
    guildId: 'guild-1',
    requesterId: 'owner-1',
    prompt: 'improve the server',
    ttlMs: -1,
  });
  const interaction = messageInteraction(guild);
  interaction.customId = `${REFINE_BUTTON}:${session.id}`;
  const result = await handleConversationButton(interaction);
  assert.equal(result.kind, 'expired');
  assert.match(interaction.payloads[0].content, /expired/);
});

test('a modal answer continues the request without another slash command', async () => {
  const env = await makeEnvironment();
  const guild = makeGuild({ id: 'guild-1', ownerId: 'owner-1' });
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    {
      text: 'Using a minimal style.',
      toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Lounge' } }],
    },
  ]);

  const session = createConversation({
    guildId: 'guild-1',
    requesterId: 'owner-1',
    prompt: 'improve the server',
  });

  // Even an active cooldown must not block answering the follow-up.
  env.cooldown.start('guild-1:owner-1', 60_000);

  const interaction = messageInteraction(guild);
  interaction.customId = `${REFINE_MODAL}:${session.id}`;
  interaction.fields = {
    getTextInputValue: (name) => (name === 'answer' ? 'make it clean and minimal' : ''),
  };

  const result = await handleConversationModal({
    interaction,
    guild,
    config: env.config,
    storage: env.storage,
    audit: env.audit,
    logger: null,
    limiter: env.limiter,
    cooldown: env.cooldown,
    provider,
    client: null,
  });

  assert.equal(result.kind, 'executed');
  assert.ok(guild.channels.cache.find((channel) => channel.name === 'Lounge'));
  assert.ok(interaction.deferred, 'the modal must be acknowledged promptly');
  assert.ok(interaction.payloads.at(-1).embeds.length > 0);
  await env.storage.close();
});
