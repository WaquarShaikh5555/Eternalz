'use strict';

/**
 * Discord permission and hierarchy helpers.
 *
 * Every mutating tool calls into this module before touching the API so that
 * a plan can never be executed with insufficient permissions or against a
 * role the bot does not outrank.
 */

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { DiscordPermissionError, NotFoundError } = require('../core/errors');

/** Human readable permission names for a bitfield. */
const PERMISSION_NAMES = new Map(
  Object.entries(PermissionFlagsBits)
    .filter(([, value]) => typeof value === 'bigint')
    .map(([name, value]) => [value, name]),
);

const PRIVILEGED_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'ManageMessages',
  'ManageNicknames',
  'ModerateMembers',
  'BanMembers',
  'KickMembers',
  'MoveMembers',
  'MuteMembers',
  'DeafenMembers',
];

/**
 * The Discord permissions each tool needs.
 *
 * This table lets the bot tell you *before* it tries something that it is not
 * allowed to do, instead of failing halfway through a plan with a raw 403.
 */
const TOOL_PERMISSIONS = {
  // inspection - the bot can always read
  inspect_guild: [],
  list_channels: [],
  list_roles: [],
  get_channel_overwrites: [],
  get_role_permissions: [],
  get_member_roles: [],
  get_server_snapshot: [],

  // channels
  create_category: ['ManageChannels'],
  create_channel: ['ManageChannels'],
  rename_channel: ['ManageChannels'],
  set_channel_topic: ['ManageChannels'],
  set_channel_slowmode: ['ManageChannels'],
  move_channel: ['ManageChannels'],
  delete_channel: ['ManageChannels'],
  set_permission_overwrite: ['ManageChannels'],
  delete_permission_overwrite: ['ManageChannels'],

  // roles
  create_role: ['ManageRoles'],
  edit_role: ['ManageRoles'],
  delete_role: ['ManageRoles'],
  assign_role: ['ManageRoles'],
  remove_role: ['ManageRoles'],

  // messaging
  send_announcement: ['SendMessages', 'EmbedLinks'],
  set_welcome_channel: ['SendMessages', 'EmbedLinks'],

  // moderation
  ban_member: ['BanMembers'],
  kick_member: ['KickMembers'],
  timeout_member: ['ModerateMembers'],
  unban_member: ['BanMembers'],
  delete_messages: ['ManageMessages'],

  // community
  create_ticket_channel: ['ManageChannels', 'ManageRoles'],
  set_onboarding_role: ['ManageRoles'],
  set_server_rules: ['ManageChannels', 'SendMessages'],
};

/** Human readable names for the Discord UI, used in the "how to fix" hint. */
const PERMISSION_LABELS = {
  ManageChannels: 'Manage Channels',
  ManageRoles: 'Manage Roles',
  ManageMessages: 'Manage Messages',
  SendMessages: 'Send Messages',
  EmbedLinks: 'Embed Links',
  BanMembers: 'Ban Members',
  KickMembers: 'Kick Members',
  ModerateMembers: 'Timeout Members',
  ManageGuild: 'Manage Server',
};

function decodePermissions(bitfield) {
  const big = BigInt(bitfield ?? 0n);
  const names = [];
  for (const [value, name] of PERMISSION_NAMES) {
    if ((big & value) === value && value !== 0n) names.push(name);
  }
  return names;
}

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return 0n;
}

/** Convert permission names (or bit values) into a PermissionsBitField. */
function permissionsFromNames(names = []) {
  let value = 0n;
  for (const name of names) {
    if (typeof name === 'bigint' || typeof name === 'number') {
      value |= toBigInt(name);
      continue;
    }
    const flag = PermissionFlagsBits[name];
    if (flag === undefined) {
      throw new DiscordPermissionError(`Unknown permission name: ${name}`);
    }
    value |= flag;
  }
  return new PermissionsBitField(value);
}

/**
 * The permissions a tool needs that the bot does not currently have.
 * @param {import('discord.js').Guild} guild
 * @param {string} toolName
 * @returns {string[]} missing permission names
 */
function missingToolPermissions(guild, toolName) {
  const required = TOOL_PERMISSIONS[toolName] || [];
  if (!required.length) return [];
  const me = guild?.members?.me;
  if (!me) return required;
  return required.filter((name) => {
    const flag = PermissionFlagsBits[name];
    if (flag === undefined) return false;
    return !me.permissions.has(flag);
  });
}

/** A message that tells the user exactly where to grant a missing permission. */
function permissionFixHint(guild, missing = []) {
  if (!missing.length) return '';
  const roleName = guild?.members?.me?.roles?.highest?.name || "the bot's role";
  const names = missing.map((name) => PERMISSION_LABELS[name] || name).join(', ');
  return `Grant "${names}" to ${roleName} in Server Settings -> Roles -> ${roleName}.`;
}

/**
 * Assert the bot itself holds the required permissions in the guild.
 * @param {import('discord.js').Guild} guild
 * @param {bigint[]|string[]} required
 */
function assertBotPermissions(guild, required = []) {
  const me = guild?.members?.me;
  if (!me) {
    throw new DiscordPermissionError('Could not resolve the bot member in this guild.');
  }
  const needed = permissionsFromNames(required);
  const missing = needed
    .toArray()
    .filter((name) => !me.permissions.has(PermissionFlagsBits[name]));
  if (missing.length > 0) {
    throw new DiscordPermissionError(
      `The bot is missing the following Discord permission(s): ${missing.join(', ')}.`,
      { missing },
    );
  }
  return true;
}

/** True when the bot's highest role sits strictly above `role`. */
function botOutranksRole(guild, role) {
  const me = guild?.members?.me;
  if (!me || !role) return false;
  const highest = me.roles?.highest;
  if (!highest) return false;
  return highest.position > role.position;
}

/**
 * Assert the bot's highest role is strictly above the given role.
 * The bot can never touch a role that is equal to or above its own.
 */
function assertBotOutranksRole(guild, role) {
  if (!role) throw new NotFoundError('Role not found.');
  const me = guild?.members?.me;
  if (!me) throw new DiscordPermissionError('Could not resolve the bot member in this guild.');
  if (!botOutranksRole(guild, role)) {
    throw new DiscordPermissionError(
      `The bot's highest role must be above "${role.name}" to manage it.`,
      { roleId: role.id, botRolePosition: me.roles.highest.position, rolePosition: role.position },
    );
  }
  return true;
}

/** Assert the bot can act on a member (hierarchy + ban/kick permission). */
function assertBotOutranksMember(guild, member, required = []) {
  const me = guild?.members?.me;
  if (!me) throw new DiscordPermissionError('Could not resolve the bot member in this guild.');
  if (!member) throw new NotFoundError('Member not found.');
  if (member.id === me.id) {
    throw new DiscordPermissionError('The bot cannot act on itself.');
  }
  if (member.id === guild.ownerId) {
    throw new DiscordPermissionError('The bot cannot act on the server owner.');
  }
  const targetHighest = member.roles?.highest;
  const botHighest = me.roles?.highest;
  const targetPosition = targetHighest ? targetHighest.position : 0;
  const botPosition = botHighest ? botHighest.position : 0;
  if (targetPosition >= botPosition) {
    throw new DiscordPermissionError(
      `"${member.user.username}" has a role at or above the bot's highest role.`,
      { memberId: member.id },
    );
  }
  assertBotPermissions(guild, required);
  return true;
}

/** Assert the acting member (the human) outranks the target role. */
function assertActorOutranksRole(guild, actorMember, role) {
  if (!actorMember) return true;
  if (actorMember.id === guild.ownerId) return true; // the owner outranks everything
  if (!role) return true;
  const actorPosition = actorMember.roles?.highest?.position ?? 0;
  if (actorPosition <= role.position) {
    throw new DiscordPermissionError(
      `You do not outrank the role "${role.name}", so you cannot manage it.`,
      { roleId: role.id },
    );
  }
  return true;
}

/** Assert the acting member outranks the target member. */
function assertActorOutranksMember(guild, actorMember, targetMember) {
  if (!actorMember) return true;
  if (actorMember.id === guild.ownerId) return true;
  if (!targetMember) return true;
  if (targetMember.id === guild.ownerId) {
    throw new DiscordPermissionError('The server owner cannot be moderated.');
  }
  const actorPosition = actorMember.roles?.highest?.position ?? 0;
  const targetPosition = targetMember.roles?.highest?.position ?? 0;
  if (actorPosition <= targetPosition) {
    throw new DiscordPermissionError(
      `"${targetMember.user.username}" has a role at or above yours.`,
      { memberId: targetMember.id },
    );
  }
  return true;
}

/** A role is "privileged" when it carries dangerous permissions. */
function isPrivilegedRole(role) {
  const names = decodePermissions(role.permissions.bitfield);
  return names.some((name) => PRIVILEGED_PERMISSIONS.includes(name));
}

function privilegedPermissionsIn(role) {
  const names = decodePermissions(role.permissions.bitfield);
  return names.filter((name) => PRIVILEGED_PERMISSIONS.includes(name));
}

module.exports = {
  PERMISSION_NAMES,
  PERMISSION_LABELS,
  PRIVILEGED_PERMISSIONS,
  TOOL_PERMISSIONS,
  missingToolPermissions,
  permissionFixHint,
  decodePermissions,
  permissionsFromNames,
  assertBotPermissions,
  assertBotOutranksRole,
  assertBotOutranksMember,
  assertActorOutranksRole,
  assertActorOutranksMember,
  botOutranksRole,
  isPrivilegedRole,
  privilegedPermissionsIn,
};
