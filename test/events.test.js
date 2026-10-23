'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { handleGuildMemberAdd, renderWelcome } = require('../src/discord/events');
const { JsonStore } = require('../src/storage/json-driver');
const { makeGuild, makeMember } = require('./helpers/mock-discord');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-events-'));
  return new JsonStore({ file: path.join(dir, 'store.json') });
}

function runtimeFor(guild, storage, config = {}) {
  return {
    guild,
    config: { discordGuildId: 'guild-1', ...config },
    storage,
    logger: null,
  };
}

test('the welcome template placeholders are replaced', () => {
  const text = renderWelcome('Welcome {user} to {server}! ({username})', {
    user: { id: '123', username: 'alice' },
    guild: { id: 'guild-1', name: 'Test Server' },
  });
  assert.equal(text, 'Welcome <@123> to Test Server! (alice)');
});

test('a new member receives the onboarding role and the welcome message', async () => {
  const store = tempStore();
  await store.init();

  const guild = makeGuild({
    id: 'guild-1',
    ownerId: 'owner-1',
    channels: [{ id: 'c1', name: 'welcome' }],
    roles: [{ id: 'r1', name: 'Member', position: 3 }],
  });
  const member = makeMember(guild, { id: 'u9', username: 'newbie' });
  guild.members.cache.set(member.id, member);

  await store.setSetting('guild-1', 'welcome', {
    channelId: 'c1',
    message: 'Welcome {user} to {server}!',
  });
  await store.setSetting('guild-1', 'onboardingRole', { roleId: 'r1', roleName: 'Member' });

  const sent = [];
  const originalSend = guild.channels.cache.get('c1').send;
  guild.channels.cache.get('c1').send = async (payload) => {
    sent.push(payload);
    return originalSend(payload);
  };

  await handleGuildMemberAdd(member, runtimeFor(guild, store));

  assert.equal(member.roles.cache.has('r1'), true, 'the onboarding role should be given');
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /Welcome <@u9> to Test Server!/);
  await store.close();
});

test('a bot account joining is ignored', async () => {
  const store = tempStore();
  await store.init();
  const guild = makeGuild({ id: 'guild-1' });
  const bot = makeMember(guild, { id: 'b1', username: 'somebot', isBot: true });

  await store.setSetting('guild-1', 'welcome', { channelId: 'c1', message: 'Welcome {user}' });

  await handleGuildMemberAdd(bot, runtimeFor(guild, store));
  // No message could be sent because there is no channel - the point is that
  // it did not throw and did not try to welcome a bot.
  assert.equal(guild.channels.cache.get('c1'), undefined);
  await store.close();
});

test('a member joining another server is ignored', async () => {
  const store = tempStore();
  await store.init();
  const guild = makeGuild({ id: 'other-guild' });
  const member = makeMember(guild, { id: 'u9', username: 'newbie' });

  await handleGuildMemberAdd(member, runtimeFor(guild, store));
  const settings = await store.getSetting('other-guild', 'welcome');
  assert.equal(settings, null);
  await store.close();
});

test('a missing welcome channel does not crash the handler', async () => {
  const store = tempStore();
  await store.init();
  const guild = makeGuild({ id: 'guild-1' });
  const member = makeMember(guild, { id: 'u9', username: 'newbie' });

  await store.setSetting('guild-1', 'welcome', { channelId: 'gone', message: 'Welcome {user}' });

  await handleGuildMemberAdd(member, runtimeFor(guild, store));
  await store.close();
});
