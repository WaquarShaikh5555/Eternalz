'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonStore } = require('../src/storage/json-driver');
const { SqliteStore } = require('../src/storage/sqlite-driver');
const { createStore } = require('../src/storage');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-test-'));
}

async function exerciseStore(store) {
  const plan = {
    id: 'plan-1',
    guildId: 'guild-1',
    requesterId: 'user-1',
    prompt: 'create a category',
    actions: [{ tool: 'create_category', args: { name: 'Support' } }],
    risk: 'safe',
    reasons: [],
    status: 'pending',
    createdAt: 1000,
    expiresAt: 2000,
    confirmedAt: null,
    executedAt: null,
    result: null,
  };

  await store.putPlan(plan);
  const loaded = await store.getPlan('plan-1');
  assert.equal(loaded.guildId, 'guild-1');
  assert.equal(loaded.actions.length, 1);
  assert.equal(loaded.actions[0].args.name, 'Support');

  await store.updatePlan('plan-1', { status: 'confirmed' });
  const updated = await store.getPlan('plan-1');
  assert.equal(updated.status, 'confirmed');

  assert.equal(await store.getPlan('missing'), null);

  await store.addAudit({
    guildId: 'guild-1',
    requesterId: 'user-1',
    event: 'executed',
    prompt: 'hello',
    summary: { ok: true },
    createdAt: 1234,
  });
  const audit = await store.listAudit('guild-1', 10);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event, 'executed');

  await store.setSetting('guild-1', 'welcome', { channelId: 'c1' });
  const setting = await store.getSetting('guild-1', 'welcome');
  assert.equal(setting.channelId, 'c1');
  assert.equal(await store.getSetting('guild-1', 'nope'), null);

  const plans = await store.listPlans('guild-1', 10);
  assert.equal(plans.length, 1);

  await store.close();
}

test('the json driver stores and reloads plans, audit entries and settings', async () => {
  const dir = tempDir();
  const store = new JsonStore({ file: path.join(dir, 'store.json') });
  await store.init();
  await exerciseStore(store);
});

test('the json driver survives a restart', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'store.json');

  const first = new JsonStore({ file });
  await first.init();
  await first.putPlan({
    id: 'plan-2',
    guildId: 'guild-1',
    requesterId: 'user-1',
    prompt: 'x',
    actions: [],
    risk: 'safe',
    reasons: [],
    status: 'pending',
    createdAt: 1,
    expiresAt: 2,
    confirmedAt: null,
    executedAt: null,
    result: null,
  });
  await first.close();

  const second = new JsonStore({ file });
  await second.init();
  const plan = await second.getPlan('plan-2');
  assert.ok(plan);
  assert.equal(plan.id, 'plan-2');
  await second.close();
});

test('the sqlite driver stores and reloads plans, audit entries and settings', async (t) => {
  if (!SqliteStore.isAvailable()) {
    t.skip('node:sqlite is not available on this Node.js version');
    return;
  }
  const dir = tempDir();
  const store = new SqliteStore({ file: path.join(dir, 'store.db') });
  await store.init();
  await exerciseStore(store);
});

test('the storage factory picks a working driver', async () => {
  const dir = tempDir();
  const store = await createStore(
    { storageDriver: 'auto', dataDir: dir, storageFile: path.join(dir, 'store.json') },
    null,
  );
  assert.ok(store);
  await store.putPlan({
    id: 'p',
    guildId: 'g',
    requesterId: 'u',
    prompt: '',
    actions: [],
    risk: 'safe',
    reasons: [],
    status: 'pending',
    createdAt: 1,
    expiresAt: 2,
    confirmedAt: null,
    executedAt: null,
    result: null,
  });
  assert.ok(await store.getPlan('p'));
  await store.close();
});

test('the storage factory honours STORAGE_DRIVER=json', async () => {
  const dir = tempDir();
  const store = await createStore(
    { storageDriver: 'json', dataDir: dir, storageFile: path.join(dir, 'store.json') },
    null,
  );
  assert.equal(store.name, 'json');
  await store.close();
});
