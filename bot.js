kkrequire('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// Command collection
client.commands = new Collection();

// Read all command files in the 'commands' folder
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(`[WARNING] Command in ${file} missing "data" or "execute".`);
  }
}

// Register slash commands with Discord API
client.once('ready', () => {
  console.log('Bot is online!');
});

// Login using token from .env file
client.login(process.env.BOT_TOKEN);

require('./webserver'); // Optional: If you have a web server file to run
