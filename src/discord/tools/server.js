'use strict';

/** Guild-wide settings, channel safety state and invite management. */

const { resolveChannel } = require('../resolve');
const { assertBotPermissions } = require('../permissions');
const { DiscordPermissionError, ValidationError } = require('../../core/errors');

const setServerName = {
  name: 'set_server_name',
  description: 'Rename the current Discord server. This guild-wide change requires confirmation.',
  mutating: true,
  securitySensitive: true,
  confirmationReason: 'the server name is a guild-wide setting',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 100, description: 'New server name.' },
      reason: { type: 'string', maxLength: 500, description: 'Reason shown in the audit log.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageGuild']);
    const previousName = guild.name;
    const name = args.name.trim();
    if (name.length < 2) throw new ValidationError('The server name must contain at least 2 characters.');
    if (previousName === name) {
      return { ok: true, skipped: true, message: `The server is already named "${name}".`, data: { name } };
    }

    const reason = args.reason || 'Server renamed by the Eternalz AI administrator.';
    await guild.setName(name, reason);
    const verified = await guild.fetch().catch(() => null);
    if (!verified || verified.name !== name) throw new Error('Discord did not confirm the server rename.');

    return {
      ok: true,
      message: `Renamed the server from "${previousName}" to "${verified.name}".`,
      data: { guildId: guild.id, previousName, name: verified.name },
      reversal: { kind: 'set_server_name', name: previousName },
    };
  },
};

const setChannelNsfw = {
  name: 'set_channel_nsfw',
  description:
    'Mark a text/announcement/forum channel as age-restricted (NSFW) or remove that restriction. Requires confirmation.',
  mutating: true,
  securitySensitive: true,
  confirmationReason: 'the age restriction of an existing channel would change',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name, mention or id.' },
      nsfw: { type: 'boolean', description: 'True enables the age restriction; false removes it.' },
      reason: { type: 'string', maxLength: 500, description: 'Reason shown in the audit log.' },
    },
    required: ['channel', 'nsfw'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);
    if (typeof channel.setNSFW !== 'function') {
      throw new ValidationError(`"${channel.name}" does not support an NSFW setting.`);
    }
    const previous = Boolean(channel.nsfw);
    if (previous === args.nsfw) {
      return {
        ok: true,
        skipped: true,
        message: `"${channel.name}" already has NSFW ${args.nsfw ? 'enabled' : 'disabled'}.`,
        data: { channelId: channel.id, nsfw: args.nsfw },
      };
    }

    const reason = args.reason || 'Channel age restriction updated by the Eternalz AI administrator.';
    await channel.setNSFW(args.nsfw, reason);
    const verified = await channel.fetch().catch(() => null);
    if (!verified || Boolean(verified.nsfw) !== args.nsfw) {
      throw new Error(`Discord did not confirm the NSFW change for "${channel.name}".`);
    }

    return {
      ok: true,
      message: `${args.nsfw ? 'Enabled' : 'Disabled'} the age restriction for "${channel.name}".`,
      data: { channelId: channel.id, channelName: channel.name, nsfw: args.nsfw },
      reversal: { kind: 'set_channel_nsfw', channel: channel.id, nsfw: previous },
    };
  },
};

const createInvite = {
  name: 'create_invite',
  description:
    'Create a new invite for a channel, with optional expiry, use limit and temporary membership. Requires confirmation because it grants server access.',
  mutating: true,
  securitySensitive: true,
  confirmationReason: 'a new invite would grant access to the server',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name, mention or id for the invite.' },
      maxAgeSeconds: {
        type: 'integer', minimum: 0, maximum: 604800, default: 86400,
        description: 'Lifetime in seconds, up to 7 days. Defaults to 24 hours; 0 means no expiry.',
      },
      maxUses: {
        type: 'integer', minimum: 0, maximum: 100, default: 0,
        description: 'Maximum uses (0-100). 0 means unlimited.',
      },
      temporary: {
        type: 'boolean', default: false,
        description: 'Temporary members are removed on disconnect unless they receive a role.',
      },
      reason: { type: 'string', maxLength: 500, description: 'Reason shown in the audit log.' },
    },
    required: ['channel'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['CreateInstantInvite']);
    const channel = resolveChannel(guild, args.channel);
    if (typeof channel.createInvite !== 'function') {
      throw new ValidationError(`"${channel.name}" cannot have invites.`);
    }
    const permissions = channel.permissionsFor?.(guild.members.me);
    if (permissions && !permissions.has(['ViewChannel', 'CreateInstantInvite'])) {
      throw new DiscordPermissionError(
        `The bot needs View Channel and Create Invite in "${channel.name}".`,
        { channelId: channel.id, missing: ['ViewChannel', 'CreateInstantInvite'] },
      );
    }

    const reason = args.reason || 'Invite created by the Eternalz AI administrator.';
    const invite = await channel.createInvite({
      maxAge: args.maxAgeSeconds,
      maxUses: args.maxUses,
      temporary: args.temporary,
      unique: true,
      reason,
    });
    if (!invite?.code) throw new Error('Discord did not return a usable invite.');

    return {
      ok: true,
      message: `Created invite ${invite.url || `https://discord.gg/${invite.code}`} for "${channel.name}".`,
      data: {
        code: invite.code,
        url: invite.url || `https://discord.gg/${invite.code}`,
        channelId: channel.id,
        maxAge: invite.maxAge ?? args.maxAgeSeconds,
        maxUses: invite.maxUses ?? args.maxUses,
        temporary: invite.temporary ?? args.temporary,
      },
      reversal: null,
      note: 'Revoke the invite manually in Server Settings if it is no longer needed.',
    };
  },
};

module.exports = [setServerName, setChannelNsfw, createInvite];
