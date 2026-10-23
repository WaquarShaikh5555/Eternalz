'use strict';

/**
 * Read-only inspection tools.
 *
 * These are the only tools the model may call during the planning phase. They
 * never mutate anything, so they are always safe to execute automatically.
 */

const { ChannelType } = require('discord.js');

const { resolveChannel, resolveRole, isCategory } = require('../resolve');
const { decodePermissions, privilegedPermissionsIn } = require('../permissions');
const { buildGuildSnapshot } = require('../snapshot');

const inspectGuild = {
  name: 'inspect_guild',
  description:
    'Get high level information about the server: name, owner, member count, feature flags, boost tier and the bot\'s own permissions.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(ctx) {
    const guild = ctx.guild;
    const me = guild.members?.me;
    return {
      ok: true,
      message: `Server "${guild.name}" with ${guild.memberCount ?? '?'} members.`,
      data: {
        id: guild.id,
        name: guild.name,
        ownerId: guild.ownerId,
        memberCount: guild.memberCount,
        boostTier: guild.premiumTier,
        features: [...(guild.features || [])],
        botPermissions: me ? decodePermissions(me.permissions.bitfield) : [],
        botHighestRole: me ? me.roles.highest.name : null,
      },
    };
  },
};

const listChannels = {
  name: 'list_channels',
  description:
    'List every channel and category in the server with its type, parent category, position, topic and permission overwrites. Use this to find the exact current names before renaming, moving or deleting something.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        maxLength: 100,
        description: 'Optional category name - only list channels inside it.',
      },
    },
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const guild = ctx.guild;
    let channels = [...guild.channels.cache.values()];

    if (args.category) {
      const category = channels.find(
        (c) =>
          isCategory(c) &&
          c.name.toLowerCase() === String(args.category).toLowerCase(),
      );
      if (!category) throw new Error(`No category named "${args.category}".`);
      channels = channels.filter((c) => c.parentId === category.id);
    }

    const data = channels
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: isCategory(c) ? 'category' : c.type,
        parentId: c.parentId || null,
        parentName: c.parent?.name || null,
        position: c.position,
        topic: c.topic || '',
        nsfw: Boolean(c.nsfw),
        slowmode: c.rateLimitPerUser ?? 0,
        overwrites: c.permissionOverwrites?.cache
          ? [...c.permissionOverwrites.cache.values()].map((o) => ({
              id: o.id,
              type: o.type === 0 ? 'role' : 'member',
              allow: [...o.allow],
              deny: [...o.deny],
            }))
          : [],
      }));

    return { ok: true, message: `${data.length} channel(s) found.`, data };
  },
};

const listRoles = {
  name: 'list_roles',
  description:
    'List every non-managed role with its position, colour, member count and decoded permissions. Use this to find the exact role name before creating, editing or deleting it.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(ctx) {
    const guild = ctx.guild;
    const data = [...guild.roles.cache.values()]
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        hoist: Boolean(r.hoist),
        mentionable: Boolean(r.mentionable),
        managed: Boolean(r.managed),
        memberCount: r.members?.cache?.size ?? 0,
        permissions: decodePermissions(r.permissions.bitfield),
        privilegedPermissions: privilegedPermissionsIn(r),
      }));

    return { ok: true, message: `${data.length} role(s) found.`, data };
  },
};

const getChannelOverwrites = {
  name: 'get_channel_overwrites',
  description:
    'Show the full permission overwrite list of one channel, including which roles or members are allowed and which are denied.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
    },
    required: ['channel'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const channel = resolveChannel(ctx.guild, args.channel);
    const data = [...(channel.permissionOverwrites?.cache?.values() || [])].map((o) => ({
      id: o.id,
      name: o.target?.name || null,
      type: o.type === 0 ? 'role' : 'member',
      allow: [...o.allow],
      deny: [...o.deny],
    }));
    return {
      ok: true,
      message: `${data.length} overwrite(s) on "${channel.name}".`,
      data: { channel: { id: channel.id, name: channel.name }, overwrites: data },
    };
  },
};

const getRolePermissions = {
  name: 'get_role_permissions',
  description: 'Show the decoded permission list of a single role.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', maxLength: 120, description: 'Role name or id.' },
    },
    required: ['role'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const role = resolveRole(ctx.guild, args.role);
    return {
      ok: true,
      message: `Role "${role.name}" has ${decodePermissions(role.permissions.bitfield).length} permission(s).`,
      data: {
        id: role.id,
        name: role.name,
        position: role.position,
        color: role.hexColor,
        permissions: decodePermissions(role.permissions.bitfield),
        privileged: privilegedPermissionsIn(role),
        memberCount: role.members?.cache?.size ?? 0,
      },
    };
  },
};

const getMemberRoles = {
  name: 'get_member_roles',
  description: 'List the roles a specific member currently holds.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {
      member: { type: 'string', maxLength: 120, description: 'Username, display name or user id.' },
    },
    required: ['member'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { resolveMember } = require('../resolve');
    const member = await resolveMember(ctx.guild, args.member);
    return {
      ok: true,
      message: `${member.user.username} holds ${member.roles.cache.size} role(s).`,
      data: {
        id: member.id,
        username: member.user.username,
        roles: [...member.roles.cache.values()].map((r) => ({
          id: r.id,
          name: r.name,
          position: r.position,
        })),
      },
    };
  },
};

const getServerSnapshot = {
  name: 'get_server_snapshot',
  description:
    'Return a fresh, complete snapshot of the whole server (categories, channels, roles, bot permissions) in one call. Prefer this over several individual lookups.',
  mutating: false,
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(ctx) {
    const snapshot = buildGuildSnapshot(ctx.guild, ctx.guild.members?.me);
    return {
      ok: true,
      message: `Snapshot: ${snapshot.channels.length} channel(s), ${snapshot.roles.length} role(s).`,
      data: snapshot,
    };
  },
};

module.exports = [
  inspectGuild,
  listChannels,
  listRoles,
  getChannelOverwrites,
  getRolePermissions,
  getMemberRoles,
  getServerSnapshot,
];
