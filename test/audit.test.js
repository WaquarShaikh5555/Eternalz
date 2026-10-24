'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonStore } = require('../src/storage/json-driver');
const { AuditLogger } = require('../src/audit/audit');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-audit-'));
  return new JsonStore({ file: path.join(dir, 'store.json') });
}

function fakeClient(channelId, sent) {
  return {
    channels: {
      fetch: async (id) => {
        if (id !== channelId) return null;
        return {
          id,
          isTextBased: () => true,
          isDMBased: () => false,
          send: async (payload) => {
            sent.push(payload);
            return { id: 'm1' };
          },
        };
      },
    },
  };
}

test('an audit entry is stored and can be read back', async () => {
  const store = tempStore();
  await store.init();
  const audit = new AuditLogger({ storage: store, config: { aiAuditChannelId: '' } });

  await audit.log({
    guildId: 'guild-1',
    requesterId: 'user-1',
    event: 'executed',
    prompt: 'create a Support category',
    summary: { succeeded: [{ tool: 'create_category' }] },
  });

  const entries = await audit.list('guild-1', 10);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'executed');
  assert.equal(entries[0].requesterId, 'user-1');
  assert.ok(entries[0].createdAt > 0);
  await store.close();
});

test('the entry is mirrored to the audit channel when one is configured', async () => {
  const store = tempStore();
  await store.init();
  const sent = [];
  const audit = new AuditLogger({
    storage: store,
    config: { aiAuditChannelId: 'channel-1' },
    client: fakeClient('channel-1', sent),
  });

  await audit.log({
    guildId: 'guild-1',
    requesterId: 'user-1',
    event: 'executed',
    prompt: 'create a Support category',
    summary: { ok: true },
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /AI admin event/);
  assert.match(sent[0].content, /Server ID.*guild-1/);
  assert.match(sent[0].content, /create a Support category/);
  await store.close();
});

test('nothing is posted when no audit channel is configured', async () => {
  const store = tempStore();
  await store.init();
  const sent = [];
  const audit = new AuditLogger({
    storage: store,
    config: { aiAuditChannelId: '' },
    client: fakeClient('channel-1', sent),
  });

  await audit.log({ guildId: 'guild-1', event: 'planned', prompt: 'x' });
  assert.equal(sent.length, 0);
  await store.close();
});

test('a very long prompt is truncated', async () => {
  const store = tempStore();
  await store.init();
  const audit = new AuditLogger({ storage: store, config: { aiAuditChannelId: '' } });

  await audit.log({ guildId: 'guild-1', event: 'planned', prompt: 'x'.repeat(5000) });
  const entries = await audit.list('guild-1', 10);
  assert.equal(entries[0].prompt.length, 2000);
  await store.close();
});

test('a failure in the audit channel does not break the request', async () => {
  const store = tempStore();
  await store.init();
  const audit = new AuditLogger({
    storage: store,
    config: { aiAuditChannelId: 'channel-1' },
    client: {
      channels: {
        fetch: async () => {
          throw new Error('Missing Access');
        },
      },
    },
  });

  await audit.log({ guildId: 'guild-1', event: 'planned', prompt: 'x' });
  const entries = await audit.list('guild-1', 10);
  assert.equal(entries.length, 1, 'the entry must still be stored');
  await store.close();
});
