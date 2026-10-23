'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPlan } = require('../src/ai/planner');
const { makeGuild } = require('./helpers/mock-discord');
const { buildGuildSnapshot } = require('../src/discord/snapshot');

/** A provider stub that replays a fixed list of responses. */
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

const baseConfig = {
  aiMaxPlanningRounds: 3,
  aiMaxActions: 25,
  aiTemperature: 0.2,
};

function planCtx(guild) {
  return {
    guild,
    client: null,
    storage: { getSetting: async () => null, setSetting: async () => {} },
    logger: null,
    actorMember: null,
    requesterId: 'owner-1',
  };
}

test('a plan made only of write tool calls becomes a list of actions', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    {
      text: null,
      toolCalls: [
        { id: '1', name: 'create_category', arguments: { name: 'Support' } },
        { id: '2', name: 'create_channel', arguments: { name: 'tickets', category: 'Support' } },
      ],
    },
  ]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'Create a Support category with a tickets channel',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].tool, 'create_category');
  assert.equal(plan.actions[1].args.category, 'Support');
  assert.ok(plan.actions[0].description.includes('Support'));
});

test('read tools are executed during inspection and their results reach the model', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'general' }] });
  const provider = fakeProvider([
    { text: null, toolCalls: [{ id: '1', name: 'list_channels', arguments: {} }] },
    { text: 'I know everything I need.', toolCalls: [] },
    {
      text: null,
      toolCalls: [{ id: '2', name: 'create_category', arguments: { name: 'Support' } }],
    },
  ]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'Make a Support category',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.readResults.length, 1);
  assert.equal(plan.readResults[0].ok, true);
  assert.equal(plan.actions.length, 1);

  // The tool result must be present in the conversation that produces the plan.
  const planCall = provider.calls[provider.calls.length - 1];
  const toolMessage = planCall.messages.find((m) => m.role === 'tool');
  assert.ok(toolMessage, 'the read result should be part of the conversation');
  assert.match(toolMessage.content, /general/);
});

test('an unknown tool proposed by the model is rejected and never planned', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    {
      text: null,
      toolCalls: [{ id: '1', name: 'execute_shell', arguments: { cmd: 'rm -rf /' } }],
    },
  ]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'do something bad',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 0);
  assert.ok(plan.rejected.length >= 1);
  assert.ok(plan.rejected.some((r) => /allowlist/i.test(r.reason)));
});

test('a tool call with invalid arguments is rejected', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    {
      text: null,
      toolCalls: [{ id: '1', name: 'set_channel_slowmode', arguments: { channel: 'general', seconds: 'fast' } }],
    },
  ]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'set slowmode',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 0);
  assert.ok(plan.rejected.length >= 1);
  assert.ok(plan.rejected.some((r) => /integer/.test(r.reason)));
});

test('duplicate actions are collapsed', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    {
      text: null,
      toolCalls: [
        { id: '1', name: 'create_category', arguments: { name: 'Support' } },
        { id: '2', name: 'create_category', arguments: { name: 'Support' } },
      ],
    },
  ]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'create support twice',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 1);
  assert.ok(plan.rejected.some((r) => /duplicate/.test(r.reason)));
});

test('an oversized plan is truncated to the configured maximum', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    {
      text: null,
      toolCalls: Array.from({ length: 12 }, (_, index) => ({
        id: String(index),
        name: 'create_channel',
        arguments: { name: `channel-${index}` },
      })),
    },
  ]);

  const plan = await createPlan({
    provider,
    config: { ...baseConfig, aiMaxActions: 5 },
    ctx: planCtx(guild),
    prompt: 'create lots of channels',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 5);
  assert.ok(plan.rejected.some((r) => /truncated/.test(r.reason)));
});

test('a model that only answers in prose produces no actions', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([{ text: 'Everything already looks fine.', toolCalls: [] }]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'check the server',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.actions.length, 0);
  assert.match(plan.notes, /already looks fine/);
});

test('the model is asked to inspect before it plans', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }] },
  ]);

  await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'Make a Support category',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  const firstCall = provider.calls[0];
  const toolNames = firstCall.tools.map((t) => t.function.name);
  assert.ok(toolNames.includes('list_channels'), 'read tools must be available first');
  assert.ok(!toolNames.includes('create_category'), 'write tools must not be available first');

  const secondCall = provider.calls[1];
  const planToolNames = secondCall.tools.map((t) => t.function.name);
  assert.ok(planToolNames.includes('create_category'));
  assert.ok(!planToolNames.includes('list_channels'));
});

test('a mutating tool requested during the inspection phase is refused', async () => {
  const guild = makeGuild();
  const provider = fakeProvider([
    { text: null, toolCalls: [{ id: '1', name: 'create_category', arguments: { name: 'Support' } }] },
    { text: null, toolCalls: [] },
    { text: null, toolCalls: [] },
  ]);

  const plan = await createPlan({
    provider,
    config: baseConfig,
    ctx: planCtx(guild),
    prompt: 'Make a Support category',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });

  assert.equal(plan.readResults[0].ok, false);
  assert.match(plan.readResults[0].error, /not available during the inspection phase/);
  assert.equal(plan.actions.length, 0, 'the refused call must not become an action');
});
