'use strict';

/**
 * Confirmation flow.
 *
 * A pending plan is persisted, bound to the user who requested it, and can
 * only be confirmed by that same user. Pending plans expire, and the whole
 * authorisation + permission state is re-validated at confirmation time.
 */

const crypto = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const { RISK, riskLabel, riskColour } = require('./risk');
const { AuthorizationError } = require('../core/errors');

const PREFIX = 'ai_admin';

const ACTION = {
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  CONFIRM_TWICE: 'confirm_twice',
};

const CUSTOM_ID = {
  confirm: `${PREFIX}:${ACTION.CONFIRM}`,
  cancel: `${PREFIX}:${ACTION.CANCEL}`,
  confirmTwice: `${PREFIX}:${ACTION.CONFIRM_TWICE}`,
};

const STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  EXECUTED: 'executed',
  EXPIRED: 'expired',
  FAILED: 'failed',
};

/** Create and persist a pending plan. */
async function createPendingPlan({
  storage,
  config,
  guildId,
  requesterId,
  prompt,
  actions,
  risk,
  reasons,
  permissionGaps,
}) {
  const now = Date.now();
  const plan = {
    id: crypto.randomBytes(12).toString('hex'),
    guildId,
    requesterId,
    prompt: String(prompt || '').slice(0, 2000),
    actions: actions || [],
    risk: risk || RISK.SAFE,
    reasons: reasons || [],
    status: STATUS.PENDING,
    createdAt: now,
    expiresAt: now + (config.aiConfirmTimeoutMs || 5 * 60_000),
    confirmedAt: null,
    executedAt: null,
    result: null,
    permissionGaps: permissionGaps || null,
  };
  await storage.putPlan(plan);
  return plan;
}

/** Load a plan, marking it expired when its time is up. */
async function loadPlan(storage, planId) {
  const plan = await storage.getPlan(planId);
  if (!plan) return null;
  if (plan.status === STATUS.PENDING && Date.now() > plan.expiresAt) {
    await storage.updatePlan(planId, { status: STATUS.EXPIRED });
    return { ...plan, status: STATUS.EXPIRED };
  }
  return plan;
}

/** Mark every stale pending plan as expired (called on start-up). */
async function expireStalePlans(storage) {
  const now = Date.now();
  const plans = await storage.listPlans(null, 200);
  let count = 0;
  for (const plan of plans) {
    if (plan.status === STATUS.PENDING && now > plan.expiresAt) {
      await storage.updatePlan(plan.id, { status: STATUS.EXPIRED });
      count += 1;
    }
  }
  return count;
}

/** Build the embed that shows the plan to the requester. */
function buildPlanEmbed(plan, { secondStage = false } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(secondStage ? 'Final confirmation required' : 'AI administration plan')
    .setColor(riskColour(plan.risk))
    .setTimestamp(new Date(plan.createdAt));

  const lines = (plan.actions || []).slice(0, 15).map((action, index) => {
    const flag = action.risk === RISK.CONFIRM_TWICE ? ' ⚠️' : action.risk === RISK.CONFIRM ? ' ⚠' : '';
    return `**${index + 1}.** ${action.description}${flag}`;
  });

  embed.addFields(
    {
      name: 'Requested change',
      value: `> ${String(plan.prompt || '').slice(0, 500)}`,
      inline: false,
    },
    {
      name: `Planned actions (${plan.actions?.length || 0})`,
      value: lines.length ? lines.join('\n') : 'No actions.',
      inline: false,
    },
    {
      name: 'Risk assessment',
      value: `${riskLabel(plan.risk)}${
        plan.reasons?.length ? `\n${plan.reasons.map((r) => `• ${r}`).join('\n')}` : ''
      }`,
      inline: false,
    },
  );

  if (plan.permissionGaps?.missing?.length) {
    embed.addFields({
      name: '⚠️ Missing Discord permissions',
      value: [
        `The bot cannot perform this plan yet: ${plan.permissionGaps.missing.join(', ')}.`,
        plan.permissionGaps.hint,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1000),
      inline: false,
    });
  }

  if ((plan.actions?.length || 0) > 15) {
    embed.addFields({
      name: 'Note',
      value: `Only the first 15 actions are shown; ${plan.actions.length - 15} more will run.`,
      inline: false,
    });
  }

  embed.setFooter({
    text: `Plan ${plan.id.slice(0, 8)} • expires ${new Date(plan.expiresAt).toUTCString()}`,
  });

  return embed;
}

/** Build the Confirm / Cancel row. */
function buildButtons(plan, { secondStage = false } = {}) {
  const row = new ActionRowBuilder();

  if (secondStage) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID.confirmTwice}:${plan.id}`)
        .setLabel('Yes, do it')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID.cancel}:${plan.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    return row;
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID.confirm}:${plan.id}`)
      .setLabel('Confirm')
      .setStyle(
        plan.risk === RISK.CONFIRM_TWICE ? ButtonStyle.Danger : ButtonStyle.Success,
      ),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID.cancel}:${plan.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return row;
}

/**
 * Parse a button custom id.
 * @returns {{action: string, planId: string}|null}
 */
function parseCustomId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 3) return null;
  const [prefix, action, planId] = parts;
  if (prefix !== PREFIX) return null;
  if (!Object.values(ACTION).includes(action)) return null;
  if (!planId) return null;
  return { action, planId };
}

/**
 * Check that a user may act on a plan.
 * @throws {AuthorizationError}
 */
function assertRequester(plan, userId) {
  if (!plan) throw new AuthorizationError('This plan no longer exists.');
  if (plan.requesterId !== userId) {
    throw new AuthorizationError(
      'Only the person who requested this plan can confirm or cancel it.',
    );
  }
}

module.exports = {
  CUSTOM_ID,
  ACTION,
  PREFIX,
  STATUS,
  createPendingPlan,
  loadPlan,
  expireStalePlans,
  buildPlanEmbed,
  buildButtons,
  parseCustomId,
  assertRequester,
};
