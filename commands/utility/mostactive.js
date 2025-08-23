const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mostactive")
    .setDescription("Find the most active member in a channel or the whole server")
    .addStringOption(option =>
      option.setName("time")
        .setDescription("Time range")
        .setRequired(true)
        .addChoices(
          { name: "1 day", value: "1d" },
          { name: "1 week", value: "1w" },
          { name: "1 month", value: "1m" }
        )
    )
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Select a specific channel (optional)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const time = interaction.options.getString("time");
    const channel = interaction.options.getChannel("channel");

    let days = time === "1d" ? 1 : time === "1w" ? 7 : 30;
    let cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    await interaction.deferReply();

    let channelsToCheck = channel ? [channel] : interaction.guild.channels.cache.filter(c => c.isTextBased() && c.viewable);

    let messageCounts = new Map();

    for (const ch of channelsToCheck.values()) {
      let lastId;
      while (true) {
        const messages = await ch.messages.fetch({ limit: 100, before: lastId });
        if (messages.size === 0) break;

        for (const msg of messages.values()) {
          if (msg.createdTimestamp < cutoff) break;
          messageCounts.set(msg.author.id, (messageCounts.get(msg.author.id) || 0) + 1);
        }

        lastId = messages.last().id;
        if (messages.size < 100) break;
      }
    }

    if (messageCounts.size === 0) {
      return interaction.editReply("No messages found in that time period.");
    }

    let topUserId = [...messageCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    let topUser = await interaction.guild.members.fetch(topUserId);

    await interaction.editReply(`📊 Most active: **${topUser.user.tag}** with **${messageCounts.get(topUserId)}** messages.`);
  }
};
