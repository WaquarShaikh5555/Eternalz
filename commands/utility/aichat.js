const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('aichat')
    .setDescription('Ask anything from the AI!')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Your question')
        .setRequired(true)
    ),
  async execute(interaction) {
    const input = interaction.options.getString('question');

    try {
      await interaction.deferReply();

      const response = await axios.post(
        'https://api-inference.huggingface.co/models/google/flan-t5-large',
        {
          inputs: input,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.HUG_TOKEN}`,
          },
        }
      );

      const output = response.data?.generated_text || "Sorry, couldn't get a proper answer.";

      const embed = new EmbedBuilder()
        .setTitle("AI Chat Response")
        .setDescription(output)
        .setColor('Random');

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error in /aichat:', error?.response?.data || error.message);
      await interaction.editReply("There was an error getting the AI response.");
    }
  },
};
