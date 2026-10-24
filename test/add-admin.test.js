'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const addAdmin = require('../commands/admin/add-admin');
const { runtime } = require('../src/runtime');
const { JsonStore } = require('../src/storage/json-driver');
const { hasGuildAdminGrant } = require('../src/admin/grants');
const { getApplicationOwnerId } = require('../src/admin/owner');
const { makeGuild } = require('./helpers/mock-discord');

async function storeForTest(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-add-admin-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();

  const previous = {
    storage: runtime.storage,
    audit: runtime.audit,
    logger: runtime.logger,
    config: runtime.config,
  };
  runtime.storage = storage;
  runtime.audit = null;
  runtime.logger = null;
  runtime.config = { discordGuildId: 'guild-add-admin', aiMultiGuild: true };
  t.after(async () => {
    runtime.storage = previous.storage;
    runtime.audit = previous.audit;
    runtime.logger = previous.logger;
    runtime.config = previous.config;
    await storage.close();
  });
  return storage;
}

function interactionFor(guild, requesterId, targetId, ownerId = 'owner-user') {
  const replies = [];
  const target = guild.members.cache.get(targetId);
  return {
    user: { id: requesterId },
    member: guild.members.cache.get(requesterId) || null,
    guild,
    client: {
      application: { fetch: async () => ({ owner: { id: ownerId } }) },
    },
    options: {
      getUser: () => target.user,
    },
    replies,
    async deferReply() {},
    async editReply(payload) {
      replies.push(payload);
      return payload;
    },
    async reply(payload) {
      replies.push(payload);
      return payload;
    },
  };
}

function guildForTest() {
  return makeGuild({
    id: 'guild-add-admin',
    ownerId: 'someone-else',
    members: [
      { id: 'owner-user', username: 'owner', permissions: ['Administrator'] },
      { id: 'target-user', username: 'target' },
      { id: 'third-user', username: 'third' },
    ],
  });
}

test('the application owner can grant /ai access in exactly one guild', async (t) => {
  const storage = await storeForTest(t);
  const guild = guildForTest();
  const interaction = interactionFor(guild, 'owner-user', 'target-user');

  await addAdmin.execute(interaction);

  assert.equal(await hasGuildAdminGrant(storage, guild.id, 'target-user'), true);
  assert.equal(await hasGuildAdminGrant(storage, 'another-guild', 'target-user'), false);
  assert.match(interaction.replies.at(-1).content, /this server only/i);
  assert.match(interaction.replies.at(-1).content, /cannot use `\/add-admin`/i);
});

test('a grantee still cannot add another administrator', async (t) => {
  const storage = await storeForTest(t);
  const guild = guildForTest();
  await addAdmin.execute(interactionFor(guild, 'owner-user', 'target-user'));

  const attack = interactionFor(guild, 'target-user', 'third-user');
  await addAdmin.execute(attack);

  assert.equal(await hasGuildAdminGrant(storage, guild.id, 'third-user'), false);
  assert.match(attack.replies.at(-1).content, /Only the Discord application owner/);
});

test('an unconfigured member cannot use add-admin even with Discord Administrator', async (t) => {
  const storage = await storeForTest(t);
  const guild = guildForTest();
  const interaction = interactionFor(guild, 'third-user', 'target-user');
  interaction.member = {
    user: { id: 'third-user' },
    permissions: guild.members.cache.get('owner-user').permissions,
  };

  await addAdmin.execute(interaction);

  assert.equal(await hasGuildAdminGrant(storage, guild.id, 'target-user'), false);
  assert.match(interaction.replies.at(-1).content, /Only the Discord application owner/);
});

test('the application owner must also administer the current guild', async (t) => {
  const storage = await storeForTest(t);
  const guild = guildForTest();
  const interaction = interactionFor(guild, 'owner-user', 'target-user');
  interaction.member = { user: { id: 'owner-user' }, permissions: '0' };

  await addAdmin.execute(interaction);

  assert.equal(await hasGuildAdminGrant(storage, guild.id, 'target-user'), false);
  assert.match(interaction.replies.at(-1).content, /own this server or have Administrator/);
});

test('add-admin cannot create unusable cross-guild grants while multi-guild mode is off', async (t) => {
  const storage = await storeForTest(t);
  runtime.config.aiMultiGuild = false;
  const guild = guildForTest();
  guild.id = 'another-guild';
  const interaction = interactionFor(guild, 'owner-user', 'target-user');

  await addAdmin.execute(interaction);

  assert.equal(await hasGuildAdminGrant(storage, guild.id, 'target-user'), false);
  assert.match(interaction.replies.at(-1).content, /Multi-guild AI access is disabled/);
});

test('a team application accepts only its owning user id', async () => {
  const client = {
    application: {
      fetch: async () => ({
        owner: { id: 'team-id', ownerId: 'owner-user', members: new Map() },
      }),
    },
  };
  assert.equal(await getApplicationOwnerId(client), 'owner-user');
});

test('grants survive a storage restart without becoming global', async (t) => {
  const storage = await storeForTest(t);
  const guild = guildForTest();
  await addAdmin.execute(interactionFor(guild, 'owner-user', 'target-user'));
  const file = storage.file;
  await storage.close();

  const reopened = new JsonStore({ file });
  await reopened.init();
  t.after(() => reopened.close());
  assert.equal(await hasGuildAdminGrant(reopened, guild.id, 'target-user'), true);
  assert.equal(await hasGuildAdminGrant(reopened, 'another-guild', 'target-user'), false);
});
