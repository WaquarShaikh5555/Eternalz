'use strict';

/**
 * Discord interaction rendering and follow-up conversations.
 *
 * Confirmations use buttons. Clarifications use a modal, so the administrator
 * can answer the AI without typing `/ai` again and without requiring the
 * privileged Message Content intent.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { handleAdminRequest, buildResultEmbed } = require('./service');
const { buildPlanEmbed, buildButtons } = require('./confirmation');
const {
  createConversation,
  getConversation,
  updateConversation,
  deleteConversation,
  canUseConversation,
} = require('./conversation');
const { AuthorizationError, AiProviderError, AiQuotaError, toError } = require('../core/errors');

const REFINE_BUTTON = 'ai_admin:refine';
const DISMISS_BUTTON = 'ai_admin:dismiss';
const REFINE_MODAL = 'ai_admin:refine_modal';

function idPart(customId, prefix) {
  const value = String(customId || '');
  const start = `${prefix}:`;
  return value.startsWith(start) ? value.slice(start.length) : null;
}

function isConversationButton(customId) {
  return idPart(customId, REFINE_BUTTON) !== null || idPart(customId, DISMISS_BUTTON) !== null;
}

function isConversationModal(customId) {
  return idPart(customId, REFINE_MODAL) !== null;
}

function buildConversationRow(sessionId, label = 'Answer / refine') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${REFINE_BUTTON}:${sessionId}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${DISMISS_BUTTON}:${sessionId}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildRefineModal(session) {
  return new ModalBuilder()
    .setCustomId(`${REFINE_MODAL}:${session.id}`)
    .setTitle('Refine your request')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('answer')
          .setLabel('What should the AI do?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setPlaceholder('Example: make it minimal and dark blue, and rename the channels'),
      ),
    );
}

async function editOrReply(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

/** Render an error without exposing secrets or provider internals. */
async function renderAdminError(interaction, rawError) {
  const error = toError(rawError);
  let content;
  if (error instanceof AuthorizationError) {
    content = `🔒 ${error.message}`;
  } else if (error instanceof AiQuotaError) {
    content = `⏳ ${error.message}\nThe AI provider is temporarily out of quota. Everything else in the bot still works.`;
  } else if (error instanceof AiProviderError) {
    content = `⚠️ The AI provider could not be used: ${error.message.slice(0, 400)}`;
  } else {
    content = `⚠️ Something went wrong: ${error.message.slice(0, 400)}`;
  }

  await editOrReply(interaction, { content, embeds: [], components: [] });
}

/** Render the outcome of an AI administration request. */
async function renderAdminResult(interaction, result, context = {}) {
  const prompt = context.prompt || '';

  switch (result.kind) {
    case 'executed': {
      const embed = buildResultEmbed(result.report, null, result.gaps);
      if (result.notes) {
        embed.addFields({ name: 'Notes', value: String(result.notes).slice(0, 1000), inline: false });
      }

      const components = [];
      if (prompt) {
        const session = createConversation({
          guildId: interaction.guild.id,
          requesterId: interaction.user.id,
          prompt,
        });
        components.push(buildConversationRow(session.id, 'Follow up'));
      }

      await editOrReply(interaction, { content: null, embeds: [embed], components });
      return;
    }

    case 'awaiting_confirmation': {
      const embed = buildPlanEmbed(result.plan);
      await editOrReply(interaction, {
        content: null,
        embeds: [embed],
        components: [buildButtons(result.plan)],
      });
      return;
    }

    case 'dry_run': {
      const embed = buildPlanEmbed(result.plan)
        .setTitle('Plan preview (nothing was changed)')
        .setColor(0x3498db);
      embed.addFields({
        name: 'Dry run',
        value: 'Nothing was applied. Re-run without the dry-run option to execute this plan.',
      });
      if (result.rejected?.length) {
        embed.addFields({
          name: 'Rejected steps',
          value: result.rejected.map((r) => `${r.tool} (${r.reason})`).join('\n').slice(0, 1000),
        });
      }
      await editOrReply(interaction, { content: null, embeds: [embed], components: [] });
      return;
    }

    case 'no_action': {
      const notes = String(result.notes || 'I did not find anything to change.').slice(0, 2000);
      const embed = new EmbedBuilder()
        .setTitle('Tell me a little more')
        .setColor(0x95a5a6)
        .setDescription(notes);

      if (result.rejected?.length) {
        embed.addFields({
          name: 'Rejected steps',
          value: result.rejected.map((r) => `${r.tool} — ${r.reason}`).join('\n').slice(0, 1000),
        });
      }

      const components = [];
      if (prompt) {
        const session = createConversation({
          guildId: interaction.guild.id,
          requesterId: interaction.user.id,
          prompt,
          question: notes,
        });
        embed.addFields({
          name: 'Answer without another command',
          value: 'Click **Answer / refine** below and type your answer in the popup.',
        });
        components.push(buildConversationRow(session.id));
      }

      await editOrReply(interaction, { content: null, embeds: [embed], components });
      return;
    }

    default:
      await editOrReply(interaction, {
        content: 'The request was not completed.',
        embeds: [],
        components: [],
      });
  }
}

/** Handle the Answer / refine and Dismiss buttons. */
async function handleConversationButton(interaction) {
  const refineId = idPart(interaction.customId, REFINE_BUTTON);
  const dismissId = idPart(interaction.customId, DISMISS_BUTTON);
  const sessionId = refineId || dismissId;
  const session = getConversation(sessionId);

  if (!session) {
    await interaction.reply({
      content: 'This follow-up has expired. Please run `/ai` again.',
      ephemeral: true,
    });
    return { kind: 'expired' };
  }

  if (!canUseConversation(session, interaction)) {
    await interaction.reply({
      content: 'Only the person who started this request can answer it.',
      ephemeral: true,
    });
    return { kind: 'unauthorised' };
  }

  if (dismissId) {
    deleteConversation(sessionId);
    await interaction.deferUpdate();
    await interaction.editReply({ components: [] });
    return { kind: 'dismissed' };
  }

  await interaction.showModal(buildRefineModal(session));
  return { kind: 'modal' };
}

/**
 * Handle the modal answer and continue the original request.
 * This is deliberately a new authorised service call: the model never gets to
 * bypass the normal validation, risk or confirmation pipeline.
 */
async function handleConversationModal(options) {
  const {
    interaction,
    guild,
    config,
    storage,
    audit,
    logger,
    limiter,
    cooldown,
    provider,
    client,
  } = options;

  const sessionId = idPart(interaction.customId, REFINE_MODAL);
  const session = getConversation(sessionId);
  if (!session) {
    await interaction.reply({ content: 'This follow-up has expired. Please run `/ai` again.', ephemeral: true });
    return { kind: 'expired' };
  }
  if (!canUseConversation(session, interaction)) {
    await interaction.reply({ content: 'Only the person who started this request can answer it.', ephemeral: true });
    return { kind: 'unauthorised' };
  }

  const answer = String(interaction.fields.getTextInputValue('answer') || '').trim();
  if (!answer) {
    await interaction.reply({ content: 'Please type an answer first.', ephemeral: true });
    return { kind: 'empty' };
  }

  const prompt = `${session.prompt}\n\nFollow-up from the administrator: ${answer}`;
  updateConversation(sessionId, { prompt });

  // Acknowledge quickly, then use the original message for progress/result.
  if (interaction.message && typeof interaction.deferUpdate === 'function') {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply();
  }

  const requestInteraction = {
    user: interaction.user,
    guild,
    options: {
      getString: (name) => (name === 'prompt' ? prompt : null),
      getBoolean: () => false,
    },
  };

  try {
    const result = await handleAdminRequest({
      interaction: requestInteraction,
      guild,
      config,
      storage,
      audit,
      logger,
      limiter,
      cooldown,
      provider,
      client,
      skipRateLimit: true,
      onProgress: async (text) => {
        await interaction.editReply({ content: text, embeds: [], components: [] }).catch(() => {});
      },
    });

    await renderAdminResult(interaction, result, { prompt });
    return result;
  } catch (err) {
    logger?.warn?.('ai: follow-up failed', { reason: toError(err).message });
    await renderAdminError(interaction, err);
    return { kind: 'error', error: err };
  }
}

module.exports = {
  REFINE_BUTTON,
  DISMISS_BUTTON,
  REFINE_MODAL,
  isConversationButton,
  isConversationModal,
  buildConversationRow,
  buildRefineModal,
  renderAdminResult,
  renderAdminError,
  handleConversationButton,
  handleConversationModal,
};
