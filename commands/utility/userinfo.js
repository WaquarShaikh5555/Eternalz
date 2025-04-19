const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const moment = require('moment');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Shows detailed information about a user')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('Select a user')
        .setRequired(false)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('target') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id);

    const username = `${user.tag}`;
    const nickname = member.nickname || 'None';
    const id = user.id;
    const isBot = user.bot ? 'Yes' : 'No';

    const createdAt = moment(user.createdAt).format('MMM DD, YYYY');
    const joinedAt = moment(member.joinedAt).format('MMM DD, YYYY');

    const status = member.presence?.status || 'Offline';
    const activity = member.presence?.activities[0]?.name || 'None';

    const roles = member.roles.cache
      .filter(role => role.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(role => role.toString());

    const topRole = member.roles.highest.toString();

    const embed = new EmbedBuilder()
      .setTitle(`User Info – ${username}`)
      .setColor('#800043') // Royal crimson (purple + red)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `Username: ${username}\n` +
        `Nickname: ${nickname}\n` +
        `ID: ${id}\n` +
        `Bot: ${isBot}\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `Account Created: ${createdAt}\n` +
        `Joined Server: ${joinedAt}\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `Status: ${status}\n` +
        `Activity: ${activity}\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
        `Roles [${roles.length}]:\n${roles.join(' • ') || 'None'}\n` +
        `Top Role: ${topRole}\n` +
        `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
