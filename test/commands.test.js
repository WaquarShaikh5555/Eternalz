'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Collection } = require('discord.js');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function loadCommands(dir, collection = new Collection()) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      loadCommands(fullPath, collection);
    } else if (file.endsWith('.js')) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const command = require(fullPath);
      if (command.data && command.execute) collection.set(command.data.name, command);
    }
  }
  return collection;
}

test('every command can be serialised for the Discord API', () => {
  const commands = loadCommands(COMMANDS_DIR);
  assert.ok(commands.size >= 8, 'expected the existing commands plus the new admin commands');
  for (const [name, command] of commands) {
    const json = command.data.toJSON();
    assert.equal(json.name, name);
    assert.ok(json.description && json.description.length > 0, `${name} needs a description`);
    assert.ok(json.options === undefined || Array.isArray(json.options));
  }
});

test('the command names are unique', () => {
  const commands = loadCommands(COMMANDS_DIR);
  const names = [...commands.keys()];
  assert.equal(new Set(names).size, names.length);
});

test('the AI administration commands are scoped to the target guild', () => {
  const commands = loadCommands(COMMANDS_DIR);
  for (const name of ['ai', 'ai-status', 'ai-audit', 'add-admin']) {
    const command = commands.get(name);
    assert.ok(command, `/${name} should exist`);
    assert.equal(command.guildOnly, true, `/${name} must be guild scoped`);
  }
});

test('only /ai and /add-admin opt into global registration for multi-guild mode', () => {
  const commands = loadCommands(COMMANDS_DIR);
  assert.equal(commands.get('ai').multiGuild, true);
  assert.equal(commands.get('add-admin').multiGuild, true);
  assert.notEqual(commands.get('ai-status').multiGuild, true);
  assert.notEqual(commands.get('ai-audit').multiGuild, true);
});

test('the ordinary commands stay globally available', () => {
  const commands = loadCommands(COMMANDS_DIR);
  for (const name of ['ping', 'meme', 'poll', 'userinfo', 'search', 'aichat', 'mostactive']) {
    const command = commands.get(name);
    assert.ok(command, `/${name} should exist`);
    assert.notEqual(command.guildOnly, true);
  }
});

test('/ai takes a prompt and an optional dry-run flag', () => {
  const commands = loadCommands(COMMANDS_DIR);
  const json = commands.get('ai').data.toJSON();
  const prompt = json.options.find((o) => o.name === 'prompt');
  const dryRun = json.options.find((o) => o.name === 'dry_run');
  assert.ok(prompt);
  assert.equal(prompt.required, true);
  assert.equal(prompt.type, 3); // STRING
  assert.ok(dryRun);
  assert.equal(dryRun.type, 5); // BOOLEAN
  assert.equal(dryRun.required, false);
});

test('/add-admin requires one user and is guild-only', () => {
  const commands = loadCommands(COMMANDS_DIR);
  const json = commands.get('add-admin').data.toJSON();
  const user = json.options.find((option) => option.name === 'user');
  assert.ok(user);
  assert.equal(user.type, 6); // USER
  assert.equal(user.required, true);
  assert.deepEqual(json.contexts, [0]);
});

test('/ai is only usable inside a server', () => {
  const commands = loadCommands(COMMANDS_DIR);
  const json = commands.get('ai').data.toJSON();
  assert.deepEqual(json.contexts, [0]); // InteractionContextType.Guild
});
