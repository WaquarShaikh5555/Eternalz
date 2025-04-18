
const { SlashCommandBuilder } = require('discord.js');
const googleTTS = require('google-tts-api'); // Make sure you've installed this package

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tts')
        .setDescription('Convert text to speech in selected language')
        .addStringOption(option => 
            option.setName('language')
                .setDescription('Select language: en for English, hi for Hindi')
                .setRequired(true)
                .addChoices(
                    { name: 'English (en)', value: 'en' },
                    { name: 'Hindi (hi)', value: 'hi' }
                ))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Enter the text to be converted to speech')
                .setRequired(true)),

    async execute(interaction) {
        const language = interaction.options.getString('language');
        const text = interaction.options.getString('text');
        
        try {
            const url = googleTTS.getAudioUrl(text, {
                lang: language,
                slow: false,
                host: 'https://translate.google.com',
            });

            await interaction.reply({
                content: `Here is your text-to-speech output in ${language === 'en' ? 'English' : 'Hindi'}`,
                files: [{
                    attachment: url,
                    name: 'tts.mp3'
                }]
            });
        } catch (error) {
            console.error(error);
            await interaction.reply('Sorry, there was an error with the text-to-speech service.');
        }
    },
};
