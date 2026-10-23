'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGuildSnapshot,
  compactSnapshot,
  formatSnapshotForPrompt,
  PROMPT_LIMITS,
} = require('../src/discord/snapshot');
const { makeGuild, makeOverwrite } = require('./helpers/mock-discord');

test('guild snapshots serialize Discord.js permission bitfields safely', () => {
  const guild = makeGuild({
    channels: [
      {
        id: 'channel-general',
        name: 'general',
        overwrites: [
          makeOverwrite({
            id: 'role-members',
            allow: ['ViewChannel', 'SendMessages'],
            deny: ['ManageMessages'],
          }),
        ],
      },
    ],
  });

  // This used to throw `o.allow.map is not a function` with real Discord.js
  // PermissionOverwrite objects before the request ever reached the AI.
  const snapshot = buildGuildSnapshot(guild, guild.members.me);
  const overwrite = snapshot.channels[0].overwrites[0];

  assert.ok(Array.isArray(overwrite.allow));
  assert.ok(Array.isArray(overwrite.deny));
  assert.deepEqual(overwrite.allow.slice().sort(), ['SendMessages', 'ViewChannel']);
  assert.deepEqual(overwrite.deny, ['ManageMessages']);
  assert.doesNotThrow(() => formatSnapshotForPrompt(snapshot));
});

test('the prompt view is bounded without truncating the application snapshot', () => {
  const guild = makeGuild({
    channels: Array.from({ length: 120 }, (_, index) => ({
      id: `channel-${index}`,
      name: `channel-${index}`,
      topic: 'A long topic that should not be copied into every AI request.',
    })),
    roles: Array.from({ length: 80 }, (_, index) => ({
      id: `role-${index}`,
      name: `role-${index}`,
    })),
  });

  const full = buildGuildSnapshot(guild, guild.members.me);
  const compact = compactSnapshot(full);
  const prompt = formatSnapshotForPrompt(full);

  assert.equal(full.channels.length, 120);
  assert.ok(full.roles.length >= 80); // also includes @everyone and the bot role
  assert.ok(compact.channels.length < full.channels.length);
  assert.equal(compact.overviewTruncated, true);
  assert.ok(JSON.stringify(compact).length <= PROMPT_LIMITS.maxChars);
  assert.ok(prompt.length <= PROMPT_LIMITS.maxChars + 500);
  assert.match(prompt, /bounded overview/);
});
