'use strict';

/**
 * Convert the verified before-state captured by tools into ordinary validated
 * tool calls. There is deliberately no generic "reverse anything" operation:
 * an action is offered only when its inverse is well defined.
 */

const { validateToolCall } = require('../discord/tools');
const { decodePermissions } = require('../discord/permissions');
const { assessPlan, RISK } = require('./risk');

const UNDO_TTL_MS = 15 * 60 * 1000;

const DIRECT_REVERSALS = new Set([
  'rename_channel',
  'set_channel_topic',
  'set_channel_slowmode',
  'move_channel',
  'set_member_nickname',
  'set_server_name',
  'set_channel_nsfw',
  'assign_role',
  'remove_role',
]);

function reversalCall(reversal) {
  if (!reversal || typeof reversal !== 'object') return null;
  if (DIRECT_REVERSALS.has(reversal.kind)) {
    const args = { ...reversal };
    delete args.kind;
    delete args.note;
    if (reversal.kind === 'move_channel') args.category = reversal.category || '';
    return { tool: reversal.kind, args };
  }

  if (reversal.kind === 'edit_role' && reversal.previous && typeof reversal.previous === 'object') {
    return {
      tool: 'edit_role',
      args: { role: reversal.role, ...reversal.previous },
    };
  }

  if (reversal.kind === 'set_permission_overwrite') {
    // Older records did not distinguish an absent overwrite from an empty
    // one. Do not guess for those records.
    if (typeof reversal.existed !== 'boolean') return null;
    const target = reversal.targetType === 'member'
      ? `user:${reversal.target}`
      : reversal.target;
    if (!reversal.existed) {
      return {
        tool: 'delete_permission_overwrite',
        args: { channel: reversal.channel, target },
      };
    }
    return {
      tool: 'set_permission_overwrite',
      args: {
        channel: reversal.channel,
        target,
        allow: reversal.allow || [],
        deny: reversal.deny || [],
      },
    };
  }

  return null;
}

function noInverseReason(item) {
  if (item.note) return String(item.note);
  if (item.reversal?.kind === 'delete_channel') {
    return 'The created channel is not deleted automatically because it may contain new content.';
  }
  if (item.reversal?.kind === 'delete_role') {
    return 'The created role is not deleted automatically because members may have received it.';
  }
  return 'No reliable automatic reversal is available for this operation.';
}

function expectedState(item) {
  const reversal = item.reversal || {};
  const data = item.data || {};
  switch (reversal.kind) {
    case 'rename_channel':
      return data.name === undefined ? null : { entity: 'channel', id: reversal.channel, fields: { name: data.name } };
    case 'set_channel_topic':
      return data.topic === undefined ? null : { entity: 'channel', id: reversal.channel, fields: { topic: data.topic || '' } };
    case 'set_channel_slowmode':
      return data.slowmode === undefined ? null : { entity: 'channel', id: reversal.channel, fields: { slowmode: data.slowmode } };
    case 'move_channel':
      return data.parentId === undefined ? null : {
        entity: 'channel',
        id: reversal.channel,
        fields: {
          parentId: data.parentId || null,
          ...(data.position === undefined ? {} : { position: data.position }),
        },
      };
    case 'set_channel_nsfw':
      return data.nsfw === undefined ? null : { entity: 'channel', id: reversal.channel, fields: { nsfw: Boolean(data.nsfw) } };
    case 'set_member_nickname':
      return data.nickname === undefined ? null : { entity: 'member', id: reversal.member, fields: { nickname: data.nickname || '' } };
    case 'set_server_name':
      return data.name === undefined ? null : { entity: 'guild', id: data.guildId, fields: { name: data.name } };
    case 'set_permission_overwrite':
      if (item.tool === 'delete_permission_overwrite') {
        return { entity: 'overwrite', id: reversal.channel, targetId: reversal.target, value: false };
      }
      return Array.isArray(data.allow) && Array.isArray(data.deny) ? {
        entity: 'overwrite',
        id: reversal.channel,
        targetId: reversal.target,
        fields: { allow: data.allow, deny: data.deny },
      } : null;
    case 'edit_role':
      return data.id ? {
        entity: 'role',
        id: data.id,
        fields: {
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.color === undefined ? {} : { color: data.color }),
          ...(data.permissions === undefined ? {} : { permissions: data.permissions }),
        },
      } : null;
    case 'remove_role':
      return { entity: 'member_role', id: reversal.member, roleId: reversal.role, value: true };
    case 'assign_role':
      return { entity: 'member_role', id: reversal.member, roleId: reversal.role, value: false };
    default:
      return null;
  }
}

function sameValue(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  }
  return left === right;
}

async function fetchEntity(guild, entity, id) {
  if (entity === 'guild') return guild.fetch ? guild.fetch() : guild;
  const manager = entity === 'channel' || entity === 'overwrite'
    ? guild.channels
    : entity === 'member' || entity === 'member_role'
      ? guild.members
      : guild.roles;
  const cached = manager?.cache?.get?.(id);
  if (cached) return cached;
  if (manager?.fetch) return manager.fetch(id).catch(() => null);
  return null;
}

/** Refuse to overwrite a newer state before any inverse action is run. */
async function assertUndoPreconditions(guild, actions = []) {
  for (const action of actions) {
    const expected = action.expected;
    if (!expected) continue;
    const entity = await fetchEntity(guild, expected.entity, expected.id);
    if (!entity) throw new Error('Undo was not applied because a target no longer exists.');
    if (expected.entity === 'overwrite') {
      const overwrite = entity.permissionOverwrites?.cache?.get?.(expected.targetId);
      if (expected.value === false) {
        if (overwrite) throw new Error('Undo was not applied because the permission overwrite was recreated.');
        continue;
      }
      if (!overwrite) throw new Error('Undo was not applied because the permission overwrite changed.');
      for (const [field, value] of Object.entries(expected.fields || {})) {
        if (!sameValue([...overwrite[field]], value)) {
          throw new Error('Undo was not applied because the permission overwrite changed after the original action.');
        }
      }
      continue;
    }
    if (expected.entity === 'member_role') {
      if (entity.roles?.cache?.has(expected.roleId) !== expected.value) {
        throw new Error('Undo was not applied because a member role changed after the original action.');
      }
      continue;
    }
    for (const [field, value] of Object.entries(expected.fields || {})) {
      const current = field === 'parentId' ? entity.parentId || null
        : field === 'nickname' ? entity.nickname || ''
          : field === 'topic' ? entity.topic || ''
            : field === 'slowmode' ? entity.rateLimitPerUser ?? 0
              : field === 'color' ? entity.hexColor
                : field === 'permissions' ? decodePermissions(entity.permissions?.bitfield || 0)
                  : entity[field];
      if (!sameValue(current, value)) {
        throw new Error(`Undo was not applied because ${expected.entity} state changed after the original action.`);
      }
    }
  }
}

/**
 * @returns {{actions: Array, unavailable: Array, expiresAt: number, createdAt: number}}
 */
function createUndoState(report, options = {}) {
  const now = options.now || Date.now();
  const actions = [];
  const unavailable = [];

  // Reverse order matters when a plan creates and then edits related entities.
  for (const item of [...(report?.succeeded || [])].reverse()) {
    const call = reversalCall(item.reversal);
    if (!call) {
      unavailable.push({ tool: item.tool, reason: noInverseReason(item) });
      continue;
    }
    const validation = validateToolCall(call.tool, call.args);
    if (!validation.ok) {
      unavailable.push({
        tool: item.tool,
        reason: `The captured reversal is not valid: ${validation.errors.join('; ')}`,
      });
      continue;
    }
    const expected = expectedState(item);
    actions.push({
      tool: call.tool,
      args: validation.args,
      description: `Undo ${item.description || item.tool}`,
      ...(expected ? { expected } : {}),
    });
  }

  // A single Undo click is one explicit confirmation. It must not silently
  // bypass the separate second confirmation required for Administrator or
  // other high-risk bulk reversals.
  if (actions.length && assessPlan(actions).level === RISK.CONFIRM_TWICE) {
    for (const action of actions) {
      unavailable.push({
        tool: action.tool,
        reason: 'This reversal requires a separate high-risk review; use a new request instead of one-click Undo.',
      });
    }
    actions.length = 0;
  }

  return {
    actions,
    unavailable,
    createdAt: now,
    expiresAt: now + (options.ttlMs || UNDO_TTL_MS),
  };
}

/** Small safe-to-render view; the executable calls stay in the plan store. */
function publicUndoState(plan) {
  const undo = plan?.undo;
  if (!undo) return null;
  return {
    planId: plan.id,
    available: Array.isArray(undo.actions) && undo.actions.length > 0,
    count: undo.actions?.length || 0,
    expiresAt: undo.expiresAt,
    unavailable: (undo.unavailable || []).map((item) => ({
      tool: item.tool,
      reason: item.reason,
    })),
  };
}

module.exports = {
  UNDO_TTL_MS,
  reversalCall,
  createUndoState,
  publicUndoState,
  assertUndoPreconditions,
};
