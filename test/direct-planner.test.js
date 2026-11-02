'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPlan } = require('../src/ai/planner');
const { createDirectActions } = require('../src/ai/direct-planner');
const { makeGuild } = require('./helpers/mock-discord');

function snapshot() {
  return {
    guild: { id: '123456789012345678', name: 'Test' },
    categories: [{ id: '223456789012345678', name: 'Community', position: 0 }],
    channels: [{ id: '323456789012345678', name: 'general', type: 'text', parentId: '223456789012345678' }],
    roles: [],
    bot: { permissions: ['ManageChannels'] },
  };
}

function options(provider, prompt, recentContext = null) {
  return {
    provider,
    config: { aiMaxPlanningRounds: 1, aiMaxActions: 10, aiMaxOutputTokens: 512, aiTemperature: 0 },
    ctx: { guild: makeGuild(), signal: null },
    prompt,
    snapshot: snapshot(),
    recentContext,
    logger: null,
  };
}

const noProvider = {
  kind: 'test',
  chat: async () => { throw new Error('The direct path must not contact the provider'); },
};

test('direct create uses the exact existing category id and no provider', async () => {
  const plan = await createPlan(options(noProvider, 'Please create a text channel called Announcements under Community'));
  assert.equal(plan.source, 'direct');
  assert.deepEqual(plan.actions, [{
    tool: 'create_channel',
    args: { name: 'announcements', type: 'text', category: '223456789012345678' },
    description: 'Create a text channel "announcements" in "223456789012345678"',
  }]);
});

test('direct rename-it uses the confirmed entity id and no provider', async () => {
  const recentContext = { reference: { id: '323456789012345678', kind: 'channel', name: 'general' } };
  const plan = await createPlan(options(noProvider, 'rename it to Town Square', recentContext));
  assert.equal(plan.source, 'direct');
  assert.equal(plan.actions[0].tool, 'rename_channel');
  assert.deepEqual(plan.actions[0].args, { channel: '323456789012345678', name: 'town-square' });
});

test('direct moderation converts durations and supplies the safe default', async () => {
  const timed = await createPlan(options(noProvider, 'mute @spammer for 2 hours because repeated spam'));
  assert.deepEqual(timed.actions[0], {
    tool: 'timeout_member',
    args: { member: '@spammer', minutes: 120, reason: 'repeated spam' },
    description: 'TIME OUT @spammer for 120 minute(s)',
  });
  const short = await createPlan(options(noProvider, 'timeout <@123456789012345678>'));
  assert.equal(short.actions[0].args.minutes, 5);
  const cleared = await createPlan(options(noProvider, 'unmute @spammer'));
  assert.equal(cleared.actions[0].tool, 'clear_timeout');
});

test('ambiguous or compound requests remain model-planned', () => {
  const state = snapshot();
  assert.equal(createDirectActions({ prompt: 'create a channel and a role', snapshot: state }), null);
  assert.equal(createDirectActions({ prompt: 'create a channel and make a role', snapshot: state }), null);
  assert.equal(createDirectActions({ prompt: 'create channel foo\ndelete channel bar', snapshot: state }), null);
  assert.equal(createDirectActions({ prompt: 'create channel foo delete channel bar', snapshot: state }), null);
  assert.equal(createDirectActions({ prompt: 'delete 20 messages in missing-channel', snapshot: state }), null);
  assert.equal(createDirectActions({ prompt: 'mute @member for 999999 minutes', snapshot: state }), null);
  assert.equal(createDirectActions({ prompt: 'make the server better', snapshot: state }), null);
});

test('one corrective round receives exact schema errors and returns a valid plan', async () => {
  const requests = [];
  const provider = {
    kind: 'test',
    chat: async (request) => {
      requests.push(request);
      if (requests.length === 1) return { text: null, toolCalls: [] };
      if (requests.length === 2) {
        return { text: null, toolCalls: [{ id: 'bad', name: 'create_channel', arguments: { name: 42 } }] };
      }
      return { text: null, toolCalls: [{ id: 'good', name: 'create_channel', arguments: { name: 'valid-channel' } }] };
    },
  };
  const plan = await createPlan(options(provider, 'organise a new discussion space'));
  assert.equal(requests.length, 3);
  assert.match(requests[2].messages.at(-1).content, /deterministic validation/);
  assert.match(requests[2].messages.at(-1).content, /name/);
  assert.equal(plan.actions[0].args.name, 'valid-channel');
  assert.equal(plan.rejected.length, 0);
});

test('corrective planning is bounded to one retry', async () => {
  let calls = 0;
  const provider = {
    kind: 'test',
    chat: async () => {
      calls += 1;
      if (calls === 1) return { text: null, toolCalls: [] };
      return { text: null, toolCalls: [{ id: `bad-${calls}`, name: 'create_channel', arguments: { name: 42 } }] };
    },
  };
  const plan = await createPlan(options(provider, 'organise a new discussion space'));
  assert.equal(calls, 3);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.rejected.length, 1);
});
