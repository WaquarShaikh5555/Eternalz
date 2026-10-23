'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { executePlan } = require('../src/admin/executor');
const { makeGuild } = require('./helpers/mock-discord');

function ctx(guild) {
  return {
    guild,
    client: null,
    storage: {
      getSetting: async () => null,
      setSetting: async () => {},
    },
    logger: null,
    actorMember: guild.members.cache.get('owner-1') || null,
    requesterId: 'owner-1',
  };
}

const baseConfig = { aiWriteEnabled: true, aiMaxActions: 25 };

test('a safe action is applied and reported as a success', async () => {
  const guild = makeGuild();
  const result = await executePlan({
    actions: [{ tool: 'create_category', args: { name: 'Support' }, description: 'Create the category "Support"' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.succeeded.length, 1);
  assert.equal(result.failed.length, 0);
  assert.ok(guild.channels.cache.size >= 1, 'the category should exist in the mock guild');
  assert.match(result.summary, /1 change applied/);
});

test('a failing action does not stop the remaining actions and is reported precisely', async () => {
  const guild = makeGuild();
  const result = await executePlan({
    actions: [
      { tool: 'create_channel', args: { name: 'tickets', category: 'does-not-exist' }, description: 'create in a missing category' },
      { tool: 'create_category', args: { name: 'Support' }, description: 'create the Support category' },
    ],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.succeeded.length, 1, 'the independent action should still run');
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /no categories|No category named/i);
  assert.match(result.summary, /1 change applied, 1 failed/);
});

test('a duplicate channel is skipped instead of failing', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'general' }] });
  const result = await executePlan({
    actions: [{ tool: 'create_channel', args: { name: 'general' }, description: 'create general' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /already exists/i);
});

test('a duplicate role is skipped instead of failing', async () => {
  const guild = makeGuild({ roles: [{ id: 'r1', name: 'VIP' }] });
  const result = await executePlan({
    actions: [{ tool: 'create_role', args: { name: 'VIP' }, description: 'create VIP' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 0);
});

test('a missing Discord permission fails the action without crashing the run', async () => {
  const guild = makeGuild({ botPermissions: ['SendMessages'] });
  const result = await executePlan({
    actions: [{ tool: 'create_category', args: { name: 'Support' }, description: 'create a category' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /ManageChannels/);
});

test('nothing is written when AI write operations are disabled', async () => {
  const guild = makeGuild();
  const result = await executePlan({
    actions: [{ tool: 'create_category', args: { name: 'Support' }, description: 'create a category' }],
    ctx: ctx(guild),
    config: { ...baseConfig, aiWriteEnabled: false },
    delayMs: 0,
  });

  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /disabled/i);
  assert.equal(guild.channels.cache.size, 0, 'no channel should have been created');
});

test('the authorisation hook is called before every action', async () => {
  const guild = makeGuild();
  let calls = 0;
  await executePlan({
    actions: [
      { tool: 'create_category', args: { name: 'A' }, description: 'a' },
      { tool: 'create_category', args: { name: 'B' }, description: 'b' },
    ],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
    authorize: async () => {
      calls += 1;
    },
  });
  assert.equal(calls, 2);
});

test('a failing authorisation hook stops the action', async () => {
  const guild = makeGuild();
  const result = await executePlan({
    actions: [{ tool: 'create_category', args: { name: 'A' }, description: 'a' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
    authorize: async () => {
      throw new Error('not authorised any more');
    },
  });

  assert.equal(result.succeeded.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /not authorised/);
});

test('renaming a channel records the previous name so it can be reversed', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'general' }] });
  const result = await executePlan({
    actions: [{ tool: 'rename_channel', args: { channel: 'general', name: 'talk' }, description: 'rename' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.succeeded.length, 1);
  assert.equal(result.succeeded[0].reversal.kind, 'rename_channel');
  assert.equal(result.succeeded[0].reversal.name, 'general');
});

test('deleting a channel removes it from the server', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'spam' }] });
  const result = await executePlan({
    actions: [{ tool: 'delete_channel', args: { channel: 'spam' }, description: 'delete spam' }],
    ctx: ctx(guild),
    config: baseConfig,
    delayMs: 0,
  });

  assert.equal(result.succeeded.length, 1);
  assert.equal(guild.channels.cache.has('c1'), false);
  assert.equal(result.succeeded[0].reversal, null, 'a deletion must not promise a rollback');
});
