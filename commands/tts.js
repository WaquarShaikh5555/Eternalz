const { SlashCommandBuilder } = require('discord.js');
const googleTTS = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream'); // For streaming the generated audio

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Generates a TTS audio or video with the given text')
    .addStringOption(option =>
      option.setName('text')
        .setDescription('The text to convert to speech')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('language')
        .setDescription('The language of the text (en for English, hi for Hindi)')
        .setRequired(true)
        .addChoices(
          { name: 'English', value: 'en' },
          { name: 'Hindi', value: 'hi' }
        )
    ),
  
  async execute(interaction) {
    const text = interaction.options.getString('text');
    const language = interaction.options.getString('language');
    const voice = language === 'hi' ? 'hi' : 'en'; // Default to English if not Hindi

    // Get the audio URL from Google TTS
    const url = googleTTS.getAudioUrl(text, {
      lang: voice,
      slow: false,
      host: 'https://translate.google.com',
    });

    // Download audio using fetch
    const response = await fetch(url);
    const buffer = await response.buffer();
    const audioStream = Readable.from(buffer); // Convert the buffer to a stream

    // Generate a video with a blank background and the audio stream
    const videoStream = ffmpeg()
      .input(audioStream)
      .inputOption('-f lavfi')
      .input('color=c=black:s=1280x720:r=25') // Blank background video with black color
      .outputOption('-pix_fmt yuv420p')
      .outputOption('-shortest')
      .format('mp4')
      .pipe();

    // Send the video directly to Discord
    interaction.reply({
      content: 'Here is your TTS video!',
      files: [{
        attachment: videoStream,
        name: 'tts_output.mp4',
      }],
    });
  },
};
