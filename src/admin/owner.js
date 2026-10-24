'use strict';

/**
 * Resolve the single Discord user who owns the bot application.
 * Personal applications have a User owner. Team-owned applications expose the
 * team's owner_user_id; other team members are deliberately not accepted.
 */
async function getApplicationOwnerId(client) {
  const application = client?.application;
  if (!application) return null;

  const fetched = typeof application.fetch === 'function'
    ? await application.fetch()
    : application;
  const owner = fetched?.owner || application.owner;
  if (!owner) return null;

  // Team#ownerId is the owning user's id, whereas Team#id is the team id.
  if (owner.members) return owner.ownerId || null;
  return owner.id || null;
}

async function isApplicationOwner(client, userId) {
  if (!userId) return false;
  const ownerId = await getApplicationOwnerId(client);
  return Boolean(ownerId && ownerId === userId);
}

module.exports = { getApplicationOwnerId, isApplicationOwner };
