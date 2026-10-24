require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { getConfig, validate, describe } = require('./src/config/env');
const { createLogger } = require('./src/core/logger');
const { initRuntime, attachClient, runtime } = require('./src/runtime');
const { handlePlanButton } = require('./src/admin/service');
const {
  isConversationButton,
  isConversationModal,
  handleConversationButton,
  handleConversationModal,
} = require('./src/admin/interactions');
const { registerEvents } = require('./src/discord/events');
const { shouldRegisterInTargetGuild } = require('./src/discord/command-scope');
const { toError } = require('./src/core/errors');

const config = getConfig();
const logger = createLogger({ level: config.logLevel, prefix: 'eternalz' });

// Optional MongoDB connection - the bot runs fine without it.
if (process.env.MONGO_URI) {
  // eslint-disable-next-line global-require
  const mongoose = require('mongoose');
  mongoose
    .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => logger.info('MongoDB connected!'))
    .catch((err) => logger.warn(`MongoDB error: ${err.message}`));
} else {
  logger.info('MONGO_URI is not set - running without the optional database connection.');
}

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Create a collection for storing commands
client.commands = new Collection();

// Function to recursively read all commands from subfolders
const loadCommands = (dir) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Recursively load commands from subfolders
      loadCommands(fullPath);
    } else if (file.endsWith('.js')) {
      const command = require(fullPath);
      if (command.data && command.execute) {
        client.commands.set(command.data.name, command);
      } else {
        logger.warn(`[WARNING] Command in ${file} missing "data" or "execute".`);
      }
    }
  }
};

// Load commands from the 'commands' folder and subfolders
const commandsPath = path.join(__dirname, 'commands');
loadCommands(commandsPath);

/**
 * Register the slash commands.
 *
 * Ordinary commands keep their historical global registration. Commands that
 * are marked `guildOnly` are registered directly in the configured target
 * guild instead. In explicit multi-guild mode, `/ai` alone opts into global
 * registration; application-level authorisation still gates every request.
 */
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const globalCommands = [];
  const guildCommands = [];
  for (const command of client.commands.values()) {
    if (shouldRegisterInTargetGuild(command, config)) guildCommands.push(command);
    else globalCommands.push(command);
  }

  try {
    logger.info('Started refreshing application (/) commands.');

    if (globalCommands.length) {
      await rest.put(Routes.applicationCommands(config.discordClientId), {
        body: globalCommands.map((command) => command.data.toJSON()),
      });
      logger.info(`Successfully reloaded ${globalCommands.length} global application command(s).`);
    }

    if (guildCommands.length) {
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
        {
          body: guildCommands.map((command) => command.data.toJSON()),
        },
      );
      logger.info(
        `Successfully registered ${guildCommands.length} guild-scoped command(s) in ${config.discordGuildId}.`,
      );
    }
  } catch (error) {
    logger.error(`Could not register the slash commands: ${error.message}`);
  }
}

if (config.registerCommandsOnStart) {
  registerCommands();
}

// Prepare the shared services (storage, audit log, AI provider).
initRuntime({ config })
  .then(() => {
    logger.info('Runtime services ready.', { summary: describe(config) });
  })
  .catch((err) => {
    logger.error(`Could not initialise the runtime services: ${err.message}`);
  });

// When the bot is ready, it will log in the console
client.once('ready', () => {
  logger.info('Bot is online!');
  attachClient(client);
  registerEvents(client, runtime);
});

// Listen for interactions (slash commands, confirmation buttons and follow-ups)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isModalSubmit()) {
    if (!isConversationModal(interaction.customId)) return;
    try {
      await handleConversationModal({
        interaction,
        guild: interaction.guild,
        config: runtime.config,
        storage: runtime.storage,
        audit: runtime.audit,
        logger: logger.child('admin'),
        limiter: runtime.limiter,
        cooldown: runtime.cooldown,
        provider: runtime.provider,
        client,
      });
    } catch (error) {
      const err = toError(error);
      logger.error(`AI follow-up failed: ${err.message}`);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '⚠️ Something went wrong with that follow-up.' });
        } else {
          await interaction.reply({
            content: '⚠️ Something went wrong with that follow-up.',
            ephemeral: true,
          });
        }
      } catch {
        /* the interaction is gone */
      }
    }
    return;
  }

  if (interaction.isButton()) {
    if (isConversationButton(interaction.customId)) {
      try {
        await handleConversationButton(interaction);
      } catch (error) {
        const err = toError(error);
        logger.error(`AI conversation button failed: ${err.message}`);
        try {
          await interaction.reply({
            content: '⚠️ Could not open the follow-up. Please run `/ai` again.',
            ephemeral: true,
          });
        } catch {
          /* the interaction is gone */
        }
      }
      return;
    }

    if (!String(interaction.customId).startsWith('ai_admin:')) return;
    try {
      await handlePlanButton({
        interaction,
        guild: interaction.guild,
        config: runtime.config,
        storage: runtime.storage,
        audit: runtime.audit,
        logger: logger.child('admin'),
        client,
      });
    } catch (error) {
      const err = toError(error);
      logger.error(`AI confirmation button failed: ${err.message}`);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '⚠️ Something went wrong while applying that plan.' });
        } else {
          await interaction.reply({
            content: '⚠️ Something went wrong while applying that plan.',
            ephemeral: true,
          });
        }
      } catch {
        /* the interaction is gone */
      }
    }
    return;
  }

  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    const err = toError(error);
    logger.error(err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'There was an error while executing this command!' });
      } else {
        await interaction.reply({
          content: 'There was an error while executing this command!',
          ephemeral: true,
        });
      }
    } catch {
      /* the interaction is gone */
    }
  }
});

// Log in to Discord using the bot token from the .env file.
// A failed login must produce a clear log line instead of an unhandled
// rejection that kills the process.
client.login(config.discordToken).catch((err) => {
  logger.error(`Could not log in to Discord: ${err.message}`);
  logger.error('Check DISCORD_TOKEN, and whether Discord is reachable from this host.');
  setTimeout(() => process.exit(1), 10_000).unref();
});

// Keep the process alive but do not let a stray rejection silently kill it.
process.on('unhandledRejection', (reason) => {
  logger.error(
    `Unhandled promise rejection: ${reason?.message || String(reason)}`,
  );
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  if (err.stack) logger.error(err.stack);
  process.exit(1);
});

// Close the database cleanly so nothing is lost on a restart.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal} - shutting down.`);
  try {
    await require('./src/runtime').shutdownRuntime();
  } catch {
    /* ignore */
  }
  try {
    await client.destroy();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the web server (to keep the bot alive)
require('./webserver');
