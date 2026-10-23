'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getTool } = require('../src/discord/tools');
const { makeGuild } = require('./helpers/mock-discord');

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

test('creating a channel reports the new channel id', async () => {
  const guild = makeGuild();
  const result = await getTool('create_channel').execute(ctx(guild), { name: 'tickets' });
  assert.equal(result.ok, true);
  assert.ok(result.data.id);
  assert.equal(result.reversal.kind, 'delete_channel');
});

test('creating a channel in a category links it to the category', async () => {
  const guild = makeGuild({ channels: [{ id: 'cat1', name: 'Support', type: 4 }] });
  const result = await getTool('create_channel').execute(ctx(guild), {
    name: 'tickets',
    category: 'Support',
  });
  assert.equal(result.data.parentId, 'cat1');
});

test('creating a duplicate channel is reported as skipped', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'general' }] });
  const result = await getTool('create_channel').execute(ctx(guild), { name: 'general' });
  assert.equal(result.skipped, true);
  assert.match(result.message, /already exists/i);
});

test('creating a channel without ManageChannels fails with a clear error', async () => {
  const guild = makeGuild({ botPermissions: ['SendMessages'] });
  await assert.rejects(
    () => getTool('create_channel').execute(ctx(guild), { name: 'tickets' }),
    /ManageChannels/,
  );
});

test('a role below the bot role can be managed', async () => {
  const guild = makeGuild({ roles: [{ id: 'r1', name: 'VIP', position: 5 }] });
  const result = await getTool('delete_role').execute(ctx(guild), { role: 'VIP' });
  assert.equal(result.ok, true);
  assert.equal(guild.roles.cache.has('r1'), false);
});

test('a role above the bot role cannot be managed', async () => {
  const guild = makeGuild({
    roles: [{ id: 'r-high', name: 'Owner', position: 500 }],
    botRoleIds: [],
  });
  await assert.rejects(() => getTool('delete_role').execute(ctx(guild), { role: 'Owner' }), /highest role/i);
});

test('a managed role cannot be deleted', async () => {
  const guild = makeGuild({ roles: [{ id: 'r1', name: 'Bot Role', position: 5, managed: true }] });
  await assert.rejects(() => getTool('delete_role').execute(ctx(guild), { role: 'Bot Role' }), /Managed roles/);
});

test('a privileged role cannot be assigned by the AI administrator', async () => {
  const guild = makeGuild({
    roles: [{ id: 'r1', name: 'Admins', position: 5, permissions: ['Administrator'] }],
    members: [{ id: 'u1', username: 'alice' }],
  });
  await assert.rejects(
    () => getTool('assign_role').execute(ctx(guild), { member: 'u1', role: 'Admins' }),
    /privileged permissions/i,
  );
});

test('assigning an ordinary role works and can be reversed', async () => {
  const guild = makeGuild({
    roles: [{ id: 'r1', name: 'VIP', position: 5, permissions: ['ViewChannel'] }],
    members: [{ id: 'u1', username: 'alice' }],
  });
  const result = await getTool('assign_role').execute(ctx(guild), { member: 'u1', role: 'VIP' });
  assert.equal(result.ok, true);
  assert.equal(result.reversal.kind, 'remove_role');
  assert.ok(guild.members.cache.get('u1').roles.cache.has('r1'));
});

test('assigning a role the member already has is skipped', async () => {
  const guild = makeGuild({
    roles: [{ id: 'r1', name: 'VIP', position: 5, permissions: ['ViewChannel'] }],
    members: [{ id: 'u1', username: 'alice', roleIds: ['r1'] }],
  });
  const result = await getTool('assign_role').execute(ctx(guild), { member: 'u1', role: 'VIP' });
  assert.equal(result.skipped, true);
});

test('renaming a channel stores the previous name for a manual rollback', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'general' }] });
  const result = await getTool('rename_channel').execute(ctx(guild), {
    channel: 'general',
    name: 'talk',
  });
  assert.equal(result.data.previousName, 'general');
  assert.equal(result.reversal.name, 'general');
  assert.equal(guild.channels.cache.get('c1').name, 'talk');
});

test('a permission overwrite is applied and the previous state is recorded', async () => {
  const guild = makeGuild({
    channels: [{ id: 'c1', name: 'staff' }],
    roles: [{ id: 'r1', name: 'Mods', position: 5 }],
  });
  const result = await getTool('set_permission_overwrite').execute(ctx(guild), {
    channel: 'staff',
    target: 'Mods',
    allow: ['ViewChannel', 'SendMessages'],
    deny: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.reversal.kind, 'set_permission_overwrite');
  const overwrite = guild.channels.cache.get('c1').permissionOverwrites.cache.get('r1');
  assert.ok(overwrite.allow.has('ViewChannel'));
});

test('an unknown permission name is rejected', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'staff' }], roles: [{ id: 'r1', name: 'Mods' }] });
  await assert.rejects(
    () =>
      getTool('set_permission_overwrite').execute(ctx(guild), {
        channel: 'staff',
        target: 'Mods',
        allow: ['DoEverything'],
        deny: [],
      }),
    /Unknown permission name/,
  );
});

test('an announcement is posted to the requested channel', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'announcements' }] });
  const result = await getTool('send_announcement').execute(ctx(guild), {
    channel: 'announcements',
    content: 'Server maintenance at 22:00 UTC.',
    title: 'Maintenance',
  });
  assert.equal(result.ok, true);
  assert.ok(result.data.messageId);
});

test('a ticket channel is created private with staff access', async () => {
  const guild = makeGuild({
    channels: [{ id: 'cat1', name: 'Support', type: 4 }],
    roles: [{ id: 'r1', name: 'Support Team', position: 5 }],
  });
  const result = await getTool('create_ticket_channel').execute(ctx(guild), {
    name: 'ticket-alice',
    category: 'Support',
    staffRole: 'Support Team',
  });
  assert.equal(result.ok, true);
  const created = guild.channels.cache.get(result.data.id);
  assert.ok(created.permissionOverwrites.cache.size >= 2);
});

test('the welcome configuration is stored for the guild', async () => {
  const guild = makeGuild({ channels: [{ id: 'c1', name: 'welcome' }] });
  const stored = {};
  const localCtx = {
    ...ctx(guild),
    storage: {
      getSetting: async (_g, _k) => stored[_k] || null,
      setSetting: async (_g, k, v) => {
        stored[k] = v;
      },
    },
  };
  const result = await getTool('set_welcome_channel').execute(localCtx, {
    channel: 'welcome',
    message: 'Welcome {user} to {server}!',
  });
  assert.equal(result.ok, true);
  assert.equal(stored.welcome.channelId, 'c1');
});

test('a ban removes the member and refuses to ban a bot', async () => {
  const guild = makeGuild({
    members: [
      { id: 'u1', username: 'spammer' },
      { id: 'u2', username: 'robot', isBot: true },
    ],
  });
  const result = await getTool('ban_member').execute(ctx(guild), { member: 'spammer' });
  assert.equal(result.ok, true);
  assert.equal(guild.__banned.length, 1);

  await assert.rejects(() => getTool('ban_member').execute(ctx(guild), { member: 'robot' }), /bot account/i);
});

test('the server owner cannot be banned', async () => {
  const guild = makeGuild({ ownerId: 'owner-1' });
  guild.members.cache.set(
    'owner-1',
    Object.assign(guild.members.cache.get('bot-1'), { id: 'owner-1', user: { id: 'owner-1', username: 'owner' } }),
  );
  await assert.rejects(() => getTool('ban_member').execute(ctx(guild), { member: 'owner' }), /owner/i);
});
