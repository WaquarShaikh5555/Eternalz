const { SlashCommandBuilder } = require('discord.js');
const googleTTS = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

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

    const url = googleTTS.getAudioUrl(text, {
      lang: voice,
      slow: false,
      host: 'https://translate.google.com',
    });

    // Path to save audio or video file
    const audioPath = path.join(__dirname, `./audio/tts_output.mp3`);

    // Download audio file from Google TTS
    const response = await fetch(url);
    const buffer = await response.buffer();
    fs.writeFileSync(audioPath, buffer);

    // Now, generate a video with FFmpeg
    const videoPath = path.join(__dirname, `./video/tts_output.mp4`);

    ffmpeg()
      .input(audioPath)
      .inputOption('-f lavfi')
      .input('color=c=black:s=1280x720:r=25') // Blank background video with black color
      .outputOption('-pix_fmt yuv420p')
      .outputOption('-shortest')
      .output(videoPath)
      .on('end', () => {
        // Send video to Discord
        interaction.reply({ content: 'Here is your TTS video!', files: [videoPath] });

        // Clean up
        fs.unlinkSync(audioPath);
        fs.unlinkSync(videoPath);
      })
      .run();
  }
};
