'use strict';

/**
 * Risk classification.
 *
 * Every planned action is classified into one of four levels:
 *
 *   read          - inspection only, never changes anything
 *   safe          - ordinary, explicitly requested, reversible change
 *   confirm       - needs one explicit confirmation from the requester
 *   confirm_twice - needs a second, separate confirmation (very destructive)
 *
 * The classification is decided from the tool identity *and* its arguments,
 * never from the model's own description of the action.
 */

const { getTool } = require('../discord/tools');

const RISK = {
  READ: 'read',
  SAFE: 'safe',
  CONFIRM: 'confirm',
  CONFIRM_TWICE: 'confirm_twice',
};
const ORDER = [RISK.READ, RISK.SAFE, RISK.CONFIRM, RISK.CONFIRM_TWICE];

/** Permissions that grant sweeping control over a server. */
const HIGH_PRIVILEGE_PERMISSIONS = new Set([
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageWebhooks',
  'ManageChannels',
  'ManageMessages',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
  'MoveMembers',
  'MuteMembers',
  'DeafenMembers',
  'ManageNicknames',
]);

function maxLevel(a, b) {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

function isHighPrivilege(list = []) {
  return list.filter((name) => HIGH_PRIVILEGE_PERMISSIONS.has(name));
}

/**
 * Classify a single action.
 * @param {{tool: string, args: object, toolDef?: object}} action
 * @returns {{level: string, reasons: string[]}}
 */
function assessAction(action) {
  const { tool, args = {} } = action;
  const reasons = [];
  let level = RISK.SAFE;

  // The tool definition decides how risky the action is - never the model.
  const def = action.toolDef || getTool(tool);
  if (!def || !def.mutating) {
    return { level: RISK.READ, reasons: ['read-only inspection'] };
  }

  if (def.destructive) {
    level = maxLevel(level, RISK.CONFIRM);
    reasons.push(`${tool} permanently removes or restricts something`);
  }

  if (def.securitySensitive) {
    level = maxLevel(level, RISK.CONFIRM);
    reasons.push(`${tool} changes access control for an existing channel`);
  }

  switch (tool) {
    case 'create_role': {
      const privileged = isHighPrivilege(args.permissions || []);
      if (privileged.length > 0) {
        level = maxLevel(level, RISK.CONFIRM);
        reasons.push(`the new role would carry ${privileged.join(', ')}`);
        if (privileged.includes('Administrator')) {
          level = RISK.CONFIRM_TWICE;
          reasons.push('granting Administrator requires a second confirmation');
        }
      }
      break;
    }
    case 'edit_role': {
      if (Array.isArray(args.permissions)) {
        const privileged = isHighPrivilege(args.permissions);
        level = maxLevel(level, RISK.CONFIRM);
        reasons.push('the permissions of an existing role would change');
        if (privileged.includes('Administrator')) {
          level = RISK.CONFIRM_TWICE;
          reasons.push('granting Administrator requires a second confirmation');
        }
      }
      break;
    }
    case 'create_channel': {
      if (args.private === true) {
        level = maxLevel(level, RISK.CONFIRM);
        reasons.push('the new channel would be private');
      }
      break;
    }
    case 'create_ticket_channel': {
      level = maxLevel(level, RISK.CONFIRM);
      reasons.push('a private ticket channel with restricted access would be created');
      break;
    }
    case 'assign_role': {
      // The tool itself refuses privileged roles; nothing extra to add here.
      break;
    }
    default:
      break;
  }

  return { level, reasons };
}

/**
 * Classify a whole plan. Bulk patterns raise the level of the plan.
 * @param {Array<{tool: string, args: object}>} actions
 * @returns {{level: string, reasons: string[], counts: object}}
 */
function assessPlan(actions = []) {
  const counts = { read: 0, safe: 0, confirm: 0, confirmTwice: 0 };
  const reasons = [];
  let level = RISK.READ;

  const destructiveTools = [];
  const roleRemovals = [];

  for (const action of actions) {
    const { level: actionLevel, reasons: actionReasons } = assessAction(action);
    counts[actionLevel] = (counts[actionLevel] || 0) + 1;
    level = maxLevel(level, actionLevel);
    for (const reason of actionReasons) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (action.tool === 'delete_channel' || action.tool === 'delete_role' ||
        action.tool === 'ban_member' || action.tool === 'kick_member') {
      destructiveTools.push(action.tool);
    }
    if (action.tool === 'remove_role') roleRemovals.push(action);
  }

  if (destructiveTools.length >= 3) {
    level = RISK.CONFIRM_TWICE;
    reasons.push(
      `${destructiveTools.length} destructive actions in one plan require a second confirmation`,
    );
  }

  if (roleRemovals.length >= 3) {
    level = RISK.CONFIRM_TWICE;
    reasons.push(
      `access would be removed from ${roleRemovals.length} members at once, which requires a second confirmation`,
    );
  }

  // A plan that only reads is not a plan.
  if (actions.length > 0 && counts.safe + counts.confirm + counts.confirmTwice === 0) {
    level = RISK.READ;
  }

  return { level, reasons, counts };
}

const RISK_LABELS = {
  [RISK.READ]: 'Read only',
  [RISK.SAFE]: 'Low risk - executed automatically',
  [RISK.CONFIRM]: 'Needs confirmation',
  [RISK.CONFIRM_TWICE]: 'Destructive - needs two confirmations',
};

const RISK_COLOURS = {
  [RISK.READ]: 0x95a5a6,
  [RISK.SAFE]: 0x2ecc71,
  [RISK.CONFIRM]: 0xf1c40f,
  [RISK.CONFIRM_TWICE]: 0xe74c3c,
};

function riskLabel(level) {
  return RISK_LABELS[level] || RISK_LABELS[RISK.SAFE];
}

function riskColour(level) {
  return RISK_COLOURS[level] ?? RISK_COLOURS[RISK.SAFE];
}

module.exports = {
  RISK,
  ORDER,
  HIGH_PRIVILEGE_PERMISSIONS,
  assessAction,
  assessPlan,
  riskLabel,
  riskColour,
  maxLevel,
};
