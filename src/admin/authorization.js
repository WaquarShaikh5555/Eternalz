'use strict';

/**
 * Authorisation for AI administration.
 *
 * Authorisation is enforced in application code, in two places:
 *   1. BEFORE any call to the AI provider  (src/admin/service.js)
 *   2. AGAIN before any action is executed (src/admin/executor.js)
 *
 * Discord's own permission system is not sufficient for this: the bot's token
 * carries whatever permissions the bot role was granted, which is normally a
 * lot. The rules below are about *who is allowed to ask the bot to act*, not
 * about what the bot is allowed to do.
 */

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { AuthorizationError } = require('../core/errors');
const { hasGuildAdminGrant } = require('./grants');

function configuredUsers(config) {
  return Array.isArray(config.aiAdminUserIds) ? config.aiAdminUserIds : [];
}

function configuredRoles(config) {
  return Array.isArray(config.aiAdminRoleIds) ? config.aiAdminRoleIds : [];
}

/** Prefer the fresh member supplied by the interaction, then the guild cache. */
function resolveMember(guild, userId, suppliedMember = null) {
  const suppliedId = suppliedMember?.user?.id || suppliedMember?.id;
  if (suppliedMember && suppliedId === userId) return suppliedMember;
  return guild.members?.cache?.get(userId) || null;
}

/**
 * Check the requester's own Discord permissions in a non-primary guild.
 * Handles both discord.js GuildMember objects and raw interaction members.
 */
function hasGuildManagementPermission(member) {
  const value = member?.permissions;
  if (value === undefined || value === null) return false;

  try {
    const permissions = typeof value.has === 'function'
      ? value
      : new PermissionsBitField(typeof value === 'string' ? BigInt(value) : value);
    return permissions.has(PermissionFlagsBits.Administrator)
      || permissions.has(PermissionFlagsBits.ManageGuild);
  } catch {
    return false;
  }
}

/**
 * @param {object} config
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {object} [suppliedMember] fresh interaction member, when available
 * @returns {boolean}
 */
function isGuildAdmin(config, guild, userId, suppliedMember = null) {
  if (!guild || !userId) return false;

  // Keep a primary guild configured for backwards compatibility, guild-scoped
  // status/audit commands and a safe single-server default.
  if (!config.discordGuildId) return false;

  const member = resolveMember(guild, userId, suppliedMember);
  const users = configuredUsers(config);
  const roles = configuredRoles(config);

  if (guild.id === config.discordGuildId) {
    // Existing single-server rules remain unchanged in the primary guild.
    if (guild.ownerId === userId) return true;
    if (users.includes(userId)) return true;
    if (roles.length && member && roles.some((roleId) => member.roles?.cache?.has(roleId))) {
      return true;
    }
    return false;
  }

  // Multi-guild access is deliberately opt-in and personal. Do not let every
  // owner/admin of every guild spend the bot operator's AI quota, and never
  // reuse primary-guild role IDs as authorization in another guild.
  if (!config.aiMultiGuild || !users.includes(userId)) return false;

  return guild.ownerId === userId || hasGuildManagementPermission(member);
}

/**
 * Throw unless the user may use AI administration in this guild.
 */
function assertGuildAdmin(config, guild, userId, suppliedMember = null) {
  if (!config.aiAdminEnabled) {
    throw new AuthorizationError('AI administration is currently disabled on this server.');
  }
  if (!config.discordGuildId) {
    throw new AuthorizationError(
      'AI administration is not configured: the bot owner has to set DISCORD_GUILD_ID so the bot knows which server it may administer.',
    );
  }
  if (guild.id !== config.discordGuildId && !config.aiMultiGuild) {
    throw new AuthorizationError('AI administration is restricted to the configured server.');
  }
  if (!isGuildAdmin(config, guild, userId, suppliedMember)) {
    if (guild.id !== config.discordGuildId) {
      throw new AuthorizationError(
        'In other servers, /ai requires a current-server /add-admin grant. Otherwise, configured AI administrators must own the server or have Administrator or Manage Server.',
      );
    }
    throw new AuthorizationError(
      'Only the server owner and explicitly configured administrators can use AI administration.',
    );
  }
  return true;
}

/** A short explanation of why a user was refused (used in audit logs). */
function describeRefusal(config, guild, userId, suppliedMember = null) {
  if (!config.aiAdminEnabled) return 'ai administration disabled';
  if (!guild) return 'not authorised';

  const isPrimaryGuild = guild.id === config.discordGuildId;
  if (!isPrimaryGuild && !config.aiMultiGuild) return 'wrong guild';
  if (isGuildAdmin(config, guild, userId, suppliedMember)) {
    if (guild.ownerId === userId) return 'guild owner';
    if (isPrimaryGuild && configuredRoles(config).length) {
      const member = resolveMember(guild, userId, suppliedMember);
      if (member && configuredRoles(config).some((roleId) => member.roles?.cache?.has(roleId))) {
        return 'administrator role';
      }
    }
    return 'configured administrator';
  }
  if (!isPrimaryGuild && configuredUsers(config).includes(userId)) {
    return 'missing server administrator permission';
  }
  return 'not authorised';
}

/**
 * Storage-aware variants used by the live command pipeline. Environment and
 * role-based rules stay synchronous for existing consumers; a persisted grant
 * is additive and can never widen access beyond the enabled guild scope.
 */
async function isGuildAdminWithGrants(config, storage, guild, userId, suppliedMember = null) {
  if (isGuildAdmin(config, guild, userId, suppliedMember)) return true;
  if (!config.aiAdminEnabled || !config.discordGuildId || !guild || !userId) return false;
  if (guild.id !== config.discordGuildId && !config.aiMultiGuild) return false;
  return hasGuildAdminGrant(storage, guild.id, userId);
}

async function assertGuildAdminWithGrants(config, storage, guild, userId, suppliedMember = null) {
  try {
    assertGuildAdmin(config, guild, userId, suppliedMember);
    return true;
  } catch (err) {
    if (!(err instanceof AuthorizationError)) throw err;
    if (!config.aiAdminEnabled || !config.discordGuildId) throw err;
    if (guild?.id !== config.discordGuildId && !config.aiMultiGuild) throw err;
    if (guild && await hasGuildAdminGrant(storage, guild.id, userId)) return true;
    throw err;
  }
}

module.exports = {
  isGuildAdmin,
  assertGuildAdmin,
  isGuildAdminWithGrants,
  assertGuildAdminWithGrants,
  describeRefusal,
  hasGuildManagementPermission,
};
