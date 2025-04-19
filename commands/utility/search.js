const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Ask anything and get a ChatGPT-style answer')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Your question or search query')
        .setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
      const response = await openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      });

      const answer = response.data.choices[0].message.content;

      const embed = new EmbedBuilder()
        .setTitle('Search Result')
        .setDescription(`**Prompt:** ${prompt}\n\n${answer}`)
        .setColor(0x00ff00) // Green color
        .setFooter({ text: 'Powered by Eternalz' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('OpenAI API error:', error);
      await interaction.editReply({
        content: 'Something went wrong while fetching the answer. Try again later.',
      });
    }
  }
};
