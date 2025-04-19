const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Searches your question like ChatGPT and gives a paragraph.')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Your question')
        .setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }]
      });

      const response = completion.choices[0].message.content;

      const embed = new EmbedBuilder()
        .setTitle('Search Result')
        .setDescription(response)
        .setColor('Green')
        .setFooter({ text: 'Powered by Eternalz' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Search error:', error);
      await interaction.editReply('There was an error while processing your request.');
    }
  }
};
