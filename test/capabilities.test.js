'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getTool, toolNames } = require('../src/discord/tools');
const { makeGuild } = require('./helpers/mock-discord');
const {
  missingToolPermissions,
  permissionFixHint,
  TOOL_PERMISSIONS,
} = require('../src/discord/permissions');
const { planPermissionGaps, executePlan } = require('../src/admin/executor');
const { buildResultEmbed } = require('../src/admin/service');
const { assessAction, assessPlan, RISK } = require('../src/admin/risk');
const { createPendingPlan, buildPlanEmbed } = require('../src/admin/confirmation');
const { JsonStore } = require('../src/storage/json-driver');

function ctx(guild) {
  return {
    guild,
    client: null,
    storage: { getSetting: async () => null, setSetting: async () => {} },
    logger: null,
    actorMember: guild.members.cache.get('owner-1') || null,
    requesterId: 'owner-1',
  };
}

// ---------------------------------------------------------------------------
// Capability coverage
// ---------------------------------------------------------------------------

test('the moderation capability set includes timeout, unban and bulk delete', () => {
  const names = toolNames();
  for (const name of ['timeout_member', 'unban_member', 'delete_messages']) {
    assert.ok(names.includes(name), `${name} should be in the allowlist`);
  }
});

test('every tool that writes has a declared permission requirement', () => {
  for (const tool of require('../src/discord/tools').ALL_TOOLS) {
    if (tool.mutating) {
      assert.ok(
        Array.isArray(TOOL_PERMISSIONS[tool.name]),
        `${tool.name} needs a permission requirement`,
      );
      assert.ok(TOOL_PERMISSIONS[tool.name].length > 0, `${tool.name} needs at least one permission`);
    }
  }
});

test('the permission table only names real Discord permissions', () => {
  const { PermissionFlagsBits } = require('discord.js');
  for (const [tool, required] of Object.entries(TOOL_PERMISSIONS)) {
    for (const name of required) {
      assert.ok(PermissionFlagsBits[name] !== undefined, `${tool} references unknown permission ${name}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Timeout / unban / bulk delete
// ---------------------------------------------------------------------------

test('a timeout is applied and reported with its duration', async () => {
  const guild = makeGuild({ members: [{ id: 'u1', username: 'spammer' }] });
  const result = await getTool('timeout_member').execute(ctx(guild), {
    member: 'spammer',
    minutes: 15,
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /15 minute/);
  const member = guild.members.cache.get('u1');
  assert.ok(member.communicationDisabledUntilTimestamp > Date.now());
});

test('a timeout requires the ModerateMembers permission', async () => {
  const guild = makeGuild({ botPermissions: ['SendMessages'], members: [{ id: 'u1', username: 'x' }] });
  await assert.rejects(
    () => getTool('timeout_member').execute(ctx(guild), { member: 'x', minutes: 5 }),
    /ModerateMembers/,
  );
});

test('a timeout of more than 28 days is rejected by the schema', () => {
  const { validateToolCall } = require('../src/discord/tools');
  const result = validateToolCall('timeout_member', { member: 'x', minutes: 999999 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /40320/);
});

test('a mute without a duration receives a validated five-minute default', () => {
  const { validateToolCall, toGeminiDeclarations, getTool: tool } = require('../src/discord/tools');
  const result = validateToolCall('timeout_member', { member: 'x' });
  assert.equal(result.ok, true);
  assert.equal(result.args.minutes, 5);

  const declaration = toGeminiDeclarations([tool('timeout_member')])[0];
  assert.equal(declaration.parameters.properties.minutes.default, undefined);
  assert.equal(declaration.parameters.required.includes('minutes'), false);
});

test('a timeout is not reported as successful when Discord shows no timeout', async () => {
  const guild = makeGuild({ members: [{ id: 'u1', username: 'spammer' }] });
  const member = guild.members.cache.get('u1');
  member.fetch = async () => ({ ...member, communicationDisabledUntilTimestamp: null });
  await assert.rejects(
    () => getTool('timeout_member').execute(ctx(guild), { member: 'spammer', minutes: 5 }),
    /did not take effect/,
  );
});

test('a timeout needs confirmation', () => {
  const result = assessAction({ tool: 'timeout_member', args: { member: 'x', minutes: 5 }, toolDef: getTool('timeout_member') });
  assert.equal(result.level, RISK.CONFIRM);
});

test('an unban by user id works', async () => {
  const guild = makeGuild({ members: [{ id: 'u1', username: 'spammer' }] });
  await getTool('ban_member').execute(ctx(guild), { member: 'spammer' });
  const result = await getTool('unban_member').execute(ctx(guild), { member: 'u1' });
  assert.equal(result.ok, true);
  assert.equal(guild.__unbanned.includes('u1'), true);
});

test('an unban by username resolves through the ban list', async () => {
  const guild = makeGuild({ members: [{ id: 'u1', username: 'spammer' }] });
  await getTool('ban_member').execute(ctx(guild), { member: 'spammer' });
  const result = await getTool('unban_member').execute(ctx(guild), { member: 'spammer' });
  assert.equal(result.ok, true);
  assert.equal(guild.__unbanned.includes('u1'), true);
});

test('an unban of a user who is not banned fails clearly', async () => {
  const guild = makeGuild();
  await assert.rejects(
    () => getTool('unban_member').execute(ctx(guild), { member: 'nobody' }),
    /No banned user named/i,
  );
});

test('bulk delete removes the requested number of messages', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'spam' }] });
  const result = await getTool('delete_messages').execute(ctx(guild), {
    channel: 'spam',
    count: 40,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.deleted, 40);
  assert.equal(result.reversal, null, 'deleted messages must not promise a rollback');
});

test('bulk delete is limited to 100 messages by the schema', () => {
  const { validateToolCall } = require('../src/discord/tools');
  assert.equal(validateToolCall('delete_messages', { channel: 'x', count: 500 }).ok, false);
  assert.equal(validateToolCall('delete_messages', { channel: 'x', count: 100 }).ok, true);
});

test('bulk delete needs confirmation', () => {
  const result = assessAction({ tool: 'delete_messages', args: { channel: 'x', count: 10 }, toolDef: getTool('delete_messages') });
  assert.equal(result.level, RISK.CONFIRM);
});

// ---------------------------------------------------------------------------
// Permission pre-flight
// ---------------------------------------------------------------------------

test('missingToolPermissions reports exactly the missing permissions', () => {
  const guild = makeGuild({ botPermissions: ['SendMessages'] });
  assert.deepEqual(missingToolPermissions(guild, 'create_channel'), ['ManageChannels']);
  assert.deepEqual(missingToolPermissions(guild, 'create_role'), ['ManageRoles']);
  assert.deepEqual(missingToolPermissions(guild, 'timeout_member'), ['ModerateMembers']);
});

test('nothing is missing when the bot has the permission', () => {
  const guild = makeGuild();
  assert.deepEqual(missingToolPermissions(guild, 'create_channel'), []);
  assert.deepEqual(missingToolPermissions(guild, 'timeout_member'), []);
});

test('planPermissionGaps deduplicates across a plan', () => {
  const guild = makeGuild({ botPermissions: ['SendMessages'] });
  const gaps = planPermissionGaps(guild, [
    { tool: 'create_channel' },
    { tool: 'delete_channel' },
    { tool: 'create_role' },
  ]);
  assert.deepEqual(gaps.missing, ['ManageChannels', 'ManageRoles']);
  assert.match(gaps.hint, /Server Settings -> Roles/);
});

test('a failing permission is reported with a fix hint instead of a raw 403', async () => {
  const guild = makeGuild({ botPermissions: ['SendMessages'] });
  const result = await executePlan({
    actions: [{ tool: 'create_channel', args: { name: 'x' }, description: 'Create a channel' }],
    ctx: ctx(guild),
    config: { aiWriteEnabled: true, aiMaxActions: 25 },
    delayMs: 0,
  });
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /ManageChannels/);
  assert.match(result.failed[0].error, /Server Settings -> Roles/);
});

test('the report embed shows the missing permissions and how to fix them', () => {
  const result = {
    succeeded: [],
    failed: [{ tool: 'create_channel', description: 'Create a channel', error: 'x' }],
    skipped: [],
    summary: '0 changes applied, 1 failed',
  };
  const gaps = {
    missing: ['ManageChannels'],
    hint: 'Grant "Manage Channels" to Eternalz in Server Settings -> Roles -> Eternalz.',
  };
  const json = buildResultEmbed(result, null, gaps).toJSON();
  const field = json.fields.find((f) => /Missing Discord permissions/.test(f.name));
  assert.ok(field, 'the embed should contain the permission section');
  assert.match(field.value, /ManageChannels/);
  assert.match(field.value, /Server Settings -> Roles/);
});

test('the confirmation screen warns about missing permissions before execution', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-gaps-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();

  const plan = await createPendingPlan({
    storage,
    config: { aiConfirmTimeoutMs: 300000 },
    guildId: 'guild-1',
    requesterId: 'owner-1',
    prompt: 'create a channel',
    actions: [{ tool: 'create_channel', args: { name: 'x' }, description: 'Create a channel' }],
    risk: 'confirm',
    reasons: [],
    permissionGaps: { missing: ['ManageChannels'], hint: 'Grant it in Server Settings.' },
  });

  const embed = buildPlanEmbed(plan).toJSON();
  const field = embed.fields.find((f) => /Missing Discord permissions/.test(f.name));
  assert.ok(field);
  assert.match(field.value, /ManageChannels/);

  const loaded = await storage.getPlan(plan.id);
  assert.deepEqual(loaded.permissionGaps.missing, ['ManageChannels']);
  await storage.close();
});

test('the gaps are preserved in the SQLite store', async (t) => {
  const { SqliteStore } = require('../src/storage/sqlite-driver');
  if (!SqliteStore.isAvailable()) {
    t.skip('node:sqlite is not available');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-sqlite-gaps-'));
  const storage = new SqliteStore({ file: path.join(dir, 's.db') });
  await storage.init();

  const plan = await createPendingPlan({
    storage,
    config: { aiConfirmTimeoutMs: 300000 },
    guildId: 'guild-1',
    requesterId: 'owner-1',
    prompt: 'x',
    actions: [],
    risk: 'safe',
    reasons: [],
    permissionGaps: { missing: ['ManageRoles'], hint: 'grant it' },
  });

  const loaded = await storage.getPlan(plan.id);
  assert.deepEqual(loaded.permissionGaps.missing, ['ManageRoles']);
  await storage.close();
});

test('the plan risk is unchanged by the new permission checks', () => {
  const plan = assessPlan([
    { tool: 'create_channel', args: { name: 'a' } },
    { tool: 'create_channel', args: { name: 'b' } },
  ]);
  assert.equal(plan.level, RISK.SAFE);
});
