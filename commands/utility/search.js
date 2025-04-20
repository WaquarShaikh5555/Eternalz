const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web and get a summarized answer!')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Your search question')
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('query');
    const apiKey = process.env.SERPER_API_KEY;

    await interaction.deferReply();

    try {
      const response = await axios.post('https://google.serper.dev/search', {
        q: query,
      }, {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;

      if (!data || !data.organic || data.organic.length === 0) {
        await interaction.editReply('No results found for that query.');
        return;
      }

      const topResult = data.organic[0];

      const embed = new EmbedBuilder()
        .setTitle(topResult.title || 'Search Result')
        .setDescription(topResult.snippet || 'No snippet found.')
        .setURL(topResult.link || null)
        .setColor('Blue')
        .setFooter({ text: 'Powered by Eternalz' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Search error:', error.response?.data || error.message);
      await interaction.editReply('Something went wrong while searching.');
    }
  }
};
