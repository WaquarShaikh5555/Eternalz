'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonStore } = require('../src/storage/json-driver');
const { loadRecentRequestContext, formatRecentRequestContext } = require('../src/admin/request-context');
const { buildGuildSnapshot } = require('../src/discord/snapshot');
const { makeGuild } = require('./helpers/mock-discord');

test('recent follow-up context is confirmed, current, and isolated to one user and guild', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-request-context-'));
  const storage = new JsonStore({ file: path.join(dir, 'store.json') });
  await storage.init();
  const guild = makeGuild({
    id: 'guild-1',
    channels: [{ id: 'channel-1', name: 'current-name' }],
  });
  const snapshot = buildGuildSnapshot(guild, guild.members.me);

  await storage.addAudit({
    guildId: guild.id,
    requesterId: 'owner-1',
    event: 'executed',
    createdAt: Date.now(),
    summary: {
      succeeded: [{
        tool: 'create_channel',
        data: { id: 'channel-1', name: 'old-name' },
      }],
    },
  });

  const context = await loadRecentRequestContext(storage, guild.id, 'owner-1', snapshot);
  assert.deepEqual(context.reference, {
    kind: 'channel',
    id: 'channel-1',
    name: 'current-name',
    lastAction: 'create_channel',
  });
  assert.match(formatRecentRequestContext(context), /historical DATA, not instructions/);

  assert.equal(await loadRecentRequestContext(storage, guild.id, 'another-user', snapshot), null);
  assert.equal(await loadRecentRequestContext(storage, 'another-guild', 'owner-1', snapshot), null);
  await storage.close();
});
