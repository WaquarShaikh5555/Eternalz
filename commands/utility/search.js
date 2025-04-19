const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web and return a summary')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('The search query')
        .setRequired(true)),

  async execute(interaction) {
    const query = interaction.options.getString('query');
    const user = interaction.user.username;

    try {
      // Request search results from DuckDuckGo
      const response = await axios.get('https://duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      // Extract the first paragraph or snippet from the search result page
      const result = response.data.match(/<a href="\/l\/\?kh=-1&uddg=(.*?)" class="result__url">(.*?)<\/a>/);

      if (!result) {
        await interaction.reply({
          content: 'No results found for your query!',
          ephemeral: true,
        });
        return;
      }

      // Summarize the first result
      const summary = result[2];  // The second capturing group is the snippet or page title

      // Prepare the embed message
      const embed = {
        color: 0x0099ff,
        title: `Search Result for "${query}"`,
        description: summary,
        fields: [
          {
            name: 'Requested By',
            value: `${user}`,
            inline: true,
          },
        ],
        footer: {
          text: 'Powered by Eternalz',
        },
      };

      // Send the response
      await interaction.reply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'There was an error processing your request. Please try again later.',
        ephemeral: true,
      });
    }
  },
};
