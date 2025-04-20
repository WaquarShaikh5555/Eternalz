const { SlashCommandBuilder } = require('discord.js');
const { MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rps')
    .setDescription('Play Rock Paper Scissors')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('Choose the game mode')
        .setRequired(true)
        .addChoices(
          { name: 'Player vs Player', value: 'player' },
          { name: 'Player vs Bot', value: 'bot' },
        )),

  async execute(interaction) {
    const mode = interaction.options.getString('mode');
    const player = interaction.user;
    
    let opponent = null;
    if (mode === 'player') {
      // Player vs Player mode, get the mentioned user
      opponent = interaction.options.getUser('opponent');
      if (!opponent) {
        await interaction.reply({
          content: 'Please mention the opponent to start the game!',
          ephemeral: true,
        });
        return;
      }
    }

    // Create the buttons for rock, paper, scissors
    const buttons = new MessageActionRow()
      .addComponents(
        new MessageButton()
          .setCustomId('rock')
          .setLabel('Rock')
          .setStyle('PRIMARY'),
        new MessageButton()
          .setCustomId('paper')
          .setLabel('Paper')
          .setStyle('PRIMARY'),
        new MessageButton()
          .setCustomId('scissors')
          .setLabel('Scissors')
          .setStyle('PRIMARY'),
      );

    // Send initial message with the buttons
    const msg = await interaction.reply({
      content: mode === 'bot' ? 'You are playing against the bot!' : `${opponent.tag} has been invited to play!`,
      components: [buttons],
      fetchReply: true,
    });

    // Start the timeout for user action
    const filter = (interaction) => interaction.user.id === player.id || interaction.user.id === opponent?.id;
    const collector = msg.createMessageComponentCollector({ filter, time: 15000 });

    let playerChoice = null;
    let opponentChoice = null;

    collector.on('collect', async (buttonInteraction) => {
      const userChoice = buttonInteraction.customId;

      // If it's the player's turn to choose
      if (buttonInteraction.user.id === player.id) {
        playerChoice = userChoice;
        await buttonInteraction.update({
          content: `You selected ${userChoice}. Waiting for ${opponent.tag}'s choice...`,
          components: [],
        });
      }

      // If it's the opponent's turn to choose
      if (buttonInteraction.user.id === opponent?.id) {
        opponentChoice = userChoice;
        await buttonInteraction.update({
          content: `${opponent.tag} selected ${userChoice}.`,
          components: [],
        });
      }

      // If both players have made their choice
      if (playerChoice && opponentChoice) {
        collector.stop();
        determineWinner(playerChoice, opponentChoice);
      }
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        interaction.editReply({ content: 'Game timed out! Please try again later.', components: [] });
      }
    });

    function determineWinner(playerChoice, opponentChoice) {
      let result = '';
      if (playerChoice === opponentChoice) {
        result = 'It\'s a tie!';
      } else if (
        (playerChoice === 'rock' && opponentChoice === 'scissors') ||
        (playerChoice === 'paper' && opponentChoice === 'rock') ||
        (playerChoice === 'scissors' && opponentChoice === 'paper')
      ) {
        result = 'You win!';
      } else {
        result = `${opponent.tag} wins!`;
      }

      const embed = new MessageEmbed()
        .setColor(0x0099ff)
        .setTitle('Rock Paper Scissors Result')
        .addFields(
          { name: 'Your Choice', value: playerChoice, inline: true },
          { name: 'Opponent\'s Choice', value: opponentChoice, inline: true },
          { name: 'Result', value: result },
        )
        .setFooter('Powered by Eternalz');

      interaction.editReply({ embeds: [embed], components: [] });
    }
  },
};
