'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assessAction, assessPlan, RISK } = require('../src/admin/risk');
const { getTool } = require('../src/discord/tools');

function action(tool, args = {}) {
  return { tool, args, toolDef: getTool(tool) };
}

test('creating an ordinary channel is safe', () => {
  const result = assessAction(action('create_channel', { name: 'general' }));
  assert.equal(result.level, RISK.SAFE);
});

test('renaming a channel is safe', () => {
  const result = assessAction(action('rename_channel', { channel: 'general', name: 'talk' }));
  assert.equal(result.level, RISK.SAFE);
});

test('deleting a channel requires confirmation', () => {
  const result = assessAction(action('delete_channel', { channel: 'general' }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('deleting a role requires confirmation', () => {
  const result = assessAction(action('delete_role', { role: 'VIP' }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('banning requires confirmation', () => {
  const result = assessAction(action('ban_member', { member: 'spammer' }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('kicking requires confirmation', () => {
  const result = assessAction(action('kick_member', { member: 'spammer' }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('changing permissions of an existing channel requires confirmation', () => {
  const result = assessAction(
    action('set_permission_overwrite', { channel: 'staff', target: 'Mods', allow: [], deny: [] }),
  );
  assert.equal(result.level, RISK.CONFIRM);
});

test('editing the permissions of an existing role requires confirmation', () => {
  const result = assessAction(action('edit_role', { role: 'Mods', permissions: ['ViewChannel'] }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('renaming a role without touching permissions stays safe', () => {
  const result = assessAction(action('edit_role', { role: 'Mods', name: 'Moderators' }));
  assert.equal(result.level, RISK.SAFE);
});

test('creating a role with Administrator needs two confirmations', () => {
  const result = assessAction(action('create_role', { name: 'God', permissions: ['Administrator'] }));
  assert.equal(result.level, RISK.CONFIRM_TWICE);
});

test('creating a role with a highly privileged permission needs confirmation', () => {
  const result = assessAction(action('create_role', { name: 'Mods', permissions: ['BanMembers'] }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('creating a role with ordinary permissions stays safe', () => {
  const result = assessAction(
    action('create_role', { name: 'VIP', permissions: ['ViewChannel', 'SendMessages'] }),
  );
  assert.equal(result.level, RISK.SAFE);
});

test('creating a private channel requires confirmation', () => {
  const result = assessAction(action('create_channel', { name: 'secret', private: true }));
  assert.equal(result.level, RISK.CONFIRM);
});

test('a plan with three destructive actions needs two confirmations', () => {
  const plan = assessPlan([
    { tool: 'delete_channel', args: { channel: 'a' } },
    { tool: 'delete_channel', args: { channel: 'b' } },
    { tool: 'delete_role', args: { role: 'c' } },
  ]);
  assert.equal(plan.level, RISK.CONFIRM_TWICE);
  assert.ok(plan.reasons.some((r) => /destructive actions/.test(r)));
});

test('removing a role from many members at once needs two confirmations', () => {
  const plan = assessPlan([
    { tool: 'remove_role', args: { member: 'a', role: 'VIP' } },
    { tool: 'remove_role', args: { member: 'b', role: 'VIP' } },
    { tool: 'remove_role', args: { member: 'c', role: 'VIP' } },
  ]);
  assert.equal(plan.level, RISK.CONFIRM_TWICE);
});

test('removing a role from a single member stays safe', () => {
  const plan = assessPlan([{ tool: 'remove_role', args: { member: 'a', role: 'VIP' } }]);
  assert.equal(plan.level, RISK.SAFE);
});

test('an empty plan is read-only', () => {
  const plan = assessPlan([]);
  assert.equal(plan.level, RISK.READ);
});

test('a plan of only safe actions is safe', () => {
  const plan = assessPlan([
    { tool: 'create_category', args: { name: 'Support' } },
    { tool: 'create_channel', args: { name: 'tickets', category: 'Support' } },
  ]);
  assert.equal(plan.level, RISK.SAFE);
  assert.equal(plan.counts.safe, 2);
});
