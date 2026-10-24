'use strict';

/**
 * Slash command registration.
 *
 * Usage:
 *   node config/deploy-commands.js            # global commands + guild-scoped admin commands
 *   node config/deploy-commands.js --guild    # register everything in DISCORD_GUILD_ID (instant)
 *   node config/deploy-commands.js --global   # register everything globally (can take up to an hour)
 *
 * Guild registration appears immediately, global registration can take up to
 * an hour to propagate. Admin commands normally stay in the target guild.
 * With AI_MULTI_GUILD=true, `/ai` and `/add-admin` are registered globally
 * instead; code-level authorization remains mandatory in every guild.
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes, Collection } = require('discord.js');

const { getConfig, validate } = require('../src/config/env');
const { createLogger } = require('../src/core/logger');
const { shouldRegisterInTargetGuild } = require('../src/discord/command-scope');

const config = getConfig();
const logger = createLogger({ level: config.logLevel, prefix: 'deploy' });

function loadCommands(dir, collection = new Collection()) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      loadCommands(fullPath, collection);
    } else if (file.endsWith('.js')) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const command = require(fullPath);
      if (command.data && command.execute) {
        collection.set(command.data.name, command);
      } else {
        logger.warn(`Skipping ${file}: it has no "data" or "execute".`);
      }
    }
  }
  return collection;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--guild') ? 'guild' : args.includes('--global') ? 'global' : config.commandScope;

  const validation = validate(config);
  if (!config.discordToken) {
    logger.error('DISCORD_TOKEN is not set - cannot register commands.');
    process.exitCode = 1;
    return;
  }
  if (!config.discordClientId) {
    logger.error('DISCORD_CLIENT_ID is not set - cannot register commands.');
    process.exitCode = 1;
    return;
  }

  const commands = loadCommands(path.join(__dirname, '..', 'commands'));
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const guildOnly = [];
  const global = [];
  for (const command of commands.values()) {
    if (force === 'guild') {
      guildOnly.push(command);
    } else if (shouldRegisterInTargetGuild(command, config)) {
      guildOnly.push(command);
    } else {
      global.push(command);
    }
  }

  try {
    if (global.length) {
      logger.info(`Registering ${global.length} command(s) globally...`);
      await rest.put(Routes.applicationCommands(config.discordClientId), {
        body: global.map((command) => command.data.toJSON()),
      });
      logger.info(`Registered ${global.length} global command(s): ${global.map((c) => `/${c.data.name}`).join(', ')}`);
      logger.info('Global commands can take up to an hour to appear in every server.');
    }

    if (guildOnly.length) {
      if (!config.discordGuildId) {
        logger.error(
          'DISCORD_GUILD_ID is not set - the guild-scoped commands (/ai, /ai-status, /ai-audit, /add-admin) were not registered.',
        );
        if (force === 'guild') process.exitCode = 1;
      } else {
        logger.info(`Registering ${guildOnly.length} command(s) in guild ${config.discordGuildId}...`);
        await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), {
          body: guildOnly.map((command) => command.data.toJSON()),
        });
        logger.info(
          `Registered ${guildOnly.length} guild command(s): ${guildOnly.map((c) => `/${c.data.name}`).join(', ')}`,
        );
      }
    }
  } catch (err) {
    logger.error(`Registration failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (validation.warnings.length) {
    for (const warning of validation.warnings) logger.warn(warning);
  }
}

main().catch((err) => {
  logger.error(`Unexpected failure: ${err.message}`);
  process.exitCode = 1;
});
