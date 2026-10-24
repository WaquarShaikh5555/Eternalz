'use strict';

/**
 * Per-guild AI administrator grants.
 *
 * Each grant uses its own settings key. Besides keeping the grant scoped to a
 * single guild, this avoids read-modify-write races on a shared array when two
 * grants are saved close together. Both existing storage drivers already make
 * individual setting writes persistent and atomic.
 */

const KEY_PREFIX = 'aiAdministrator:';

function grantKey(userId) {
  return `${KEY_PREFIX}${userId}`;
}

async function getGuildAdminGrant(storage, guildId, userId) {
  if (!storage || !guildId || !userId) return null;
  const grant = await storage.getSetting(guildId, grantKey(userId));
  if (!grant || grant.guildId !== guildId || grant.userId !== userId) return null;
  return grant;
}

async function hasGuildAdminGrant(storage, guildId, userId) {
  return Boolean(await getGuildAdminGrant(storage, guildId, userId));
}

/** Idempotently grant /ai access in exactly one guild. */
async function grantGuildAdmin(storage, { guildId, userId, addedBy }) {
  const existing = await getGuildAdminGrant(storage, guildId, userId);
  if (existing) return { grant: existing, created: false };

  const grant = {
    guildId,
    userId,
    addedBy,
    createdAt: Date.now(),
  };
  await storage.setSetting(guildId, grantKey(userId), grant);
  return { grant, created: true };
}

module.exports = {
  getGuildAdminGrant,
  hasGuildAdminGrant,
  grantGuildAdmin,
  grantKey,
};
