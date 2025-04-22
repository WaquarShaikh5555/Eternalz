const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Creates a poll with options and a time limit')
    .addStringOption(option =>
      option.setName('text')
        .setDescription('The question for the poll')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('time')
        .setDescription('The time duration for the poll (e.g., 1h, 2d)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('button1')
        .setDescription('Text for the first button')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('button2')
        .setDescription('Text for the second button')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('image')
        .setDescription('Optional image for the poll')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('button3')
        .setDescription('Text for the third button (optional)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('button4')
        .setDescription('Text for the fourth button (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const text = interaction.options.getString('text');
      const time = interaction.options.getString('time');
      const image = interaction.options.getString('image');
      const button1Text = interaction.options.getString('button1');
      const button2Text = interaction.options.getString('button2');
      const button3Text = interaction.options.getString('button3') || null;
      const button4Text = interaction.options.getString('button4') || null;

      const timeInMs = ms(time);
      if (!timeInMs) {
        return interaction.editReply('Invalid time format! Use `1h`, `2d`, `30m` etc.');
      }

      const embed = new EmbedBuilder()
        .setTitle('Poll')
        .setDescription(text)
        .setColor('#00FF00')
        .setTimestamp();

      if (image && image.startsWith('http')) {
        embed.setImage(image);
      }

      const row = new ActionRowBuilder();
      const buttons = [
        new ButtonBuilder().setCustomId('button1').setLabel(button1Text).setStyle('Primary'),
        new ButtonBuilder().setCustomId('button2').setLabel(button2Text).setStyle('Primary')
      ];
      if (button3Text) {
        buttons.push(new ButtonBuilder().setCustomId('button3').setLabel(button3Text).setStyle('Secondary'));
      }
      if (button4Text) {
        buttons.push(new ButtonBuilder().setCustomId('button4').setLabel(button4Text).setStyle('Secondary'));
      }
      row.addComponents(buttons);

      await interaction.editReply({ embeds: [embed], components: [row] });

      const votes = { button1: 0, button2: 0, button3: 0, button4: 0 };
      const votedUsers = new Set();

      const filter = (btn) => buttons.map(b => b.data.custom_id).includes(btn.customId);
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: timeInMs });

      collector.on('collect', async (btn) => {
        if (votedUsers.has(btn.user.id)) {
          await btn.reply({ content: 'You have already voted!', ephemeral: true });
        } else {
          votedUsers.add(btn.user.id);
          votes[btn.customId]++;
          await btn.deferUpdate();
        }
      });

      collector.on('end', async () => {
        const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0) || 1;

        const resultEmbed = new EmbedBuilder()
          .setTitle('Poll Results')
          .setDescription(`Poll: ${text}\nTotal Votes: **${totalVotes - 1 ? totalVotes : 0}**`)
          .setColor('#FF0000');

        const formatResult = (label, count) => {
          const percent = Math.round((count / totalVotes) * 100);
          return `Votes: ${count} (${percent}%)`;
        };

        resultEmbed.addFields(
          { name: button1Text, value: formatResult(button1Text, votes.button1), inline: true },
          { name: button2Text, value: formatResult(button2Text, votes.button2), inline: true }
        );
        if (button3Text) {
          resultEmbed.addFields({ name: button3Text, value: formatResult(button3Text, votes.button3), inline: true });
        }
        if (button4Text) {
          resultEmbed.addFields({ name: button4Text, value: formatResult(button4Text, votes.button4), inline: true });
        }

        await interaction.followUp({ embeds: [resultEmbed] });
      });
    } catch (err) {
      console.error('Error executing poll command:', err);
      await interaction.editReply('There was an error while executing this command!');
    }
  }
};

function ms(time) {
  const match = time.match(/^(\d+)([smhd])$/);
  if (!match) return null;

  const amount = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return amount * 1000;
    case 'm': return amount * 60000;
    case 'h': return amount * 3600000;
    case 'd': return amount * 86400000;
    default: return null;
  }
}
