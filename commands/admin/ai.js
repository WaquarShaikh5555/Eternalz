'use strict';

/**
 * /ai - manage the server with a plain-language request.
 *
 * The request is interpreted by the configured AI provider, turned into a
 * validated plan and then executed through the official Discord API.
 *
 * Only the server owner and explicitly configured administrators may use this
 * command, and only in the configured target guild. Both checks happen in
 * application code, before the AI provider is contacted.
 */

const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');

const { runtime } = require('../../src/runtime');
const { handleAdminRequest } = require('../../src/admin/service');
const { buildPlanEmbed, buildButtons } = require('../../src/admin/confirmation');
const { AuthorizationError, AiProviderError, AiQuotaError, toError } = require('../../src/core/errors');

module.exports = {
  // Registered only in the configured target guild (see config/deploy-commands.js).
  guildOnly: true,
  requiresAi: true,

  data: new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Manage this server with a plain-language request')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription(
          'What should change? e.g. "Create a category called Support with a text channel named tickets"',
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
      });

      await renderResult(interaction, result);
    } catch (err) {
      const error = toError(err);
      logger?.warn?.('ai: request failed', {
        userId: interaction.user.id,
        guildId: guild.id,
        reason: error.message,
      });

      if (error instanceof AuthorizationError) {
        await interaction.editReply({ content: `🔒 ${error.message}` });
        return;
      }
      if (error instanceof AiQuotaError) {
        await interaction.editReply({
          content:
            `⏳ ${error.message}\nThe AI provider is temporarily out of quota. Everything else in the bot still works.`,
        });
        return;
      }
      if (error instanceof AiProviderError) {
        await interaction.editReply({
          content: `⚠️ The AI provider could not be used: ${error.message.slice(0, 400)}`,
        });
        return;
      }

      await interaction.editReply({
        content: `⚠️ Something went wrong: ${error.message.slice(0, 400)}`,
      });
    }
  },
};

/** Render the outcome of a request. */
async function renderResult(interaction, result) {
  switch (result.kind) {
    case 'executed': {
      const { buildResultEmbed } = require('../../src/admin/service');
      const embed = buildResultEmbed(result.report);
      if (result.notes) {
        embed.addFields({ name: 'Notes', value: String(result.notes).slice(0, 1000), inline: false });
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    case 'awaiting_confirmation': {
      const embed = buildPlanEmbed(result.plan);
      await interaction.editReply({
        embeds: [embed],
        components: [buildButtons(result.plan)],
      });
      return;
    }

    case 'dry_run': {
      const embed = buildPlanEmbed(result.plan)
        .setTitle('Plan preview (nothing was changed)')
        .setColor(0x3498db);
      const rejected = result.rejected?.length
        ? `\n\nRejected steps: ${result.rejected.map((r) => `${r.tool} (${r.reason})`).join('; ')}`
        : '';
      embed.addFields({
        name: 'Dry run',
        value: 'Nothing was applied. Re-run without the dry-run option to execute this plan.',
      });
      if (rejected) embed.addFields({ name: 'Rejected steps', value: rejected.slice(0, 1000) });
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    case 'no_action': {
      const embed = new EmbedBuilder()
        .setTitle('Nothing to change')
        .setColor(0x95a5a6)
        .setDescription(String(result.notes || 'I did not find anything to change.').slice(0, 2000));
      if (result.rejected?.length) {
        embed.addFields({
          name: 'Rejected steps',
          value: result.rejected.map((r) => `${r.tool} — ${r.reason}`).join('\n').slice(0, 1000),
        });
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    default:
      await interaction.editReply({ content: 'The request was not completed.' });
  }
}
