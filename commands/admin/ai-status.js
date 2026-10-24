'use strict';

/**
 * /ai-status - shows whether AI administration is configured and working.
 *
 * Never prints secrets: it only reports whether a key is present.
 */

const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');

const { runtime, configSummary } = require('../../src/runtime');

module.exports = {
  guildOnly: true,

  data: new SlashCommandBuilder()
    .setName('ai-status')
    .setDescription('Show the status of the AI administration setup')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const summary = configSummary();
    const guild = interaction.guild;

    const embed = new EmbedBuilder()
      .setTitle('AI administration status')
      .setColor(summary.ai.enabled && summary.ai.apiKeyConfigured ? 0x2ecc71 : 0xe67e22)
      .setTimestamp();

    embed.addFields(
      {
        name: 'Provider',
        value: summary.ai.provider
          ? `\`${summary.ai.provider}\`\nmodel: \`${summary.ai.model}\`\nbase URL: \`${summary.ai.baseUrl}\``
          : 'not configured',
        inline: true,
      },
      {
        name: 'API key',
        value: summary.ai.apiKeyConfigured ? '✅ configured' : '❌ not set (AI_API_KEY)',
        inline: true,
      },
      {
        name: 'Write operations',
        value: summary.ai.writesEnabled ? '✅ enabled' : '⛔ disabled (AI_WRITE_ENABLED=false)',
        inline: true,
      },
      {
        name: 'Administrator access',
        value: [
          `guild owner: ${guild?.ownerId ? `<@${guild.ownerId}>` : 'unknown'}`,
          `configured admins: ${summary.ai.adminUserCount}`,
          `scope: ${summary.ai.multiGuild ? 'multi-guild for configured/granted admins' : 'primary server only'}`,
          'per-guild grants: managed with `/add-admin`',
          summary.ai.adminRoleCount ? `configured admin roles: ${summary.ai.adminRoleCount}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      },
      {
        name: 'Target server',
        value: summary.discord.guildId
          ? `<#${summary.discord.guildId}>\n(${
              guild && guild.id === summary.discord.guildId ? 'this server ✅' : 'a different server ❌'
            })`
          : '⚠️ DISCORD_GUILD_ID is not set',
        inline: true,
      },
      {
        name: 'Audit log',
        value: summary.ai.auditChannelConfigured ? '✅ a private audit channel is configured' : 'not configured (database only)',
        inline: true,
      },
      {
        name: 'Storage',
        value: `driver: \`${summary.storage.driver}\`\ndata directory: \`${summary.storage.dataDir}\``,
        inline: true,
      },
    );

    if (!summary.ai.apiKeyConfigured) {
      embed.addFields({
        name: 'How to fix',
        value:
          'The server owner must set `AI_API_KEY` (plus `AI_PROVIDER` and `AI_MODEL`) in the host\'s environment variables and restart the bot. All other bot features keep working without it.',
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
