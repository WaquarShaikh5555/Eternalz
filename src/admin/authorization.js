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

const { AuthorizationError } = require('../core/errors');

/**
 * @param {object} config
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @returns {boolean}
 */
function isGuildAdmin(config, guild, userId) {
  if (!guild || !userId) return false;

  // 1. The configured target guild is the only guild where this works.
  //    Without a target guild nothing is authorised at all.
  if (!config.discordGuildId) return false;
  if (guild.id !== config.discordGuildId) return false;

  // 2. The guild owner is always authorised.
  if (guild.ownerId === userId) return true;

  // 3. Explicitly configured administrator ids.
  if (config.aiAdminUserIds.includes(userId)) return true;

  // 4. Optional role-based administrators (opt-in, supplements the list above).
  if (config.aiAdminRoleIds.length) {
    const member = guild.members.cache.get(userId);
    if (member && config.aiAdminRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
      return true;
    }
  }

  return false;
}

/**
 * Throw unless the user may use AI administration in this guild.
 */
function assertGuildAdmin(config, guild, userId) {
  if (!config.aiAdminEnabled) {
    throw new AuthorizationError('AI administration is currently disabled on this server.');
  }
  if (!config.discordGuildId) {
    throw new AuthorizationError(
      'AI administration is not configured: the bot owner has to set DISCORD_GUILD_ID so the bot knows which server it may administer.',
    );
  }
  if (guild.id !== config.discordGuildId) {
    throw new AuthorizationError('AI administration is restricted to the configured server.');
  }
  if (!isGuildAdmin(config, guild, userId)) {
    throw new AuthorizationError(
      'Only the server owner and explicitly configured administrators can use AI administration.',
    );
  }
  return true;
}

/** A short explanation of why a user was refused (used in audit logs). */
function describeRefusal(config, guild, userId) {
  if (!config.aiAdminEnabled) return 'ai administration disabled';
  if (config.discordGuildId && guild?.id !== config.discordGuildId) return 'wrong guild';
  if (guild?.ownerId === userId) return 'guild owner';
  if (config.aiAdminUserIds.includes(userId)) return 'configured administrator';
  if (
    config.aiAdminRoleIds.length &&
    guild?.members?.cache?.get(userId) &&
    config.aiAdminRoleIds.some((roleId) => guild.members.cache.get(userId).roles.cache.has(roleId))
  ) {
    return 'administrator role';
  }
  return 'not authorised';
}

module.exports = { isGuildAdmin, assertGuildAdmin, describeRefusal };
