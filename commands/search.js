const axios = require('axios');
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the web and get concise results')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Enter the search query')
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString('query');
    const searchUrl = `https://api.duckduckgo.com/?q=${query}&format=json`;

    try {
      const response = await axios.get(searchUrl);
      const result = response.data;

      if (!result.AbstractText && !result.RelatedTopics.length) {
        return interaction.reply('Sorry, no results found!');
      }

      let resultText = `Here are the search results for "${query}":\n\n`;

      // Display the abstract text if available
      if (result.AbstractText) {
        resultText += `*${result.AbstractText}*\n\n`;
      }

      // List the related topics (if any)
      resultText += result.RelatedTopics.slice(0, 3).map((topic, index) => {
        return `${index + 1}. [${topic.Text}](${topic.FirstURL})`;
      }).join('\n');

      return interaction.reply(resultText);
    } catch (error) {
      console.error(error);
      return interaction.reply('Sorry, there was an error with the search!');
    }
  },
};
