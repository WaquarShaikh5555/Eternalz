'use strict';

/**
 * Community infrastructure tools: staff-role based support channels and a
 * simple onboarding role.
 *
 * These build *new* resources, so they are auto-executable. Note that making a
 * channel private necessarily creates permission overwrites - that is fine for
 * a brand new channel because no existing access is changed.
 */

const { ChannelType } = require('discord.js');
const { resolveCategory, resolveRole } = require('../resolve');
const { assertBotPermissions, assertBotOutranksRole } = require('../permissions');
const { ValidationError } = require('../../core/errors');

const createTicketChannel = {
  name: 'create_ticket_channel',
  description:
    'Create a private support/ticket channel for one member and give a staff role access. Use this to set up a tickets or support system.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'Channel name.' },
      category: {
        type: 'string',
        maxLength: 100,
        description: 'Category to create it in. Use "create_category" first if it does not exist.',
      },
      staffRole: {
        type: 'string',
        maxLength: 120,
        description: 'Role that keeps access to the ticket channel (e.g. "Support Team").',
      },
      member: {
        type: 'string',
        maxLength: 120,
        description: 'Member who owns the ticket and can see it.',
      },
      topic: { type: 'string', maxLength: 1000, description: 'Channel topic.' },
    },
    required: ['name', 'staffRole'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels', 'ManageRoles']);
    const staffRole = resolveRole(guild, args.staffRole);
    assertBotOutranksRole(guild, staffRole);

    let parent = null;
    if (args.category) parent = resolveCategory(guild, args.category);

    const duplicate = guild.channels.cache.find(
      (c) => c.name.toLowerCase() === args.name.toLowerCase(),
    );
    if (duplicate) {
      return {
        ok: true,
        skipped: true,
        message: `A channel named "${duplicate.name}" already exists - not creating a duplicate.`,
        data: { id: duplicate.id, name: duplicate.name },
      };
    }

    const created = await guild.channels.create({
      name: args.name,
      type: ChannelType.GuildText,
      topic: args.topic || undefined,
      parent: parent?.id,
    });

    await created.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
      SendMessages: false,
    });
    await created.permissionOverwrites.edit(staffRole, {
      ViewChannel: true,
      SendMessages: true,
      ManageChannels: true,
    });

    let memberName = null;
    if (args.member) {
      const { resolveMember } = require('../resolve');
      const member = await resolveMember(guild, args.member);
      memberName = member.user.username;
      await created.permissionOverwrites.edit(member, {
        ViewChannel: true,
        SendMessages: true,
      });
    }

    return {
      ok: true,
      message: `Created the ticket channel "${created.name}" with "${staffRole.name}" access.`,
      data: {
        id: created.id,
        name: created.name,
        staffRoleId: staffRole.id,
        memberName,
      },
      reversal: { kind: 'delete_channel', channel: created.id, note: 'Delete the ticket channel to undo.' },
    };
  },
};

const setOnboardingRole = {
  name: 'set_onboarding_role',
  description:
    'Store the role that is automatically granted to new members (the onboarding / member role). The welcome message posts when a member joins.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      role: { type: 'string', maxLength: 120, description: 'Role name or id for new members.' },
    },
    required: ['role'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild, storage } = ctx;
    const role = resolveRole(guild, args.role);
    const previous = await storage.getSetting(guild.id, 'onboardingRole');
    const value = { roleId: role.id, roleName: role.name, updatedAt: Date.now() };
    await storage.setSetting(guild.id, 'onboardingRole', value);

    return {
      ok: true,
      message: `New members will now receive the role "${role.name}".`,
      data: value,
      reversal: { kind: 'set_onboarding_role', guild: guild.id, config: previous || null },
    };
  },
};

const setServerRules = {
  name: 'set_server_rules',
  description:
    'Create (or update) a #rules channel with the given rules text. Use this to publish the rules of the server.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 1800, description: 'The rules text.' },
      channel: {
        type: 'string',
        maxLength: 120,
        description: 'Existing rules channel to update. Omit to create "rules".',
      },
      category: { type: 'string', maxLength: 100, description: 'Category for a newly created channel.' },
    },
    required: ['content'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels', 'SendMessages']);

    let channel = null;
    let created = false;
    if (args.channel) {
      const { resolveChannel } = require('../resolve');
      channel = resolveChannel(guild, args.channel);
    } else {
      const existing = guild.channels.cache.find(
        (c) => c.name.toLowerCase() === 'rules' && c.type === ChannelType.GuildText,
      );
      if (existing) {
        channel = existing;
      } else {
        let parent = null;
        if (args.category) parent = resolveCategory(guild, args.category);
        channel = await guild.channels.create({
          name: 'rules',
          type: ChannelType.GuildText,
          topic: 'Server rules - please read them.',
          parent: parent?.id,
        });
        created = true;
      }
    }

    if (!channel.isTextBased() || channel.isDMBased?.()) {
      throw new ValidationError(`"${channel.name}" is not a text channel.`);
    }

    const previousMessages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
    await channel.send({ content: args.content });
    await channel.setTopic('Server rules - please read them.');

    return {
      ok: true,
      message: `${created ? 'Created' : 'Updated'} the rules in "${channel.name}".`,
      data: { channelId: channel.id, channelName: channel.name, created },
      reversal: {
        kind: 'delete_channel',
        channel: channel.id,
        note: created
          ? 'The channel was newly created - delete it to undo.'
          : 'The previous rules message must be removed manually.',
        previousMessageId: previousMessages?.first()?.id || null,
      },
    };
  },
};

module.exports = [createTicketChannel, setOnboardingRole, setServerRules];
