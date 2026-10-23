'use strict';

/**
 * Lightweight Discord.js mocks.
 *
 * They implement just enough of the real API surface (including the real
 * `PermissionsBitField`) for the tools, the risk engine and the executor to
 * be exercised without a Discord connection.
 */

const { PermissionsBitField, ChannelType, PermissionFlagsBits, Collection } = require('discord.js');

let counter = 0;
function nextId(prefix = 'id') {
  counter += 1;
  return `${prefix}${String(counter).padStart(4, '0')}${''.padEnd(16, '0')}`;
}

function makePermissions(names = []) {
  const bitfield = names.reduce((acc, name) => acc | PermissionFlagsBits[name], 0n);
  return new PermissionsBitField(bitfield);
}

function makeOverwrite({ id, type = 0, allow = [], deny = [], target = null }) {
  return {
    id,
    type,
    target,
    allow: new PermissionsBitField(allow.reduce((a, n) => a | PermissionFlagsBits[n], 0n)),
    deny: new PermissionsBitField(deny.reduce((a, n) => a | PermissionFlagsBits[n], 0n)),
  };
}

function makeChannel(guild, options = {}) {
  const id = options.id || nextId('c');
  const overwriteCache = new Collection();
  for (const overwrite of options.overwrites || []) {
    overwriteCache.set(overwrite.id, overwrite);
  }

  const channel = {
    id,
    name: options.name || 'channel',
    type: options.type ?? ChannelType.GuildText,
    parentId: options.parentId || null,
    parent: null,
    position: options.position ?? 0,
    topic: options.topic || '',
    nsfw: Boolean(options.nsfw),
    rateLimitPerUser: options.rateLimitPerUser ?? 0,
    guild,
    permissionOverwrites: {
      cache: overwriteCache,
      edit: async (target, patch) => {
        const allow = new PermissionsBitField(patch.allow?.bitfield ?? 0n);
        const deny = new PermissionsBitField(patch.deny?.bitfield ?? 0n);
        overwriteCache.set(target.id, {
          id: target.id,
          type: target.type === 1 ? 1 : 0,
          target,
          allow,
          deny,
        });
        return overwriteCache.get(target.id);
      },
      delete: async (target) => {
        overwriteCache.delete(target.id);
      },
    },
    permissionsFor: (member) =>
      member?.permissions || makePermissions(['ViewChannel', 'SendMessages', 'EmbedLinks']),
    isTextBased: () => channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.GuildForum,
    isDMBased: () => false,
    setName: async (name) => {
      channel.name = name;
      return channel;
    },
    setTopic: async (topic) => {
      channel.topic = topic;
      return channel;
    },
    setRateLimitPerUser: async (seconds) => {
      channel.rateLimitPerUser = seconds;
      return channel;
    },
    setParent: async (parentId) => {
      channel.parentId = parentId;
      return channel;
    },
    delete: async () => {
      guild.channels.cache.delete(channel.id);
      if (guild.__deleted) guild.__deleted.push(channel);
      return channel;
    },
    fetch: async () => channel,
    send: async (payload) => ({
      id: nextId('m'),
      content: payload?.content || '',
      ...payload,
    }),
    bulkDelete: async (count) => {
      guild.__bulkDeleted = guild.__bulkDeleted || [];
      guild.__bulkDeleted.push({ channelId: channel.id, count });
      return new Collection(Array.from({ length: count }, (_, i) => [`m${i}`, { id: `m${i}` }]));
    },
    messages: {
      fetch: async () => ({ first: () => null }),
    },
  };

  return channel;
}

function makeRole(guild, options = {}) {
  const id = options.id || nextId('r');
  const role = {
    id,
    name: options.name || 'role',
    position: options.position ?? 1,
    hexColor: options.color || '#000000',
    hoist: Boolean(options.hoist),
    mentionable: Boolean(options.mentionable),
    managed: Boolean(options.managed),
    guild,
    members: { cache: new Map() },
    permissions: makePermissions(options.permissions || []),
    edit: async (patch) => {
      if (patch.name !== undefined) role.name = patch.name;
      if (patch.color !== undefined) role.hexColor = `#${patch.color.toString(16).padStart(6, '0')}`;
      if (patch.permissions !== undefined) role.permissions = patch.permissions;
      if (patch.hoist !== undefined) role.hoist = patch.hoist;
      if (patch.mentionable !== undefined) role.mentionable = patch.mentionable;
      return role;
    },
    delete: async () => {
      guild.roles.cache.delete(role.id);
      return role;
    },
    fetch: async () => role,
  };
  return role;
}

function makeMember(guild, options = {}) {
  const id = options.id || nextId('u');
  const roleCache = new Collection();
  const member = {
    id,
    guild,
    user: {
      id,
      username: options.username || `user${id}`,
      // discord.js v14 exposes `bot` as a boolean property on User.
      bot: Boolean(options.isBot),
      system: false,
    },
    displayName: options.displayName || options.username || `user${id}`,
    nickname: options.nickname || null,
    roles: {
      cache: roleCache,
      get highest() {
        let best = null;
        for (const role of roleCache.values()) {
          if (!best || role.position > best.position) best = role;
        }
        return best;
      },
      add: async (role) => {
        roleCache.set(role.id, role);
        role.members.cache.set(member.id, member);
      },
      remove: async (role) => {
        roleCache.delete(role.id);
        role.members.cache.delete(member.id);
      },
    },
    moderatable: true,
    communicationDisabledUntilTimestamp: null,
    timeout: async (ms) => {
      member.communicationDisabledUntilTimestamp = Date.now() + ms;
      return member;
    },
    ban: async () => {
      guild.__banned = guild.__banned || [];
      guild.__banned.push(member);
      guild.__banCollection = guild.__banCollection || new Collection();
      guild.__banCollection.set(member.id, { user: member.user, reason: 'test' });
      guild.members.cache.delete(member.id);
    },
    kick: async () => {
      guild.__kicked = guild.__kicked || [];
      guild.__kicked.push(member);
      guild.members.cache.delete(member.id);
    },
    fetch: async () => member,
  };
  return member;
}

function makeGuild(options = {}) {
  const channels = new Collection();
  const roles = new Collection();
  const members = new Collection();

  const guild = {
    id: options.id || 'guild-1',
    name: options.name || 'Test Server',
    ownerId: options.ownerId || 'owner-1',
    memberCount: options.memberCount ?? 10,
    premiumTier: 0,
    features: new Set(['COMMUNITY']),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    channels: {
      cache: channels,
      create: async (options = {}) => {
        const channel = makeChannel(guild, options);
        if (options.parent) {
          const parent = channels.get(options.parent);
          channel.parentId = parent ? parent.id : options.parent;
          channel.parent = parent || null;
        }
        channels.set(channel.id, channel);
        return channel;
      },
    },
    roles: {
      cache: roles,
      create: async (options = {}) => {
        const role = makeRole(guild, {
          name: options.name,
          color: options.color ? `#${options.color.toString(16).padStart(6, '0')}` : undefined,
          permissions: options.permissions
            ? options.permissions.toArray()
            : [],
          hoist: options.hoist,
          mentionable: options.mentionable,
        });
        role.position = options.position ?? roles.size;
        roles.set(role.id, role);
        return role;
      },
    },
    members: {
      cache: members,
      fetch: async (options) => {
        if (typeof options === 'string') {
          const found = members.get(options);
          if (!found) throw new Error('Unknown Member');
          return found;
        }
        return members;
      },
    },
    __deleted: [],
    __banned: [],
    __kicked: [],
    __banCollection: new Collection(),
    bans: {
      fetch: async () => guild.__banCollection,
      remove: async (userId) => {
        guild.__unbanned = guild.__unbanned || [];
        guild.__unbanned.push(userId);
        guild.__banCollection.delete(userId);
      },
    },
  };

  const everyone = makeRole(guild, {
    id: options.everyoneId || 'role-everyone',
    name: '@everyone',
    position: 0,
    managed: false,
  });
  roles.set(everyone.id, everyone);
  guild.roles.everyone = everyone;

  for (const channelOptions of options.channels || []) {
    const channel = makeChannel(guild, channelOptions);
    channels.set(channel.id, channel);
    if (channel.parentId) {
      const parent = channels.get(channel.parentId);
      if (parent) channel.parent = parent;
    }
  }

  for (const roleOptions of options.roles || []) {
    const role = makeRole(guild, roleOptions);
    roles.set(role.id, role);
  }

  for (const memberOptions of options.members || []) {
    const member = makeMember(guild, memberOptions);
    members.set(member.id, member);
    member.roles.cache.set(everyone.id, everyone);
    everyone.members.cache.set(member.id, member);
    for (const roleId of memberOptions.roleIds || []) {
      const role = roles.get(roleId);
      if (role) {
        member.roles.cache.set(role.id, role);
        role.members.cache.set(member.id, member);
      }
    }
  }

  const me = makeMember(guild, {
    id: options.botId || 'bot-1',
    username: 'Eternalz',
    isBot: true,
  });
  for (const roleId of options.botRoleIds || []) {
    const role = roles.get(roleId);
    if (role) {
      me.roles.cache.set(role.id, role);
      role.members.cache.set(me.id, me);
    }
  }
  if (!options.botRoleIds?.length) {
    const botRole = makeRole(guild, { id: 'role-bot', name: 'Eternalz', position: 99 });
    roles.set(botRole.id, botRole);
    me.roles.cache.set(botRole.id, botRole);
  }
  me.permissions = makePermissions(
    options.botPermissions || [
      'ViewChannel',
      'ManageChannels',
      'ManageRoles',
      'ManageMessages',
      'ReadMessageHistory',
      'SendMessages',
      'ModerateMembers',
      'EmbedLinks',
      'BanMembers',
      'KickMembers',
    ],
  );
  me.roles.cache.set(everyone.id, everyone);
  members.set(me.id, me);
  guild.members.me = me;

  return guild;
}

module.exports = {
  makeGuild,
  makeChannel,
  makeRole,
  makeMember,
  makePermissions,
  makeOverwrite,
  nextId,
};
