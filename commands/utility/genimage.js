const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('genimage')
    .setDescription('Generate AI images from a prompt')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('What do you want to see?')
        .setRequired(true)
    ),

  async execute(interaction) {
    const prompt = interaction.options.getString('prompt');

    await interaction.reply('Designing something fire... please wait');

    try {
      const response = await openai.createImage({
        prompt: prompt,
        n: 2, // number of images
        size: '1024x1024',
        response_format: 'url',
      });

      const embeds = response.data.data.map((img, index) => {
        return new EmbedBuilder()
          .setTitle(`Image ${index + 1}`)
          .setDescription(`**Prompt:** ${prompt}`)
          .setImage(img.url)
          .setColor(0x00ff00)
          .setFooter({ text: 'Powered by Eternalz' });
      });

      await interaction.editReply({ content: '', embeds });

    } catch (err) {
      console.error('OpenAI Image error:', err);
      await interaction.editReply('Something went wrong while generating your image.');
    }
  }
};
