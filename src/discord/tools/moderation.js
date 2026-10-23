'use strict';

/**
 * Moderation tools: ban and kick.
 *
 * Both are always classified as high-risk and therefore always require an
 * explicit confirmation before they are executed.
 */

const { resolveMember } = require('../resolve');
const { assertBotPermissions, assertBotOutranksMember, assertActorOutranksMember } =
  require('../permissions');
const { ValidationError } = require('../../core/errors');

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

module.exports = [banMember, kickMember];
