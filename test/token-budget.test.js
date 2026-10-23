'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPlan } = require('../src/ai/planner');
const { buildGuildSnapshot } = require('../src/discord/snapshot');
const { makeGuild, makeOverwrite } = require('./helpers/mock-discord');

const CONFIG = {
  aiMaxPlanningRounds: 1,
  aiMaxActions: 25,
  aiMaxOutputTokens: 512,
  aiTemperature: 0.2,
};

function largeGuild() {
  const channels = Array.from({ length: 250 }, (_, index) => ({
    id: `channel-${index}`,
    name: `channel-${index}`,
    topic: 'A realistic channel topic with enough text to make an unbounded prompt expensive.',
    overwrites: [
      makeOverwrite({
        id: 'role-members',
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks'],
        deny: ['ManageMessages'],
      }),
    ],
  }));
  const roles = Array.from({ length: 100 }, (_, index) => ({
    id: `role-${index}`,
    name: `role-${index}`,
    permissions: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks'],
  }));
  return makeGuild({ channels, roles });
}

function providerThat(calls, firstResponse) {
  return {
    kind: 'openai-compatible',
    async chat(request) {
      // The planner mutates its conversation between calls. Capture the actual
      // footprint at the moment this request would be sent, not a later alias.
      calls.push(JSON.parse(JSON.stringify(request)));
      if (calls.length === 1) return firstResponse;
      return {
        text: null,
        toolCalls: [{ id: 'plan-1', name: 'create_category', arguments: { name: 'Support' } }],
      };
    },
  };
}

function estimatedTokens(call) {
  // Conservative ASCII/JSON estimate used only as a regression budget. The
  // provider remains the authority on exact tokenisation and current quotas.
  const chars = JSON.stringify(call.messages).length + JSON.stringify(call.tools).length;
  return Math.ceil(chars / 4) + call.maxTokens;
}

async function planLargeGuild(firstResponse) {
  const guild = largeGuild();
  const calls = [];
  const provider = providerThat(calls, firstResponse);
  await createPlan({
    provider,
    config: CONFIG,
    ctx: { guild, storage: {}, logger: null },
    prompt: 'make the server better',
    snapshot: buildGuildSnapshot(guild, guild.members.me),
  });
  return calls;
}

test('a large server stays within the free-tier request footprint', async () => {
  const calls = await planLargeGuild({ text: 'The overview is enough.', toolCalls: [] });
  assert.equal(calls.length, 2);

  for (const call of calls) {
    assert.ok(call.maxTokens > 0 && call.maxTokens <= 512);
    assert.ok(estimatedTokens(call) < 8000, `single request estimate was ${estimatedTokens(call)}`);
  }
  const combined = calls.reduce((sum, call) => sum + estimatedTokens(call), 0);
  assert.ok(combined < 8000, `inspection + planning estimate was ${combined}`);

  const writeTool = calls[1].tools.find((tool) => tool.function.name === 'create_channel');
  assert.equal(writeTool.function.parameters.properties.name.description, undefined);
  assert.deepEqual(writeTool.function.parameters.required, ['name']);
});

test('read-tool results cannot make the planning request grow without bound', async () => {
  const calls = await planLargeGuild({
    text: null,
    toolCalls: [{ id: 'read-1', name: 'list_channels', arguments: {} }],
  });
  assert.equal(calls.length, 2);

  const toolMessages = calls[1].messages.filter((message) => message.role === 'tool');
  assert.equal(toolMessages.length, 1);
  assert.ok(toolMessages[0].content.length <= 800);
  assert.match(toolMessages[0].content, /truncated/);

  const combined = calls.reduce((sum, call) => sum + estimatedTokens(call), 0);
  assert.ok(combined < 8000, `read + planning estimate was ${combined}`);
});
