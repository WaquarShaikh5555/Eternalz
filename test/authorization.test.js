'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isGuildAdmin, assertGuildAdmin, describeRefusal } = require('../src/admin/authorization');
const { makeGuild } = require('./helpers/mock-discord');

function config(overrides = {}) {
  return {
    aiAdminEnabled: true,
    aiWriteEnabled: true,
    aiMultiGuild: false,
    discordGuildId: 'guild-1',
    aiAdminUserIds: [],
    aiAdminRoleIds: [],
    ...overrides,
  };
}

test('the guild owner is authorised even without an explicit id list', () => {
  const guild = makeGuild({ ownerId: 'owner-1' });
  assert.equal(isGuildAdmin(config(), guild, 'owner-1'), true);
});

test('a configured administrator id is authorised', () => {
  const guild = makeGuild();
  const cfg = config({ aiAdminUserIds: ['admin-1', 'admin-2'] });
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1'), true);
  assert.equal(isGuildAdmin(cfg, guild, 'admin-2'), true);
});

test('an ordinary member is not authorised', () => {
  const guild = makeGuild();
  assert.equal(isGuildAdmin(config(), guild, 'random-user'), false);
});

test('a member with the ManageGuild role is still not authorised on its own', () => {
  const guild = makeGuild({
    roles: [{ id: 'role-mod', name: 'Moderator', position: 5 }],
    members: [{ id: 'mod-1', username: 'mod', roleIds: ['role-mod'] }],
  });
  assert.equal(isGuildAdmin(config(), guild, 'mod-1'), false);
});

test('an explicitly configured administrator role grants access', () => {
  const guild = makeGuild({
    roles: [{ id: 'role-mod', name: 'Moderator', position: 5 }],
    members: [{ id: 'mod-1', username: 'mod', roleIds: ['role-mod'] }],
  });
  const cfg = config({ aiAdminRoleIds: ['role-mod'] });
  assert.equal(isGuildAdmin(cfg, guild, 'mod-1'), true);
});

test('AI administration is restricted to the configured guild', () => {
  const guild = makeGuild({ id: 'other-guild', ownerId: 'owner-1' });
  const cfg = config({ discordGuildId: 'guild-1', aiAdminUserIds: ['admin-1'] });
  assert.equal(isGuildAdmin(cfg, guild, 'owner-1'), false);
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1'), false);
});

test('multi-guild mode allows a configured user with Administrator in another guild', () => {
  const guild = makeGuild({
    id: 'other-guild',
    ownerId: 'someone-else',
    members: [{ id: 'admin-1', username: 'admin', permissions: ['Administrator'] }],
  });
  const cfg = config({ aiMultiGuild: true, aiAdminUserIds: ['admin-1'] });
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1'), true);
});

test('multi-guild mode also accepts Manage Server and fresh interaction permissions', () => {
  const guild = makeGuild({ id: 'other-guild', ownerId: 'someone-else' });
  const cfg = config({ aiMultiGuild: true, aiAdminUserIds: ['admin-1'] });
  const interactionMember = {
    user: { id: 'admin-1' },
    permissions: String(32n), // ManageGuild, as raw interaction members expose a string.
  };
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1', interactionMember), true);
});

test('multi-guild mode allows a configured user who owns the other guild', () => {
  const guild = makeGuild({ id: 'other-guild', ownerId: 'admin-1' });
  const cfg = config({ aiMultiGuild: true, aiAdminUserIds: ['admin-1'] });
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1'), true);
});

test('multi-guild mode does not authorize every server owner or administrator', () => {
  const ownerGuild = makeGuild({ id: 'other-guild', ownerId: 'other-owner' });
  const adminGuild = makeGuild({
    id: 'admin-guild',
    ownerId: 'someone-else',
    members: [{ id: 'other-admin', permissions: ['Administrator'] }],
  });
  const cfg = config({ aiMultiGuild: true, aiAdminUserIds: ['admin-1'] });
  assert.equal(isGuildAdmin(cfg, ownerGuild, 'other-owner'), false);
  assert.equal(isGuildAdmin(cfg, adminGuild, 'other-admin'), false);
});

test('a configured user without a management permission is rejected outside the primary guild', () => {
  const guild = makeGuild({
    id: 'other-guild',
    ownerId: 'someone-else',
    members: [{ id: 'admin-1', permissions: ['ManageChannels'] }],
  });
  const cfg = config({ aiMultiGuild: true, aiAdminUserIds: ['admin-1'] });
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1'), false);
  assert.throws(
    () => assertGuildAdmin(cfg, guild, 'admin-1'),
    /Administrator or Manage Server/,
  );
});

test('primary-guild role ids are not reused as multi-guild authorization', () => {
  const guild = makeGuild({
    id: 'other-guild',
    ownerId: 'someone-else',
    roles: [{ id: 'role-mod', name: 'Moderator' }],
    members: [{ id: 'admin-1', roleIds: ['role-mod'], permissions: ['ManageChannels'] }],
  });
  const cfg = config({
    aiMultiGuild: true,
    aiAdminUserIds: ['admin-1'],
    aiAdminRoleIds: ['role-mod'],
  });
  assert.equal(isGuildAdmin(cfg, guild, 'admin-1'), false);
});

test('assertGuildAdmin throws for an ordinary member', () => {
  const guild = makeGuild();
  assert.throws(
    () => assertGuildAdmin(config(), guild, 'random-user'),
    /configured administrators can use AI administration/i,
  );
});

test('nothing is authorised when no target guild is configured', () => {
  const guild = makeGuild({ ownerId: 'owner-1' });
  const cfg = config({ discordGuildId: '' });
  assert.equal(isGuildAdmin(cfg, guild, 'owner-1'), false);
  assert.throws(() => assertGuildAdmin(cfg, guild, 'owner-1'), /DISCORD_GUILD_ID/);
});

test('assertGuildAdmin throws when AI administration is disabled', () => {
  const guild = makeGuild();
  const cfg = config({ aiAdminEnabled: false, aiAdminUserIds: ['owner-1'] });
  assert.throws(() => assertGuildAdmin(cfg, guild, 'owner-1'), /disabled/i);
});

test('describeRefusal never leaks configuration details', () => {
  const guild = makeGuild();
  const refusal = describeRefusal(config(), guild, 'random-user');
  assert.equal(refusal, 'not authorised');
  assert.ok(!JSON.stringify(refusal).includes('token'));
});
