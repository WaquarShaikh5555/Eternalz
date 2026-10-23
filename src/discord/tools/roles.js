'use strict';

/**
 * Role management and member-role tools.
 */

const { resolveRole, resolveMember } = require('../resolve');
const {
  assertBotPermissions,
  assertBotOutranksRole,
  assertBotOutranksMember,
  assertActorOutranksRole,
  assertActorOutranksMember,
  permissionsFromNames,
  decodePermissions,
  privilegedPermissionsIn,
} = require('../permissions');
const { ValidationError } = require('../../core/errors');

const COLOUR_RE = /^#?[0-9a-fA-F]{6}$/;

function parseColour(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const str = String(value).trim();
  if (!COLOUR_RE.test(str)) {
    throw new ValidationError(`"${value}" is not a valid hex colour (expected e.g. #5865F2).`);
  }
  return parseInt(str.replace('#', ''), 16);
}

const createRole = {
  name: 'create_role',
  description:
    'Create a new role. Optionally give it a colour, hoist it to a separate section, allow it to be mentioned, and attach permissions.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'Role name.' },
      color: { type: 'string', maxLength: 7, description: 'Hex colour, e.g. #5865F2.' },
      permissions: {
        type: 'array',
        maxItems: 40,
        items: { type: 'string', maxLength: 60 },
        description:
          'Permission names to grant, e.g. ["ViewChannel","SendMessages"]. Use [] for a plain role.',
      },
      hoist: { type: 'boolean', description: 'Display the role separately in the member list.' },
      mentionable: { type: 'boolean', description: 'Allow the role to be mentioned by anyone.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageRoles']);

    const duplicate = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === args.name.toLowerCase(),
    );
    if (duplicate) {
      return {
        ok: true,
        skipped: true,
        message: `Role "${duplicate.name}" already exists - not creating a duplicate.`,
        data: { id: duplicate.id, name: duplicate.name },
      };
    }

    const permissions = permissionsFromNames(args.permissions || []);
    const created = await guild.roles.create({
      name: args.name,
      color: parseColour(args.color),
      permissions,
      hoist: Boolean(args.hoist),
      mentionable: Boolean(args.mentionable),
    });

    const privileged = privilegedPermissionsIn(created);
    return {
      ok: true,
      message: `Created role "${created.name}".`,
      data: {
        id: created.id,
        name: created.name,
        color: created.hexColor,
        permissions: decodePermissions(created.permissions.bitfield),
        privilegedPermissions: privileged,
      },
      reversal: { kind: 'delete_role', role: created.id, note: 'Delete the role to undo.' },
    };
  },
};

const editRole = {
  name: 'edit_role',
  description:
    'Change an existing role: rename it, recolour it, toggle hoist/mentionable, or replace its permission set.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', maxLength: 120, description: 'Role name or id.' },
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'New role name.' },
      color: { type: 'string', maxLength: 7, description: 'New hex colour.' },
      permissions: {
        type: 'array',
        maxItems: 40,
        items: { type: 'string', maxLength: 60 },
        description: 'The complete replacement permission list. Omit to leave permissions untouched.',
      },
      hoist: { type: 'boolean' },
      mentionable: { type: 'boolean' },
    },
    required: ['role'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageRoles']);
    const role = resolveRole(guild, args.role);
    if (role.managed) throw new ValidationError('Managed roles (like @everyone) cannot be edited.');
    assertBotOutranksRole(guild, role);
    if (ctx.actorMember) assertActorOutranksRole(guild, ctx.actorMember, role);

    const previous = {
      name: role.name,
      color: role.hexColor,
      permissions: decodePermissions(role.permissions.bitfield),
      hoist: role.hoist,
      mentionable: role.mentionable,
    };

    const patch = {};
    if (args.name) patch.name = args.name;
    const colour = parseColour(args.color);
    if (colour !== undefined) patch.color = colour;
    if (typeof args.hoist === 'boolean') patch.hoist = args.hoist;
    if (typeof args.mentionable === 'boolean') patch.mentionable = args.mentionable;
    if (Array.isArray(args.permissions)) {
      patch.permissions = permissionsFromNames(args.permissions);
    }

    if (Object.keys(patch).length === 0) {
      throw new ValidationError('Nothing to change - provide at least one field to update.');
    }

    await role.edit(patch);
    const verified = await role.fetch().catch(() => null);
    if (!verified) throw new Error('Could not re-read the role to verify the change.');

    return {
      ok: true,
      message: `Updated role "${verified.name}".`,
      data: {
        id: verified.id,
        name: verified.name,
        color: verified.hexColor,
        permissions: decodePermissions(verified.permissions.bitfield),
        privilegedPermissions: privilegedPermissionsIn(verified),
      },
      reversal: { kind: 'edit_role', role: verified.id, previous },
    };
  },
};

const deleteRole = {
  name: 'delete_role',
  description:
    'Permanently delete a role and remove it from every member. This cannot be undone by the bot. Requires explicit confirmation.',
  mutating: true,
  destructive: true,
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', maxLength: 120, description: 'Role name or id.' },
    },
    required: ['role'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageRoles']);
    const role = resolveRole(guild, args.role);
    if (role.managed) throw new ValidationError('Managed roles cannot be deleted.');
    if (role.id === guild.id) throw new ValidationError('The @everyone role cannot be deleted.');
    assertBotOutranksRole(guild, role);
    if (ctx.actorMember) assertActorOutranksRole(guild, ctx.actorMember, role);

    const name = role.name;
    const id = role.id;
    const memberCount = role.members?.cache?.size ?? 0;
    await role.delete('Removed by the Eternalz AI administrator.');

    return {
      ok: true,
      message: `Deleted role "${name}" (was held by ${memberCount} member(s)).`,
      data: { id, name, memberCount },
      reversal: null,
      note: 'Role deletion is not reversible by the bot.',
    };
  },
};

const assignRole = {
  name: 'assign_role',
  description:
    'Give a member a role. Only non-privileged roles may be assigned; the bot and the requesting user must both outrank the member and the role.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      member: { type: 'string', maxLength: 120, description: 'Username, display name or user id.' },
      role: { type: 'string', maxLength: 120, description: 'Role name or id.' },
    },
    required: ['member', 'role'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageRoles']);
    const role = resolveRole(guild, args.role);
    const member = await resolveMember(guild, args.member);

    if (role.managed) throw new ValidationError('Managed roles cannot be assigned manually.');
    const privileged = privilegedPermissionsIn(role);
    if (privileged.length > 0) {
      throw new ValidationError(
        `Role "${role.name}" carries privileged permissions (${privileged.join(', ')}) and cannot be assigned by the AI administrator.`,
      );
    }
    assertBotOutranksRole(guild, role);
    assertBotOutranksMember(guild, member);
    if (ctx.actorMember) assertActorOutranksMember(guild, ctx.actorMember, member);

    if (member.roles.cache.has(role.id)) {
      return {
        ok: true,
        skipped: true,
        message: `"${member.user.username}" already has the role "${role.name}".`,
        data: { memberId: member.id, roleId: role.id },
      };
    }

    await member.roles.add(role, 'Assigned by the Eternalz AI administrator.');
    const verified = await member.fetch().catch(() => null);
    const hasRole = verified?.roles?.cache?.has(role.id);
    if (!hasRole) throw new Error('The role assignment did not take effect.');

    return {
      ok: true,
      message: `Gave "${role.name}" to ${member.user.username}.`,
      data: { memberId: member.id, memberName: member.user.username, roleId: role.id, roleName: role.name },
      reversal: { kind: 'remove_role', member: member.id, role: role.id },
    };
  },
};

const removeRole = {
  name: 'remove_role',
  description:
    'Remove a role from a member. Only non-privileged roles may be removed. Removing access for many members at once requires a second confirmation.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      member: { type: 'string', maxLength: 120, description: 'Username, display name or user id.' },
      role: { type: 'string', maxLength: 120, description: 'Role name or id.' },
    },
    required: ['member', 'role'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageRoles']);
    const role = resolveRole(guild, args.role);
    const member = await resolveMember(guild, args.member);

    const privileged = privilegedPermissionsIn(role);
    if (privileged.length > 0) {
      throw new ValidationError(
        `Role "${role.name}" carries privileged permissions (${privileged.join(', ')}) and cannot be removed by the AI administrator.`,
      );
    }
    assertBotOutranksRole(guild, role);
    assertBotOutranksMember(guild, member);
    if (ctx.actorMember) assertActorOutranksMember(guild, ctx.actorMember, member);

    if (!member.roles.cache.has(role.id)) {
      return {
        ok: true,
        skipped: true,
        message: `${member.user.username} does not have the role "${role.name}".`,
        data: { memberId: member.id, roleId: role.id },
      };
    }

    await member.roles.remove(role, 'Removed by the Eternalz AI administrator.');
    const verified = await member.fetch().catch(() => null);
    if (verified?.roles?.cache?.has(role.id)) {
      throw new Error('The role removal did not take effect.');
    }

    return {
      ok: true,
      message: `Removed "${role.name}" from ${member.user.username}.`,
      data: { memberId: member.id, memberName: member.user.username, roleId: role.id, roleName: role.name },
      reversal: { kind: 'assign_role', member: member.id, role: role.id },
    };
  },
};

module.exports = [createRole, editRole, deleteRole, assignRole, removeRole];
