'use strict';

/**
 * Moderation tools: ban and kick.
 *
 * Both are always classified as high-risk and therefore always require an
 * explicit confirmation before they are executed.
 */

const { resolveChannel, resolveMember } = require('../resolve');
const { assertBotPermissions, assertBotOutranksMember, assertActorOutranksMember } =
  require('../permissions');
const { NotFoundError, ValidationError } = require('../../core/errors');

const banMember = {
  name: 'ban_member',
  description:
    'Ban a member from the server. This is a serious, hard-to-reverse action and always requires explicit confirmation.',
  mutating: true,
  destructive: true,
  parameters: {
    type: 'object',
    properties: {
      member: { type: 'string', maxLength: 120, description: 'Username, display name or user id.' },
      reason: { type: 'string', maxLength: 500, description: 'Reason shown in the audit log.' },
      deleteMessageDays: {
        type: 'integer',
        minimum: 0,
        maximum: 7,
        description: 'How many days of the member\'s recent messages to delete (0-7).',
      },
    },
    required: ['member'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['BanMembers']);
    const member = await resolveMember(guild, args.member);
    assertBotOutranksMember(guild, member, ['BanMembers']);
    if (ctx.actorMember) assertActorOutranksMember(guild, ctx.actorMember, member);

    // `User#bot` is a boolean property in discord.js v14.
    if (member.user.bot) {
      throw new ValidationError('Refusing to ban a bot account.');
    }

    const reason = args.reason || 'Banned by the Eternalz AI administrator.';
    const days = typeof args.deleteMessageDays === 'number' ? args.deleteMessageDays : 0;

    await member.ban({ reason, deleteMessageSeconds: days * 24 * 60 * 60 });

    return {
      ok: true,
      message: `Banned ${member.user.username}.`,
      data: { memberId: member.id, memberName: member.user.username, reason, deleteMessageDays: days },
      reversal: { kind: 'unban', member: member.id, note: 'Unban the user manually to undo.' },
      note: 'Bans cannot be undone by the bot; an administrator must unban the user.',
    };
  },
};

const kickMember = {
  name: 'kick_member',
  description:
    'Kick a member from the server. The member can rejoin with an invite. Always requires explicit confirmation.',
  mutating: true,
  destructive: true,
  parameters: {
    type: 'object',
    properties: {
      member: { type: 'string', maxLength: 120, description: 'Username, display name or user id.' },
      reason: { type: 'string', maxLength: 500, description: 'Reason shown in the audit log.' },
    },
    required: ['member'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['KickMembers']);
    const member = await resolveMember(guild, args.member);
    assertBotOutranksMember(guild, member, ['KickMembers']);
    if (ctx.actorMember) assertActorOutranksMember(guild, ctx.actorMember, member);

    const reason = args.reason || 'Kicked by the Eternalz AI administrator.';
    await member.kick(reason);

    return {
      ok: true,
      message: `Kicked ${member.user.username}.`,
      data: { memberId: member.id, memberName: member.user.username, reason },
      reversal: { kind: 'reinvite', member: member.id, note: 'Re-invite the user manually to undo.' },
      note: 'Kicks cannot be undone by the bot; a new invite is needed.',
    };
  },
};

const timeoutMember = {
  name: 'timeout_member',
  description:
    'Temporarily stop a member from talking (Discord "timeout", also called a communication timeout). Use this instead of kicking when the member should be able to come back later. Requires explicit confirmation.',
  mutating: true,
  destructive: true,
  parameters: {
    type: 'object',
    properties: {
      member: { type: 'string', maxLength: 120, description: 'Username, display name or user id.' },
      minutes: {
        type: 'integer',
        minimum: 1,
        maximum: 40320,
        description: 'How long the timeout lasts, in minutes (1 to 40320 = 28 days).',
      },
      reason: { type: 'string', maxLength: 500, description: 'Reason shown in the audit log.' },
    },
    required: ['member', 'minutes'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ModerateMembers']);
    const member = await resolveMember(guild, args.member);
    assertBotOutranksMember(guild, member, ['ModerateMembers']);
    if (ctx.actorMember) assertActorOutranksMember(guild, ctx.actorMember, member);

    if (member.user.bot) {
      throw new ValidationError('Refusing to time out a bot account.');
    }
    if (!member.moderatable) {
      throw new ValidationError(`The bot cannot time out "${member.user.username}".`);
    }

    const ms = Math.round(args.minutes * 60_000);
    const reason = args.reason || 'Timed out by the Eternalz AI administrator.';
    await member.timeout(ms, reason);

    const verified = await member.fetch().catch(() => null);
    if (verified && verified.communicationDisabledUntilTimestamp
        && verified.communicationDisabledUntilTimestamp <= Date.now()) {
      throw new Error('The timeout did not take effect.');
    }

    return {
      ok: true,
      message: `Timed out ${member.user.username} for ${args.minutes} minute(s).`,
      data: { memberId: member.id, memberName: member.user.username, minutes: args.minutes },
      reversal: {
        kind: 'clear_timeout',
        member: member.id,
        note: 'Clear the timeout manually to undo.',
      },
      note: 'Timeouts end automatically; no rollback is needed.',
    };
  },
};

const unbanMember = {
  name: 'unban_member',
  description:
    'Lift a ban and let a user back into the server. Use this when a ban was a mistake.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      member: {
        type: 'string',
        maxLength: 120,
        description: 'The banned user id, or their username.',
      },
      reason: { type: 'string', maxLength: 500, description: 'Reason recorded in the audit log.' },
    },
    required: ['member'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['BanMembers']);
    const reason = args.reason || 'Unbanned by the Eternalz AI administrator.';

    const raw = String(args.member).trim();
    let userId = /^\d{15,25}$/.test(raw) ? raw : null;

    // Look up the ban list first: it confirms the ban really exists and it
    // also lets us accept a username instead of an id.
    const bans = await guild.bans.fetch().catch(() => null);
    if (bans && !userId && bans.has(raw)) {
      userId = raw;
    }
    if (!userId) {
      const match = bans
        ? bans.find((ban) => ban.user.username.toLowerCase() === raw.toLowerCase())
        : null;
      if (!match) {
        throw new NotFoundError(
          `No banned user named "${raw}" was found. Use the numeric user id to unban a user.`,
        );
      }
      userId = match.user.id;
    }

    await guild.bans.remove(userId, reason);
    return {
      ok: true,
      message: `Unbanned the user ${userId}.`,
      data: { memberId: userId },
      reversal: { kind: 'ban_member', member: userId, note: 'Ban the user again to undo.' },
    };
  },
};

const deleteMessages = {
  name: 'delete_messages',
  description:
    'Bulk delete recent messages in a channel (up to 100 at a time). Use this to clean up spam or to remove a batch of unwanted messages. Requires explicit confirmation.',
  mutating: true,
  destructive: true,
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 120, description: 'Channel name or id.' },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'How many of the most recent messages to delete (1-100).',
      },
    },
    required: ['channel', 'count'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const { guild } = ctx;
    assertBotPermissions(guild, ['ManageMessages', 'ReadMessageHistory']);
    const channel = resolveChannel(guild, args.channel);
    if (!channel.isTextBased() || channel.isDMBased?.()) {
      throw new ValidationError(`"${channel.name}" is not a text channel.`);
    }

    const deleted = await channel.bulkDelete(args.count, true).catch((err) => {
      throw new ValidationError(`Discord refused the bulk delete: ${err.message}`);
    });

    return {
      ok: true,
      message: `Deleted ${deleted.size ?? 0} message(s) from "${channel.name}".`,
      data: { channelId: channel.id, channelName: channel.name, deleted: deleted.size ?? 0 },
      reversal: null,
      note: 'Deleted messages cannot be restored by the bot.',
    };
  },
};

module.exports = [banMember, kickMember, timeoutMember, unbanMember, deleteMessages];
