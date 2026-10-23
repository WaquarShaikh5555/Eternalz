'use strict';

/**
 * Short-lived follow-up conversations for `/ai`.
 *
 * A conversation lets the requester answer a clarification through a Discord
 * modal instead of running the slash command again. Sessions are deliberately
 * small, bound to one user and one guild, and expire automatically.
 *
 * They live in memory because they are interaction state, not configuration.
 * A restart simply means the user starts a fresh `/ai` request.
 */

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 500;
const sessions = new Map();

function prune(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  // Bound memory even if a server creates many sessions.
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
}

function createConversation({ guildId, requesterId, prompt, question = null, ttlMs = DEFAULT_TTL_MS }) {
  prune();
  const now = Date.now();
  const session = {
    id: crypto.randomBytes(12).toString('hex'),
    guildId,
    requesterId,
    prompt: String(prompt || '').slice(0, 8000),
    question: question ? String(question).slice(0, 2000) : null,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  sessions.set(session.id, session);
  return session;
}

function getConversation(id) {
  const session = sessions.get(String(id || ''));
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(session.id);
    return null;
  }
  return session;
}

function updateConversation(id, patch) {
  const session = getConversation(id);
  if (!session) return null;
  if (patch.prompt !== undefined) session.prompt = String(patch.prompt).slice(0, 8000);
  if (patch.question !== undefined) {
    session.question = patch.question ? String(patch.question).slice(0, 2000) : null;
  }
  // Follow-ups keep the conversation alive for another short window.
  session.expiresAt = Date.now() + DEFAULT_TTL_MS;
  return session;
}

function deleteConversation(id) {
  sessions.delete(String(id || ''));
}

function canUseConversation(session, interaction) {
  return Boolean(
    session &&
      interaction?.guild &&
      interaction.guild.id === session.guildId &&
      interaction.user?.id === session.requesterId,
  );
}

/** Test hook: clear all in-memory sessions. */
function clearConversations() {
  sessions.clear();
}

module.exports = {
  DEFAULT_TTL_MS,
  createConversation,
  getConversation,
  updateConversation,
  deleteConversation,
  canUseConversation,
  clearConversations,
};
