'use strict';

/**
 * Messaging tools: announcements, embeds and welcome configuration.
 *
 * Messages are only ever sent when an authorised administrator explicitly
 * asked for them, and the tool never reads or repeats message content from
 * other channels.
 */

const { resolveChannel } = require('../resolve');
const { assertBotPermissions } = require('../permissions');
const { ValidationError } = require('../../core/errors');

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function parseColour(value, fallback = 0x5865f2) {
  if (value === undefined || value === null || value === '') return fallback;
  const str = String(value).trim();
  if (!HEX_RE.test(str)) throw new ValidationError(`"${value}" is not a valid hex colour.`);
  return parseInt(str.replace('#', ''), 16);
}

const sendAnnouncement = {
  name: 'send_announcement',
  description:
    'Send an announcement message (optionally as a rich embed) to a channel. Only send this when the request explicitly asks for a message to be posted.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      content: { type: 'string', minLength: 1, maxLength: 2000, description: 'Message body.' },
      title: { type: 'string', maxLength: 256, description: 'Embed title.' },
      description: { type: 'string', maxLength: 3000, description: 'Embed description.' },
      color: { type: 'string', maxLength: 7, description: 'Embed colour as hex.' },
      footer: { type: 'string', maxLength: 2048, description: 'Embed footer.' },
    },
    required: ['channel', 'content'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['SendMessages', 'EmbedLinks']);
    const channel = resolveChannel(guild, args.channel);
    if (!channel.isTextBased() || channel.isDMBased?.()) {
      throw new ValidationError(`"${channel.name}" is not a text channel.`);
    }

    const embeds = [];
    if (args.title || args.description || args.color || args.footer) {
      const embed = {};
      if (args.title) embed.title = args.title;
      if (args.description) embed.description = args.description;
      if (args.color) embed.color = parseColour(args.color);
      if (args.footer) embed.footer = { text: args.footer };
      embeds.push(embed);
    }

    const sent = await channel.send({ content: args.content, embeds: embeds.length ? embeds : undefined });

    return {
      ok: true,
      message: `Posted a message in "${channel.name}".`,
      data: { channelId: channel.id, channelName: channel.name, messageId: sent?.id || null },
      reversal: {
        kind: 'delete_message',
        channel: channel.id,
        messageId: sent?.id || null,
        note: sent?.id ? 'Delete the message to undo.' : null,
      },
    };
  },
};

const setWelcomeChannel = {
  name: 'set_welcome_channel',
  description:
    'Configure the welcome message the bot posts when a new member joins. Stores the configuration for this server.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel that receives the welcome message.' },
      message: {
        type: 'string',
        maxLength: 1000,
        description: 'Welcome text. Use {user} for the member mention and {server} for the server name.',
      },
      role: {
        type: 'string',
        maxLength: 120,
        description: 'Optional role automatically given to new members.',
      },
    },
    required: ['channel', 'message'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild, storage } = ctx;
    assertBotPermissions(guild, ['SendMessages', 'EmbedLinks']);
    const channel = resolveChannel(guild, args.channel);
    if (!channel.isTextBased() || channel.isDMBased?.()) {
      throw new ValidationError(`"${channel.name}" is not a text channel.`);
    }

    let roleId = null;
    if (args.role) {
      const { resolveRole } = require('../resolve');
      const role = resolveRole(guild, args.role);
      roleId = role.id;
    }

    const previous = await storage.getSetting(guild.id, 'welcome');
    const config = {
      channelId: channel.id,
      channelName: channel.name,
      message: args.message,
      roleId,
      updatedAt: Date.now(),
    };
    await storage.setSetting(guild.id, 'welcome', config);

    return {
      ok: true,
      message: `Welcome messages are now posted in "${channel.name}".`,
      data: config,
      reversal: previous
        ? { kind: 'set_welcome', guild: guild.id, config: previous }
        : { kind: 'set_welcome', guild: guild.id, config: null },
    };
  },
};

module.exports = [sendAnnouncement, setWelcomeChannel];
