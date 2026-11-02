'use strict';

/** Validated member-administration tools beyond roles and timeout/kick/ban. */

const { ChannelType } = require('discord.js');
const { resolveChannel, resolveMember } = require('../resolve');
const {
  assertBotPermissions,
  assertBotOutranksMember,
  assertActorOutranksMember,
} = require('../permissions');
const { DiscordPermissionError, ValidationError } = require('../../core/errors');

const memberArgument = {
  type: 'string',
  maxLength: 120,
  description: 'Username, display name, Discord mention or user id.',
};
const reasonArgument = {
  type: 'string',
  maxLength: 500,
  description: 'Reason shown in the audit log.',
};

async function manageableMember(ctx, input, permission, { allowActorSelf = false, allowBotSelf = false } = {}) {
  const { guild } = ctx;
  const member = await resolveMember(guild, input);
  if (allowBotSelf && member.id === guild.members?.me?.id) {
    // Discord uses ChangeNickname (not role hierarchy) for a bot editing its
    // own nickname. Other member administration keeps the strict checks.
    assertBotPermissions(guild, ['ChangeNickname']);
    return member;
  }
  assertBotPermissions(guild, [permission]);
  assertBotOutranksMember(guild, member, [permission]);
  if (ctx.actorMember && (!allowActorSelf || ctx.actorMember.id !== member.id)) {
    assertActorOutranksMember(guild, ctx.actorMember, member);
  }
  return member;
}

const setMemberNickname = {
  name: 'set_member_nickname',
  description:
    'Change or clear a member nickname. Use an empty nickname to clear it. Hierarchy is checked before editing.',
  mutating: true,
  parameters: {
    type: 'object',
    properties: {
      member: memberArgument,
      nickname: { type: 'string', maxLength: 32, description: 'New nickname, or empty to clear.' },
      reason: reasonArgument,
    },
    required: ['member', 'nickname'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const member = await manageableMember(ctx, args.member, 'ManageNicknames', {
      allowActorSelf: true,
      allowBotSelf: true,
    });
    const previous = member.nickname || '';
    const nickname = args.nickname.trim();
    if (previous === nickname) {
      return {
        ok: true,
        skipped: true,
        message: `${member.user.username} already has that nickname.`,
        data: { memberId: member.id, nickname },
      };
    }

    const reason = args.reason || 'Nickname updated by the Eternalz AI administrator.';
    await member.setNickname(nickname || null, reason);
    const verified = await member.fetch().catch(() => null);
    if (!verified || (verified.nickname || '') !== nickname) {
      throw new Error(`The nickname change for ${member.user.username} did not take effect.`);
    }

    return {
      ok: true,
      message: nickname
        ? `Changed ${member.user.username}'s nickname to "${nickname}".`
        : `Cleared ${member.user.username}'s nickname.`,
      data: { memberId: member.id, memberName: member.user.username, nickname },
      reversal: { kind: 'set_member_nickname', member: member.id, nickname: previous },
    };
  },
};

const moveMemberVoice = {
  name: 'move_member_voice',
  description:
    'Move a connected member to another voice or stage channel. Requires confirmation and the Move Members permission.',
  mutating: true,
  moderation: true,
  parameters: {
    type: 'object',
    properties: {
      member: memberArgument,
      channel: { type: 'string', maxLength: 120, description: 'Destination voice/stage channel name or id.' },
      reason: reasonArgument,
    },
    required: ['member', 'channel'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const member = await manageableMember(ctx, args.member, 'MoveMembers');
    const channel = resolveChannel(ctx.guild, args.channel);
    const voiceType = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
    if (!voiceType && !channel.isVoiceBased?.()) {
      throw new ValidationError(`"${channel.name}" is not a voice or stage channel.`);
    }
    const permissions = channel.permissionsFor?.(ctx.guild.members.me);
    if (permissions && !permissions.has(['ViewChannel', 'Connect', 'MoveMembers'])) {
      throw new DiscordPermissionError(
        `The bot needs View Channel, Connect and Move Members in "${channel.name}".`,
        { channelId: channel.id },
      );
    }
    const voiceState = member.voice;
    const previousChannelId = voiceState?.channelId || null;
    if (!previousChannelId) throw new ValidationError(`${member.user.username} is not connected to voice.`);
    if (previousChannelId === channel.id) {
      return {
        ok: true,
        skipped: true,
        message: `${member.user.username} is already in "${channel.name}".`,
        data: { memberId: member.id, channelId: channel.id },
      };
    }

    const reason = args.reason || 'Moved in voice by the Eternalz AI administrator.';
    await voiceState.setChannel(channel.id, reason);
    const verified = await voiceState.fetch().catch(() => null);
    if (!verified || verified.channelId !== channel.id) {
      throw new Error(`Discord did not confirm the voice move for ${member.user.username}.`);
    }

    return {
      ok: true,
      message: `Moved ${member.user.username} to voice channel "${channel.name}".`,
      data: { memberId: member.id, channelId: channel.id, previousChannelId },
      reversal: { kind: 'move_member_voice', member: member.id, channel: previousChannelId },
    };
  },
};

const disconnectMemberVoice = {
  name: 'disconnect_member_voice',
  description:
    'Disconnect a member from their current voice channel. They may rejoin. Requires confirmation.',
  mutating: true,
  moderation: true,
  parameters: {
    type: 'object',
    properties: { member: memberArgument, reason: reasonArgument },
    required: ['member'],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const member = await manageableMember(ctx, args.member, 'MoveMembers');
    const voiceState = member.voice;
    const previousChannelId = voiceState?.channelId || null;
    if (!previousChannelId) {
      return {
        ok: true,
        skipped: true,
        message: `${member.user.username} is not connected to voice.`,
        data: { memberId: member.id },
      };
    }

    const reason = args.reason || 'Disconnected from voice by the Eternalz AI administrator.';
    await voiceState.disconnect(reason);
    const verified = await voiceState.fetch().catch((err) => (
      err?.status === 404 || err?.code === 10065 ? { channelId: null } : null
    ));
    if (!verified || verified.channelId) {
      throw new Error(`Discord did not confirm the voice disconnect for ${member.user.username}.`);
    }

    return {
      ok: true,
      message: `Disconnected ${member.user.username} from voice.`,
      data: { memberId: member.id, previousChannelId },
      reversal: null,
      note: 'The member can rejoin; the bot cannot restore their previous voice session.',
    };
  },
};

module.exports = [setMemberNickname, moveMemberVoice, disconnectMemberVoice];
