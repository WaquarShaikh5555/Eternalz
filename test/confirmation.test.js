'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createPendingPlan,
  loadPlan,
  expireStalePlans,
  parseCustomId,
  assertRequester,
  buildPlanEmbed,
  buildButtons,
  STATUS,
} = require('../src/admin/confirmation');
const { JsonStore } = require('../src/storage/json-driver');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eternalz-confirm-'));
  return new JsonStore({ file: path.join(dir, 'store.json') });
}

const config = { aiConfirmTimeoutMs: 5 * 60_000 };

async function makePlan(store, overrides = {}) {
  return createPendingPlan({
    storage: store,
    config,
    guildId: 'guild-1',
    requesterId: 'owner-1',
    prompt: 'create a Support category',
    actions: [{ tool: 'create_category', args: { name: 'Support' }, description: 'Create "Support"' }],
    risk: 'confirm',
    reasons: ['deletion'],
    ...overrides,
  });
}

test('a pending plan is stored with an id and an expiry', async () => {
  const store = tempStore();
  await store.init();
  const plan = await makePlan(store);
  assert.ok(plan.id.length >= 16);
  assert.equal(plan.status, STATUS.PENDING);
  assert.ok(plan.expiresAt > plan.createdAt);

  const loaded = await store.getPlan(plan.id);
  assert.equal(loaded.requesterId, 'owner-1');
  await store.close();
});

test('only the requester may confirm a plan', async () => {
  const store = tempStore();
  await store.init();
  const plan = await makePlan(store);
  assert.doesNotThrow(() => assertRequester(plan, 'owner-1'));
  assert.throws(() => assertRequester(plan, 'someone-else'), /only the person who requested/i);
  await store.close();
});

test('an expired plan is marked as expired when it is loaded', async () => {
  const store = tempStore();
  await store.init();
  const plan = await makePlan(store);
  await store.updatePlan(plan.id, { expiresAt: Date.now() - 1000 });

  const loaded = await loadPlan(store, plan.id);
  assert.equal(loaded.status, STATUS.EXPIRED);
  await store.close();
});

test('stale plans are expired on start-up', async () => {
  const store = tempStore();
  await store.init();
  const plan = await makePlan(store);
  await store.updatePlan(plan.id, { expiresAt: Date.now() - 1000 });

  const count = await expireStalePlans(store);
  assert.equal(count, 1);
  const loaded = await store.getPlan(plan.id);
  assert.equal(loaded.status, STATUS.EXPIRED);
  await store.close();
});

test('button custom ids are parsed and unknown ids are ignored', () => {
  assert.deepEqual(parseCustomId('ai_admin:confirm:abc123'), {
    action: 'confirm',
    planId: 'abc123',
  });
  assert.equal(parseCustomId('other:confirm:abc'), null);
  assert.equal(parseCustomId('ai_admin:bogus:abc'), null);
  assert.equal(parseCustomId('nonsense'), null);
});

test('the plan embed lists every action and the risk', async () => {
  const store = tempStore();
  await store.init();
  const plan = await makePlan(store);
  const embed = buildPlanEmbed(plan);
  const json = embed.toJSON();
  const text = JSON.stringify(json);
  assert.match(text, /Support/);
  assert.match(text, /Needs confirmation/i);
  await store.close();
});

test('the confirm and cancel buttons are generated', async () => {
  const store = tempStore();
  await store.init();
  const plan = await makePlan(store);
  const row = buildButtons(plan).toJSON();
  assert.equal(row.components.length, 2);
  assert.match(row.components[0].custom_id, /^ai_admin:confirm:/);
  assert.match(row.components[1].custom_id, /^ai_admin:cancel:/);
  await store.close();
});
