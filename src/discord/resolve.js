'use strict';

/**
 * Entity resolution helpers.
 *
 * The model reasons about human-readable names ("general", "VIP", "Admin"), so
 * every tool that takes a target accepts either a name or a snowflake id and
 * resolves it to a real Discord object. Resolution is deterministic and
 * case-insensitive; ambiguous names raise an error instead of guessing.
 */

const { ChannelType } = require('discord.js');

const { NotFoundError, ValidationError } = require('../core/errors');

function normalise(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function byNameOrId(cache, input, { label = 'target', type = 'object' } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new ValidationError(`A ${label} is required.`);

  // Cache lookup also supports test/adaptor ids that are not Discord snowflakes.
  const direct = cache.get(raw);
  if (direct) return direct;

  // Direct snowflake ids and Discord mention forms (<#id>, <@&id>, <@id>).
  const mentionId = raw.match(/^<(?:#|@&|@!?)(\d{15,25})>$/)?.[1] || null;
  const id = mentionId || (/^\d{15,25}$/.test(raw) ? raw : null);
  if (id) {
    const found = cache.get(id);
    if (found) return found;
    throw new NotFoundError(`No ${label} with id ${id} exists in this server.`);
  }

  const needle = normalise(raw);
  const matches = [];
  for (const item of cache.values()) {
    if (normalise(item.name) === needle) matches.push(item);
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    // Try a loose "contains" match so "general chat" finds "general-chat".
    const loose = [...cache.values()].filter((item) => normalise(item.name).includes(needle));
    if (loose.length === 1) return loose[0];
    throw new NotFoundError(
      `No ${label} named "${raw}" exists in this server. Available: ${listNames(cache).join(', ') || '(none)'}`,
    );
  }

  throw new ValidationError(
    `"${raw}" matches several ${label}s (${matches.map((m) => m.name).join(', ')}). Be more specific.`,
  );
}

/**
 * True when a channel is a category.
 *
 * discord.js v14 exposes `channel.type` as a numeric `ChannelType`, but some
 * tooling still uses the string form, so both are accepted.
 */
function isCategory(channel) {
  if (!channel) return false;
  return channel.type === ChannelType.GuildCategory || channel.type === 'GUILD_CATEGORY';
}

function listNames(cache, limit = 25) {
  return [...cache.values()].slice(0, limit).map((c) => c.name);
}

/** Resolve a channel, category or thread by name or id. */
function resolveChannel(guild, input) {
  return byNameOrId(guild.channels.cache, input, { label: 'channel' });
}

/** Resolve a category by name or id. */
function resolveCategory(guild, input) {
  const category = guild.channels.cache.find(
    (c) =>
      c.id === String(input) ||
      (isCategory(c) && normalise(c.name) === normalise(input)),
  );
  if (!category) {
    const categories = guild.channels.cache.filter((c) => isCategory(c));
    if (categories.size === 0) throw new NotFoundError('This server has no categories.');
    throw new NotFoundError(
      `No category named "${input}". Available: ${listNames(categories).join(', ')}`,
    );
  }
  return category;
}

/** Resolve a role by name or id. */
function resolveRole(guild, input) {
  return byNameOrId(guild.roles.cache, input, { label: 'role' });
}

/** Resolve a member by id, username or display name. */
async function resolveMember(guild, input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new ValidationError('A member is required.');

  // Direct lookup by id (works even for ids that are not snowflakes).
  const cached = guild.members?.cache?.get?.(raw);
  if (cached) return cached;

  const mentionId = raw.match(/^<@!?(\d{15,25})>$/)?.[1] || null;
  const userId = mentionId || (/^\d{15,25}$/.test(raw) ? raw : null);
  if (userId) {
    const mentioned = guild.members?.cache?.get?.(userId);
    if (mentioned) return mentioned;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
    throw new NotFoundError(`No member with id ${userId} is in this server.`);
  }
  // Models commonly preserve the @ when a prompt says "@username".
  const needle = normalise(raw.replace(/^@/, ''));
  const members = await guild.members.fetch();
  const matches = [...members.values()].filter(
    (m) =>
      normalise(m.user.username) === needle ||
      normalise(m.displayName) === needle ||
      normalise(m.nickname || '') === needle,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new NotFoundError(`No member named "${raw}" could be found in this server.`);
  }
  throw new ValidationError(
    `"${raw}" matches several members (${matches.map((m) => m.user.username).join(', ')}). Use a user id.`,
  );
}

module.exports = {
  isCategory,
  resolveChannel,
  resolveCategory,
  resolveRole,
  resolveMember,
  normalise,
  listNames,
};
