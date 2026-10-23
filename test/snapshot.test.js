'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGuildSnapshot, formatSnapshotForPrompt } = require('../src/discord/snapshot');
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
