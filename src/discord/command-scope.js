'use strict';

/**
 * Decide whether a command belongs in the primary guild's registration set.
 * `/ai` opts into global registration only when multi-guild mode is enabled;
 * status and audit remain primary-guild commands. Authorisation is still
 * enforced in application code regardless of where a command is registered.
 */
function shouldRegisterInTargetGuild(command, config) {
  if (!command.guildOnly || !config.discordGuildId) return false;
  return !(config.aiMultiGuild && command.multiGuild === true);
}

module.exports = { shouldRegisterInTargetGuild };
