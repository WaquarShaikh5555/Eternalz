'use strict';

/**
 * /ai-audit - shows the recent AI administration audit trail.
 */

const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');

const { runtime } = require('../../src/runtime');
const { isGuildAdmin } = require('../../src/admin/authorization');

module.exports = {
  guildOnly: true,

  data: new SlashCommandBuilder()
    .setName('ai-audit')
    .setDescription('Show the recent AI administration activity log')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('How many entries to show (1-25)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false),
    ),

  async execute(interaction) {
    const guild = interaction.guild;

    if (!isGuildAdmin(runtime.config, guild, interaction.user.id, interaction.member)) {
      await interaction.reply({
        content: '🔒 Only the server owner and configured administrators can read the audit log.',
        ephemeral: true,
      });
      return;
    }

    const limit = interaction.options.getInteger('limit') || 10;
    const entries = await runtime.storage.listAudit(guild.id, limit);

    if (!entries.length) {
      await interaction.reply({
        content: 'No AI administration activity has been recorded yet.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('AI administration audit log')
      .setColor(0x5865f2)
      .setTimestamp();

    for (const entry of entries) {
      const who = entry.requesterId ? `<@${entry.requesterId}>` : 'unknown';
      const when = `<t:${Math.floor(entry.createdAt / 1000)}:R>`;
      const detail = summarise(entry);
      embed.addFields({
        name: `${entry.event} — ${who}`,
        value: `${when}\n${detail}`.slice(0, 1000),
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

function summarise(entry) {
  const summary = entry.summary;
  if (!summary) return 'No details.';
  if (typeof summary === 'string') return summary.slice(0, 400);
  if (summary.reason) return `Reason: ${summary.reason}`;
  if (summary.summary) {
    const parts = [summary.summary];
    if (summary.failed?.length) {
      parts.push(
        `Failures: ${summary.failed.map((f) => `${f.tool} (${f.error})`).join('; ')}`.slice(0, 400),
      );
    }
    if (summary.risk) parts.push(`Risk: ${summary.risk}`);
    if (summary.actions?.length) {
      parts.push(`Actions: ${summary.actions.map((a) => a.tool).join(', ')}`.slice(0, 400));
    }
    return parts.join('\n');
  }
  return JSON.stringify(summary).slice(0, 400);
}
