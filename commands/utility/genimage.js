const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('genimage')
    .setDescription('Generate a high-quality image from a prompt')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('What image do you want to generate?')
        .setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    await interaction.deferReply();

    try {
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
      });

      const imageUrl = response.data[0].url;

      const embed = new EmbedBuilder()
        .setTitle('Image Generated')
        .setDescription(`Prompt: **${prompt}**`)
        .setImage(imageUrl)
        .setColor('Green')
        .setFooter({ text: 'Powered By Eternalz' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Image generation error:', error);
      await interaction.editReply('There was an error generating the image. Try a different prompt.');
    }
  },
};
