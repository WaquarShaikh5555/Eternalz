require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log('Bot is online!');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args[0].toLowerCase();

  // /hack command
  if (command === '/hack') {
    const target = message.mentions.users.first();
    if (!target) return message.channel.send('Tag someone to hack, bro!');

    const hackMsg = await message.channel.send(`Hacking ${target.username}...`);

    setTimeout(() => hackMsg.edit('Getting IP address...'), 1000);
    setTimeout(() => hackMsg.edit('IP Found: 192.168.0.1'), 2000);
    setTimeout(() => hackMsg.edit('Accessing DMs...'), 3000);
    setTimeout(() => hackMsg.edit('Leaking embarrassing photos...'), 4000);
    setTimeout(() => hackMsg.edit(`Hack complete. ${target.username} has been owned!`), 5000);
  }

  // /joke command
  else if (command === '/joke') {
    const response = await fetch('https://official-joke-api.appspot.com/random_joke');
    const data = await response.json();
    message.channel.send(`${data.setup}\n||${data.punchline}||`);
  }

  // /meme command
  else if (command === '/meme') {
    const res = await fetch('https://meme-api.com/gimme');
    const data = await res.json();
    message.channel.send({ content: data.title, files: [data.url] });
  }

  // /say command
  else if (command === '/say') {
    const text = args.slice(1).join(' ');
    if (!text) return message.channel.send('Say what, bro?');
    message.channel.send(text);
  }

  // /8ball command
  else if (command === '/8ball') {
    const replies = [
      'Yes.',
      'No.',
      'Maybe.',
      'Definitely!',
      'Ask again later.',
      'I don’t think so.',
      '100% true bro!',
      'Cap.'
    ];
    const random = replies[Math.floor(Math.random() * replies.length)];
    message.channel.send(random);
  }
});

// Use token from .env file
client.login(process.env.BOT_TOKEN);