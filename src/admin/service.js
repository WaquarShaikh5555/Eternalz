'use strict';

/**
 * Orchestration for AI administration.
 *
 * This module owns the end-to-end flow:
 *
 *   request -> authorise -> rate limit -> inspect -> plan -> risk
 *           -> (auto execute | request confirmation) -> verify -> report -> audit
 *
 * Authorisation is checked here BEFORE the AI provider is contacted, and
 * again inside `executeActions` before any change is made.
 */

const { EmbedBuilder } = require('discord.js');

const { createPlan } = require('../ai/planner');
const { buildGuildSnapshot } = require('../discord/snapshot');
const { assessPlan, RISK, riskLabel, riskColour } = require('./risk');
const { assertGuildAdmin, describeRefusal, isGuildAdmin } = require('./authorization');
const { executePlan, planPermissionGaps } = require('./executor');
const {
  createPendingPlan,
  loadPlan,
  buildPlanEmbed,
  buildButtons,
  parseCustomId,
  assertRequester,
  STATUS,
} = require('./confirmation');
const { AuthorizationError, toError } = require('../core/errors');

/**
 * Read the real Discord slash-command option.
 *
 * `getPrompt()` only exists in our test doubles; Discord.js exposes
 * `getString('prompt')`. Keep the fallback for backwards compatibility with
 * older tests and internal follow-up interactions.
 */
function extractPrompt(interaction) {
  const options = interaction?.options;
  if (!options) return '';
  if (typeof options.getString === 'function') {
    const value = options.getString('prompt');
    if (value) return String(value);
  }
  if (typeof options.getPrompt === 'function') {
    return String(options.getPrompt() || '');
  }
  return '';
}

/**
 * Handle a `/ai` request.
 *
 * @returns {Promise<{kind: string, plan?: object, report?: object}>}
 */
async function handleAdminRequest(options) {
  const { interaction, config, storage, audit, logger, limiter, cooldown, guild } = options;

  const requesterId = interaction.user.id;
  const guildId = guild.id;

  // --- 1. Authorisation BEFORE the AI provider is contacted ---------------
  try {
    assertGuildAdmin(config, guild, requesterId);
  } catch (err) {
    await audit?.log({
      guildId,
      requesterId,
      event: 'rejected',
      prompt: extractPrompt(interaction) || null,
      summary: { reason: describeRefusal(config, guild, requesterId) },
      notify: false,
    });
    throw err;
  }

  if (!config.aiApiKey) {
    throw new AuthorizationError(
      'AI administration is not configured on this server yet. The server owner needs to set AI_API_KEY (and AI_PROVIDER / AI_MODEL) for the bot.',
    );
  }

  // --- 2. Validate the request, then rate limit ----------------------------
  const prompt = extractPrompt(interaction).trim();
  const dryRun = Boolean(interaction.options?.getBoolean?.('dry_run'));

  if (!prompt) {
    throw new AuthorizationError('Please describe what should change.');
  }
  if (config.aiMaxPromptLength && prompt.length > config.aiMaxPromptLength) {
    throw new AuthorizationError(
      `The request is too long (${prompt.length} characters). The limit is ${config.aiMaxPromptLength}.`,
    );
  }

  const cooldownKey = `${guildId}:${requesterId}`;
  if (!options.skipRateLimit) {
    const cooldownLeft = cooldown?.remaining(cooldownKey) || 0;
    if (cooldownLeft > 0) {
      throw new AuthorizationError(
        `Please wait ${cooldownLeft}s before sending another AI administration request.`,
      );
    }
    if (limiter && !limiter.tryAcquire(cooldownKey)) {
      const wait = Math.ceil(limiter.retryAfterMs(cooldownKey) / 1000);
      throw new AuthorizationError(
        `Too many AI administration requests. Please try again in ${wait}s.`,
      );
    }
    cooldown?.start(cooldownKey, config.aiRequestCooldownMs);
  }

  const progress = options.onProgress || (async () => {});

  // --- 3. Inspect the real server state ------------------------------------
  await progress('🔍 Reading the current server and understanding your request…');
  const snapshot = buildGuildSnapshot(guild, guild.members?.me);

  const actorMember = guild.members?.cache?.get(requesterId) || null;
  const ctx = {
    guild,
    client: options.client,
    storage,
    logger,
    actorMember,
    requesterId,
    snapshot,
    signal: options.signal,
  };

  // --- 4. Ask the model for a plan ----------------------------------------
  await progress('🧠 Thinking through the best safe changes and building a plan…');
  const plan = await createPlan({
    provider: options.provider,
    config,
    ctx,
    prompt,
    snapshot,
    logger,
  });

  const actions = plan.actions || [];

  // --- 5. Classify the risk -------------------------------------------------
  const assessment = assessPlan(actions);

  // Check up-front whether the bot is even allowed to perform these actions.
  const gaps = planPermissionGaps(guild, actions);

  await audit?.log({
    guildId,
    requesterId,
    event: 'planned',
    prompt,
    summary: {
      actions: actions.map((a) => ({ tool: a.tool, args: a.args })),
      risk: assessment.level,
      reasons: assessment.reasons,
      rejected: plan.rejected,
      notes: plan.notes,
    },
  });

  if (!actions.length) {
    return {
      kind: 'no_action',
      notes: plan.notes || 'I did not find anything to change.',
      rejected: plan.rejected,
      gaps,
    };
  }

  // --- 6. Dry run stops here ----------------------------------------------
  if (dryRun) {
    const pending = await createPendingPlan({
      storage,
      config,
      guildId,
      requesterId,
      prompt,
      actions,
      risk: assessment.level,
      reasons: assessment.reasons,
      permissionGaps: gaps,
    });
    return {
      kind: 'dry_run',
      plan: pending,
      notes: plan.notes,
      rejected: plan.rejected,
      gaps,
    };
  }

  // --- 7. Auto-execute safe plans -----------------------------------------
  if (assessment.level === RISK.SAFE || assessment.level === RISK.READ) {
    await progress('⚙️ Applying the plan and verifying every change…');
    const result = await executeActions({
      actions,
      ctx,
      config,
      logger,
      guild,
      requesterId,
    });

    await audit?.log({
      guildId,
      requesterId,
      event: result.failed.length ? 'partial_failure' : 'executed',
      prompt,
      summary: summariseResult(result),
    });

    return { kind: 'executed', report: result, notes: plan.notes, gaps };
  }

  // --- 8. Ask for confirmation --------------------------------------------
  const pending = await createPendingPlan({
    storage,
    config,
    guildId,
    requesterId,
    prompt,
    actions,
    risk: assessment.level,
    reasons: assessment.reasons,
    permissionGaps: gaps,
  });

  await audit?.log({
    guildId,
    requesterId,
    event: 'awaiting_confirmation',
    prompt,
    summary: { planId: pending.id, risk: assessment.level, actions: actions.length },
  });

  return { kind: 'awaiting_confirmation', plan: pending, notes: plan.notes, gaps };
}

/**
 * Handle a Confirm / Cancel button press.
 */
async function handlePlanButton(options) {
  const { interaction, config, storage, audit, logger, client, guild } = options;

  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return { kind: 'ignored' };

  const { action, planId } = parsed;
  const requesterId = interaction.user.id;
  const guildId = guild.id;

  const plan = await loadPlan(storage, planId);
  if (!plan) {
    await interaction.reply({
      content: 'This plan no longer exists or has expired.',
      ephemeral: true,
    });
    return { kind: 'expired' };
  }

  if (plan.guildId !== guildId) {
    await interaction.reply({ content: 'This plan belongs to another server.', ephemeral: true });
    return { kind: 'wrong_guild' };
  }

  try {
    assertRequester(plan, requesterId);
  } catch (err) {
    await audit?.log({
      guildId,
      requesterId,
      event: 'unauthorised_confirmation',
      summary: { planId, reason: err.message },
      notify: false,
    });
    await interaction.reply({
      content: 'Only the person who requested this plan can confirm or cancel it.',
      ephemeral: true,
    });
    return { kind: 'unauthorised' };
  }

  if (plan.status !== STATUS.PENDING) {
    await interaction.reply({
      content: `This plan was already ${plan.status}.`,
      ephemeral: true,
    });
    return { kind: 'already_handled', plan };
  }

  if (Date.now() > plan.expiresAt) {
    await storage.updatePlan(plan.id, { status: STATUS.EXPIRED });
    await interaction.reply({ content: 'This plan has expired. Send the request again.', ephemeral: true });
    await audit?.log({
      guildId,
      requesterId,
      event: 'expired',
      summary: { planId },
      notify: false,
    });
    return { kind: 'expired' };
  }

  // --- Cancel --------------------------------------------------------------
  if (action === 'cancel') {
    await storage.updatePlan(plan.id, { status: STATUS.CANCELLED });
    await interaction.deferUpdate();
    const embed = buildPlanEmbed({ ...plan, status: STATUS.CANCELLED })
      .setTitle('Plan cancelled')
      .setColor(0x95a5a6);
    await interaction.editReply({ embeds: [embed], components: [] });
    await audit?.log({
      guildId,
      requesterId,
      event: 'cancelled',
      prompt: plan.prompt,
      summary: { planId },
    });
    return { kind: 'cancelled', plan };
  }

  // --- Re-authorise before executing ---------------------------------------
  if (!isGuildAdmin(config, guild, requesterId)) {
    await storage.updatePlan(plan.id, { status: STATUS.CANCELLED });
    await interaction.reply({
      content: 'Your administrator access changed, so this plan was cancelled.',
      ephemeral: true,
    });
    await audit?.log({
      guildId,
      requesterId,
      event: 'unauthorised_confirmation',
      summary: { planId, reason: 'authorisation changed' },
      notify: false,
    });
    return { kind: 'unauthorised' };
  }

  // --- Second confirmation for especially destructive plans ----------------
  if (plan.risk === RISK.CONFIRM_TWICE && !plan.secondConfirmed) {
    await storage.updatePlan(plan.id, { secondConfirmed: true });
    await interaction.deferUpdate();
    const embed = buildPlanEmbed(plan, { secondStage: true });
    await interaction.editReply({ embeds: [embed], components: [buildButtons(plan, { secondStage: true })] });
    await audit?.log({
      guildId,
      requesterId,
      event: 'second_confirmation_requested',
      prompt: plan.prompt,
      summary: { planId },
    });
    return { kind: 'second_confirmation', plan };
  }

  // --- Execute --------------------------------------------------------------
  await interaction.deferUpdate();
  await storage.updatePlan(plan.id, { status: STATUS.CONFIRMED, confirmedAt: Date.now() });

  const actorMember = guild.members?.cache?.get(requesterId) || null;
  const ctx = {
    guild,
    client,
    storage,
    logger,
    actorMember,
    requesterId,
    snapshot: buildGuildSnapshot(guild, guild.members?.me),
  };

  let result;
  try {
    result = await executeActions({
      actions: plan.actions,
      ctx,
      config,
      logger,
      guild,
      requesterId,
    });
  } catch (err) {
    const error = toError(err);
    await storage.updatePlan(plan.id, { status: STATUS.FAILED, executedAt: Date.now() });
    await audit?.log({
      guildId,
      requesterId,
      event: 'failed',
      prompt: plan.prompt,
      summary: { planId, error: error.message },
    });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Execution failed')
          .setColor(0xe74c3c)
          .setDescription(error.message.slice(0, 1500)),
      ],
      components: [],
    });
    return { kind: 'failed', error };
  }

  await storage.updatePlan(plan.id, {
    status: STATUS.EXECUTED,
    executedAt: Date.now(),
    result: summariseResult(result),
  });

  await audit?.log({
    guildId,
    requesterId,
    event: result.failed.length ? 'partial_failure' : 'executed',
    prompt: plan.prompt,
    summary: { planId, ...summariseResult(result) },
  });

  const embed = buildResultEmbed(result, plan, plan.permissionGaps);
  await interaction.editReply({ embeds: [embed], components: [] });

  return { kind: 'executed', report: result, plan };
}

/**
 * Execute the actions, re-checking authorisation before each one.
 */
async function executeActions({ actions, ctx, config, logger, guild, requesterId }) {
  return executePlan({
    actions,
    ctx,
    config,
    logger,
    authorize: () => {
      assertGuildAdmin(config, guild, requesterId);
    },
  });
}

/** Compact summary used for the audit log. */
function summariseResult(result) {
  return {
    succeeded: result.succeeded.map((s) => ({ tool: s.tool, message: s.message, data: s.data })),
    failed: result.failed.map((f) => ({ tool: f.tool, error: f.error })),
    skipped: result.skipped.map((s) => ({ tool: s.tool, reason: s.reason })),
    summary: result.summary,
  };
}

/** Embed that reports exactly what happened. */
function buildResultEmbed(result, plan, gaps = null) {
  const embed = new EmbedBuilder().setTimestamp();

  const total = result.succeeded.length + result.failed.length + result.skipped.length;
  const colour = result.failed.length ? 0xe67e22 : 0x2ecc71;

  embed
    .setTitle(
      result.failed.length
        ? `Completed with ${result.failed.length} failure${result.failed.length === 1 ? '' : 's'}`
        : 'All requested changes were applied',
    )
    .setColor(colour)
    .setDescription(result.summary);

  if (result.succeeded.length) {
    embed.addFields({
      name: `Applied (${result.succeeded.length})`,
      value: result.succeeded
        .slice(0, 15)
        .map((s) => `✅ ${s.message || s.description}`)
        .join('\n')
        .slice(0, 1000),
      inline: false,
    });
  }

  if (result.failed.length) {
    embed.addFields({
      name: `Failed (${result.failed.length})`,
      value: result.failed
        .slice(0, 15)
        .map((f) => `❌ ${f.description}\n\`${String(f.error).slice(0, 250)}\``)
        .join('\n')
        .slice(0, 1000),
      inline: false,
    });
  }

  if (result.skipped.length) {
    embed.addFields({
      name: `Skipped (${result.skipped.length})`,
      value: result.skipped
        .slice(0, 15)
        .map((s) => `⏭️ ${s.description}\n${String(s.reason).slice(0, 200)}`)
        .join('\n')
        .slice(0, 900),
      inline: false,
    });
  }

  if (gaps?.missing?.length) {
    embed.addFields({
      name: '⚠️ Missing Discord permissions',
      value: [
        `The bot could not perform everything: ${gaps.missing.join(', ')}.`,
        gaps.hint,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1000),
      inline: false,
    });
  }

  if (plan?.id) {
    embed.setFooter({ text: `Plan ${plan.id.slice(0, 8)} • ${total} action(s)` });
  }

  return embed;
}

module.exports = {
  extractPrompt,
  handleAdminRequest,
  handlePlanButton,
  executeActions,
  buildResultEmbed,
  summariseResult,
  riskLabel,
  riskColour,
};
