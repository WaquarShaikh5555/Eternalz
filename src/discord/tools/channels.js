'use strict';

/**
 * Channel and category management tools.
 *
 * Every tool verifies the bot's own permissions and role hierarchy before it
 * touches the API, and returns a `reversal` payload where the change can be
 * undone by hand.
 */

const { ChannelType } = require('discord.js');
const { resolveChannel, resolveCategory, resolveRole, isCategory } = require('../resolve');
const { assertBotPermissions, assertBotOutranksRole } = require('../permissions');
const { NotFoundError, ValidationError } = require('../../core/errors');

const TYPE_BY_NAME = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  stage: ChannelType.GuildStageVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  text_news: ChannelType.GuildAnnouncement,
};

function channelTypeOf(name) {
  const key = String(name ?? 'text').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(TYPE_BY_NAME, key)) {
    throw new ValidationError(
      `Unknown channel type "${name}". Supported: ${Object.keys(TYPE_BY_NAME).join(', ')}.`,
    );
  }
  return TYPE_BY_NAME[key];
}

const createCategory = {
  name: 'create_category',
  description:
    'Create a new category (a top-level group of channels). Optionally position it relative to an existing category.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'Category name.' },
      position: { type: 'integer', minimum: 0, description: 'Position from the top (0 = first).' },
      positionAfter: {
        type: 'string',
        maxLength: 100,
        description: 'Name of an existing category to place this one directly after.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);

    const existing = guild.channels.cache.find(
      (c) =>
        isCategory(c) &&
        c.name.toLowerCase() === args.name.toLowerCase(),
    );
    if (existing) {
      return {
        ok: true,
        skipped: true,
        message: `Category "${existing.name}" already exists - not creating a duplicate.`,
        data: { id: existing.id, name: existing.name },
      };
    }

    let position;
    if (args.positionAfter) {
      const after = resolveCategory(guild, args.positionAfter);
      position = after.position + 1;
    } else if (typeof args.position === 'number') {
      position = args.position;
    }

    const created = await guild.channels.create({
      name: args.name,
      type: ChannelType.GuildCategory,
      position,
    });

    return {
      ok: true,
      message: `Created category "${created.name}".`,
      data: { id: created.id, name: created.name, type: 'category' },
      reversal: { kind: 'delete_channel', channel: created.id, note: 'Delete the category to undo.' },
    };
  },
};

const createChannel = {
  name: 'create_channel',
  description:
    'Create a new text, voice, stage, announcement or forum channel, optionally inside a category. Set `private` to true to create it with only the requesting members able to see it.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'Channel name.' },
      type: {
        type: 'string',
        enum: ['text', 'voice', 'stage', 'announcement', 'forum'],
        description: 'Channel type. Defaults to text.',
      },
      category: {
        type: 'string',
        maxLength: 100,
        description: 'Name (or id) of the category to create the channel in.',
      },
      topic: { type: 'string', maxLength: 1000, description: 'Channel topic.' },
      slowmode: {
        type: 'integer',
        minimum: 0,
        maximum: 21600,
        description: 'Slowmode in seconds (0 = off).',
      },
      private: {
        type: 'boolean',
        description: 'When true the channel is created with restricted access for the listed members.',
      },
      members: {
        type: 'array',
        maxItems: 50,
        items: { type: 'string', maxLength: 120 },
        description: 'Usernames or user ids who should be able to see a private channel.',
      },
      position: { type: 'integer', minimum: 0, description: 'Position within the category.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);

    const type = channelTypeOf(args.type);
    let parent = null;
    if (args.category) parent = resolveCategory(guild, args.category);

    const duplicate = guild.channels.cache.find(
      (c) =>
        c.name.toLowerCase() === args.name.toLowerCase() &&
        (c.parentId || null) === (parent?.id || null),
    );
    if (duplicate) {
      return {
        ok: true,
        skipped: true,
        message: `Channel "${duplicate.name}" already exists in that location - not creating a duplicate.`,
        data: { id: duplicate.id, name: duplicate.name },
      };
    }

    const created = await guild.channels.create({
      name: args.name,
      type,
      topic: args.topic || undefined,
      rateLimitPerUser: typeof args.slowmode === 'number' ? args.slowmode : undefined,
      parent: parent?.id,
      position: typeof args.position === 'number' ? args.position : undefined,
    });

    const result = {
      ok: true,
      message: `Created ${args.type || 'text'} channel "${created.name}".`,
      data: { id: created.id, name: created.name, type: created.type, parentId: created.parentId },
      reversal: { kind: 'delete_channel', channel: created.id, note: 'Delete the channel to undo.' },
    };

    if (args.private) {
      const { resolveMember } = require('../resolve');
      const targets = [];
      for (const raw of args.members || []) {
        const member = await resolveMember(guild, raw);
        targets.push(member);
      }
      await created.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: false,
        SendMessages: false,
      });
      for (const member of targets) {
        await created.permissionOverwrites.edit(member, {
          ViewChannel: true,
          SendMessages: true,
        });
      }
      result.message += ` (private: ${targets.length} member(s) granted access)`;
      result.data.private = true;
      result.data.privateMemberIds = targets.map((m) => m.id);
    }

    return result;
  },
};

const renameChannel = {
  name: 'rename_channel',
  description: 'Rename an existing channel or category.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Current channel name or id.' },
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'The new name.' },
    },
    required: ['channel', 'name'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);
    const previousName = channel.name;

    const clash = guild.channels.cache.find(
      (c) => c.id !== channel.id && c.name.toLowerCase() === args.name.toLowerCase(),
    );
    if (clash) {
      throw new ValidationError(`A channel named "${args.name}" already exists.`);
    }

    await channel.setName(args.name);
    const verified = await channel.fetch().catch(() => null);
    if (!verified || verified.name !== args.name) {
      throw new Error(`Rename did not take effect for "${previousName}".`);
    }

    return {
      ok: true,
      message: `Renamed "${previousName}" to "${verified.name}".`,
      data: { id: channel.id, previousName, name: verified.name },
      reversal: { kind: 'rename_channel', channel: channel.id, name: previousName },
    };
  },
};

const setChannelTopic = {
  name: 'set_channel_topic',
  description: 'Set or clear the topic (description) of a channel.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      topic: { type: 'string', maxLength: 1000, description: 'The new topic. Empty string clears it.' },
    },
    required: ['channel', 'topic'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);
    const previousTopic = channel.topic || '';

    await channel.setTopic(args.topic);
    const verified = await channel.fetch().catch(() => null);
    if (!verified) throw new Error('Could not re-read the channel to verify the topic.');

    return {
      ok: true,
      message: `Updated the topic of "${verified.name}".`,
      data: { id: channel.id, topic: verified.topic || '' },
      reversal: { kind: 'set_channel_topic', channel: channel.id, topic: previousTopic },
    };
  },
};

const setChannelSlowmode = {
  name: 'set_channel_slowmode',
  description: 'Set the slowmode (per-user rate limit) of a text channel, in seconds.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      seconds: {
        type: 'integer',
        minimum: 0,
        maximum: 21600,
        description: 'Slowmode in seconds. 0 disables it.',
      },
    },
    required: ['channel', 'seconds'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);
    const previous = channel.rateLimitPerUser ?? 0;

    await channel.setRateLimitPerUser(args.seconds);
    const verified = await channel.fetch().catch(() => null);
    if (!verified) throw new Error('Could not re-read the channel to verify slowmode.');

    return {
      ok: true,
      message: `Slowmode for "${verified.name}" set to ${verified.rateLimitPerUser ?? 0}s.`,
      data: { id: channel.id, slowmode: verified.rateLimitPerUser ?? 0 },
      reversal: { kind: 'set_channel_slowmode', channel: channel.id, seconds: previous },
    };
  },
};

const moveChannel = {
  name: 'move_channel',
  description:
    'Move a channel into a different category, or change its position. Use category: null to move it to the top level (no category).',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      category: {
        type: 'string',
        maxLength: 100,
        description: 'Target category name or id. Use an empty string to remove the category.',
      },
      position: { type: 'integer', minimum: 0, description: 'New position inside the category.' },
    },
    required: ['channel'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);
    if (isCategory(channel)) {
      throw new ValidationError('Categories cannot be moved with this tool.');
    }

    const previousParentId = channel.parentId || null;
    const previousPosition = channel.position;

    let parent = null;
    if (args.category && String(args.category).trim() !== '') {
      parent = resolveCategory(guild, args.category);
    }

    await channel.setParent(parent?.id || null, {
      position: typeof args.position === 'number' ? args.position : undefined,
    });

    const verified = await channel.fetch().catch(() => null);
    if (!verified) throw new Error('Could not re-read the channel to verify the move.');

    return {
      ok: true,
      message: `Moved "${verified.name}"${parent ? ` into "${parent.name}"` : ' out of its category'}.`,
      data: { id: channel.id, parentId: verified.parentId || null, position: verified.position },
      reversal: {
        kind: 'move_channel',
        channel: channel.id,
        category: previousParentId,
        position: previousPosition,
      },
    };
  },
};

const deleteChannel = {
  name: 'delete_channel',
  description:
    'Permanently delete a channel or category. This cannot be undone by the bot. Requires explicit confirmation.',
  mutating: true,
  destructive: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel or category name or id.' },
    },
    required: ['channel'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);
    if (channel.id === guild.id) throw new ValidationError('Refusing to delete the server itself.');

    const name = channel.name;
    const id = channel.id;
    await channel.delete('Removed by the Eternalz AI administrator.');

    return {
      ok: true,
      message: `Deleted channel "${name}".`,
      data: { id, name },
      reversal: null,
      note: 'Deletion is not reversible by the bot.',
    };
  },
};

const setPermissionOverwrite = {
  name: 'set_permission_overwrite',
  description:
    'Create or update a permission overwrite on a channel for a role or a member. Use this to make a channel private to a staff role, to open a VIP lounge, or to restrict a channel. Requires explicit confirmation.',
  mutating: true,
  securitySensitive: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      target: {
        type: 'string',
        maxLength: 120,
        description: 'Role name/id, or a member username/id. A member id starts with "user:".',
      },
      allow: {
        type: 'array',
        maxItems: 40,
        items: { type: 'string', maxLength: 60 },
        description: 'Permission names to ALLOW, e.g. ["ViewChannel", "SendMessages"].',
      },
      deny: {
        type: 'array',
        maxItems: 40,
        items: { type: 'string', maxLength: 60 },
        description: 'Permission names to DENY, e.g. ["ViewChannel"].',
      },
    },
    required: ['channel', 'target', 'allow', 'deny'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);

    const { resolveMember } = require('../resolve');
    const raw = String(args.target).trim();
    let target;
    let targetType;
    if (raw.toLowerCase().startsWith('user:')) {
      target = await resolveMember(guild, raw.slice(5).trim());
      targetType = 'member';
    } else {
      target = resolveRole(guild, raw);
      targetType = 'role';
      assertBotOutranksRole(guild, target);
    }

    const { permissionsFromNames } = require('../permissions');
    const allow = permissionsFromNames(args.allow || []);
    const deny = permissionsFromNames(args.deny || []);

    const previous = channel.permissionOverwrites.cache.get(target.id);
    const previousAllow = previous ? [...previous.allow] : [];
    const previousDeny = previous ? [...previous.deny] : [];

    await channel.permissionOverwrites.edit(target, { allow, deny });

    const verified = await channel.fetch().catch(() => null);
    if (!verified) throw new Error('Could not re-read the channel to verify the overwrite.');

    return {
      ok: true,
      message: `Updated permissions for ${targetType} "${target.name}" on "${channel.name}".`,
      data: {
        channelId: channel.id,
        targetId: target.id,
        targetName: target.name,
        targetType,
        allow: [...allow],
        deny: [...deny],
      },
      reversal: {
        kind: 'set_permission_overwrite',
        channel: channel.id,
        target: target.id,
        targetType,
        allow: previousAllow,
        deny: previousDeny,
      },
    };
  },
};

const deletePermissionOverwrite = {
  name: 'delete_permission_overwrite',
  description:
    'Remove a permission overwrite from a channel, restoring the default inheritance for that role or member. Requires explicit confirmation.',
  mutating: true,
  securitySensitive: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      target: {
        type: 'string',
        maxLength: 120,
        description: 'Role name/id, or "user:<id>".',
      },
    },
    required: ['channel', 'target'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageChannels']);
    const channel = resolveChannel(guild, args.channel);

    const { resolveMember } = require('../resolve');
    const raw = String(args.target).trim();
    let target;
    let targetType;
    if (raw.toLowerCase().startsWith('user:')) {
      target = await resolveMember(guild, raw.slice(5).trim());
      targetType = 'member';
    } else {
      target = resolveRole(guild, args.role || args.target);
      targetType = 'role';
      assertBotOutranksRole(guild, target);
    }

    const existing = channel.permissionOverwrites.cache.get(target.id);
    if (!existing) {
      throw new NotFoundError(`"${target.name}" has no permission overwrite on "${channel.name}".`);
    }
    const previousAllow = [...existing.allow];
    const previousDeny = [...existing.deny];

    await channel.permissionOverwrites.delete(target);

    return {
      ok: true,
      message: `Removed the permission overwrite for ${targetType} "${target.name}" on "${channel.name}".`,
      data: { channelId: channel.id, targetId: target.id, targetName: target.name, targetType },
      reversal: {
        kind: 'set_permission_overwrite',
        channel: channel.id,
        target: target.id,
        targetType,
        allow: previousAllow,
        deny: previousDeny,
      },
    };
  },
};

module.exports = [
  createCategory,
  createChannel,
  renameChannel,
  setChannelTopic,
  setChannelSlowmode,
  moveChannel,
  deleteChannel,
  setPermissionOverwrite,
  deletePermissionOverwrite,
];
