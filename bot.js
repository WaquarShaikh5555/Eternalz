require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.log('MongoDB error:', err));

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
        console.log(`[WARNING] Command in ${file} missing "data" or "execute".`);
      }
    }
  }
};

// Load commands from the 'commands' folder and subfolders
const commandsPath = path.join(__dirname, 'commands');
loadCommands(commandsPath);

// Register commands with the Discord API
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // Register slash commands globally (no guildId required)
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: client.commands.map(command => command.data.toJSON()),
    });

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

// When the bot is ready, it will log in the console
client.once('ready', () => {
  console.log('Bot is online!');
});

// Listen for interactions (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
  }
});

// Log in to Discord using the bot token from the .env file
client.login(process.env.BOT_TOKEN);

// Start the web server (to keep the bot alive)
require('./webserver');
