'use strict';

/**
 * /ai - manage the server with a plain-language request.
 *
 * The request is interpreted by the configured AI provider, turned into a
 * validated plan and then executed through the official Discord API.
 *
 * Only the server owner and explicitly configured administrators may use this
 * command in the primary guild. Optional multi-guild mode additionally allows
 * configured user ids where they own or administer the current server. All
 * checks happen in application code before the AI provider is contacted.
 */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');

const { runtime } = require('../../src/runtime');
const { handleAdminRequest, extractPrompt } = require('../../src/admin/service');
const { renderAdminResult, renderAdminError } = require('../../src/admin/interactions');
const { toError } = require('../../src/core/errors');

module.exports = {
  // Guild-scoped by default; globally registered only in explicit multi-guild mode.
  guildOnly: true,
  multiGuild: true,
  requiresAi: true,

  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Manage this server with a plain-language request')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription(
          'What should change? You can be specific or say "improve the overall look of the server"',
        )
        .setRequired(true)
        .setMaxLength(2000),
    )
    .addBooleanOption((option) =>
      option
        .setName('dry_run')
        .setDescription('Show the plan without applying any change')
        .setRequired(false),
    ),

  async execute(interaction) {
    const { logger } = runtime;

    try {
      await interaction.deferReply();
    } catch {
      // The interaction may already be acknowledged by another handler.
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({
        content: 'This command can only be used inside a server.',
      });
      return;
    }

    const prompt = extractPrompt(interaction);

    try {
      const result = await handleAdminRequest({
        interaction,
        guild,
        config: runtime.config,
        storage: runtime.storage,
        audit: runtime.audit,
        logger,
        limiter: runtime.limiter,
        cooldown: runtime.cooldown,
        provider: runtime.provider,
        client: interaction.client,
        onProgress: async (text) => {
          await interaction.editReply({ content: text, embeds: [], components: [] }).catch(() => {});
        },
      });

      await renderAdminResult(interaction, result, { prompt });
    } catch (err) {
      const error = toError(err);
      logger?.warn?.('ai: request failed', {
        userId: interaction.user.id,
        guildId: guild.id,
        reason: error.message,
      });
      await renderAdminError(interaction, error);
    }
  },
};
