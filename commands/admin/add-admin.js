'use strict';

/**
 * /add-admin - grant one member AI administration access in this guild only.
 *
 * Only the Discord application owner may grant access, and only in a guild
 * where that same person is the owner or has Administrator / Manage Server.
 * Grantees never inherit the ability to add more administrators.
 */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');

const { runtime } = require('../../src/runtime');
const { getApplicationOwnerId } = require('../../src/admin/owner');
const { hasGuildManagementPermission } = require('../../src/admin/authorization');
const { grantGuildAdmin } = require('../../src/admin/grants');

module.exports = {
  guildOnly: true,
  multiGuild: true,

  data: new SlashCommandBuilder()
    .setName('add-admin')
    .setDescription('Grant a member /ai access in this server only')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The member who may use /ai in this server')
        .setRequired(true),
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: 'This command can only be used inside a server.', ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
    } catch {
      // The interaction may already be acknowledged by another handler.
    }

    const requesterId = interaction.user.id;
    let ownerId;
    try {
      ownerId = await getApplicationOwnerId(interaction.client);
    } catch (err) {
      runtime.logger?.warn?.('add-admin: could not verify application ownership', {
        reason: err.message,
      });
      await interaction.editReply({ content: 'I could not verify the application owner. Please try again.' });
      return;
    }

    if (!ownerId || ownerId !== requesterId) {
      await interaction.editReply({
        content: '🔒 Only the Discord application owner can use `/add-admin`.',
      });
      return;
    }

    const actorMember = interaction.member || guild.members?.cache?.get(requesterId) || null;
    if (guild.ownerId !== requesterId && !hasGuildManagementPermission(actorMember)) {
      await interaction.editReply({
        content: '🔒 You also need to own this server or have Administrator or Manage Server here.',
      });
      return;
    }

    if (guild.id !== runtime.config.discordGuildId && !runtime.config.aiMultiGuild) {
      await interaction.editReply({
        content: 'Multi-guild AI access is disabled. Enable `AI_MULTI_GUILD=true` before granting access in another server.',
      });
      return;
    }

    const target = interaction.options.getUser('user', true);
    if (target.bot) {
      await interaction.editReply({ content: 'Bot accounts cannot be granted AI administrator access.' });
      return;
    }

    let targetMember;
    try {
      targetMember = await guild.members.fetch(target.id);
    } catch {
      targetMember = null;
    }
    if (!targetMember) {
      await interaction.editReply({ content: 'That user is not a member of this server.' });
      return;
    }

    let result;
    try {
      result = await grantGuildAdmin(runtime.storage, {
        guildId: guild.id,
        userId: target.id,
        addedBy: requesterId,
      });
    } catch (err) {
      runtime.logger?.warn?.('add-admin: failed to save grant', { reason: err.message });
      await interaction.editReply({
        content: 'I could not save the administrator grant. No access was changed; please try again.',
      });
      return;
    }

    if (runtime.audit) {
      await runtime.audit.log({
        guildId: guild.id,
        requesterId,
        event: 'admin_granted',
        summary: {
          targetUserId: target.id,
          created: result.created,
          scope: 'this guild only',
        },
      }).catch((err) => {
        runtime.logger?.warn?.('add-admin: grant saved but audit failed', { reason: err.message });
      });
    }

    await interaction.editReply({
      content: result.created
        ? `✅ <@${target.id}> can now use \`/ai\` in **this server only**. They cannot use \`/add-admin\`, and all normal confirmation safeguards still apply.`
        : `ℹ️ <@${target.id}> already has \`/ai\` access in this server.`,
      allowedMentions: { parse: [] },
    });
  },
};
