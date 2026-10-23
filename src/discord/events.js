'use strict';

/**
 * Discord event handlers.
 *
 * The welcome / onboarding feature is configured through the AI tools
 * (`set_welcome_channel`, `set_onboarding_role`). This module is what makes
 * those settings actually happen when somebody joins the server.
 */

const { ChannelType } = require('discord.js');

/** Replace the placeholders the AI used in the welcome message. */
function renderWelcome(template, { user, guild }) {
  return String(template || '')
    .replaceAll('{user}', `<@${user.id}>`)
    .replaceAll('{username}', user.username)
    .replaceAll('{server}', guild.name)
    .replaceAll('{serverId}', guild.id);
}

/**
 * Handle a new member joining.
 */
async function handleGuildMemberAdd(member, runtime) {
  const { guild, config, storage, logger } = runtime;
  if (!guild) return;
  if (config.discordGuildId && guild.id !== config.discordGuildId) return;
  if (member.user.bot) return;

  try {
    const welcome = await storage.getSetting(guild.id, 'welcome');
    const onboarding = await storage.getSetting(guild.id, 'onboardingRole');

    // 1. Give the onboarding role, if one is configured and the bot may.
    if (onboarding?.roleId) {
      const role = guild.roles.cache.get(onboarding.roleId);
      const me = guild.members?.me;
      if (role && me && me.roles.highest && me.roles.highest.position > role.position) {
        await member.roles.add(role, 'Eternalz onboarding role').catch((err) => {
          logger?.warn?.('events: could not give the onboarding role', { reason: err.message });
        });
      } else if (role) {
        logger?.warn?.('events: the bot cannot give the onboarding role (role hierarchy)');
      }
    }

    // 2. Post the welcome message.
    if (!welcome?.channelId || !welcome?.message) return;

    const channel = guild.channels.cache.get(welcome.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      logger?.warn?.('events: the configured welcome channel no longer exists', {
        channelId: welcome.channelId,
      });
      return;
    }
    if (!channel.permissionsFor?.(guild.members?.me)?.has(['ViewChannel', 'SendMessages'])) {
      logger?.warn?.('events: the bot cannot send messages in the welcome channel');
      return;
    }

    const content = renderWelcome(welcome.message, { user: member.user, guild });
    await channel.send({ content });
    logger?.info?.('events: welcome message sent', { memberId: member.id });
  } catch (err) {
    logger?.warn?.('events: failed to welcome a new member', { reason: err.message });
  }
}

/**
 * Register the event handlers on the client.
 */
function registerEvents(client, runtime) {
  client.on('guildMemberAdd', (member) => {
    handleGuildMemberAdd(member, runtime).catch(() => {});
  });
}

module.exports = { registerEvents, handleGuildMemberAdd, renderWelcome };
