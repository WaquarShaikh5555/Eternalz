'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldRegisterInTargetGuild } = require('../src/discord/command-scope');

const ai = { guildOnly: true, multiGuild: true };
const status = { guildOnly: true };
const ordinary = {};

test('/ai stays guild-scoped by default', () => {
  const config = { discordGuildId: 'guild-1', aiMultiGuild: false };
  assert.equal(shouldRegisterInTargetGuild(ai, config), true);
});

test('multi-guild mode moves only the opted-in /ai command to global registration', () => {
  const config = { discordGuildId: 'guild-1', aiMultiGuild: true };
  assert.equal(shouldRegisterInTargetGuild(ai, config), false);
  assert.equal(shouldRegisterInTargetGuild(status, config), true);
  assert.equal(shouldRegisterInTargetGuild(ordinary, config), false);
});

test('guild registration is impossible without a primary guild id', () => {
  assert.equal(shouldRegisterInTargetGuild(ai, { discordGuildId: '', aiMultiGuild: false }), false);
});
