const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('meme')
    .setDescription('Generate a random meme'),

  async execute(interaction) {
    try {
      // Use Dank Meme API to get a random meme
      const response = await axios.get('https://api.imgflip.com/get_memes');

      const memes = response.data.data.memes;
      const randomMeme = memes[Math.floor(Math.random() * memes.length)];

      // Extract meme image URL and name
      const memeUrl = randomMeme.url;
      const memeName = randomMeme.name;

      // Send the meme URL in the Discord channel
      await interaction.reply(`Here's a random meme: ${memeName} \n${memeUrl}`);
    } catch (error) {
      console.error('Error generating meme:', error);
      await interaction.reply('Failed to generate meme. Please try again later.');
    }
  },
};

