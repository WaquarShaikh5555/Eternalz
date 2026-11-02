'use strict';

/**
 * High-confidence, deterministic plans for common single-action requests.
 *
 * This is deliberately conservative. If the whole prompt does not match a
 * supported pattern, or an entity cannot be resolved exactly from the fresh
 * snapshot, the normal AI planner handles it. Returned calls still pass the
 * same schema validation, authorization, risk and execution pipeline.
 */

function normalisePrompt(prompt) {
  let text = String(prompt || '').trim().replace(/\s+/g, ' ');
  // Polite wrappers do not change the intent. Remove only complete prefixes.
  for (let index = 0; index < 3; index += 1) {
    const next = text.replace(/^(?:please|could you|can you|would you|hey|ok|okay)[,\s]+/i, '');
    if (next === text) break;
    text = next.trim();
  }
  return text.replace(/[.!?]+$/, '').trim();
}

function unquote(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:"([\s\S]*)"|'([\s\S]*)'|`([\s\S]*)`)$/);
  return match ? String(match[1] ?? match[2] ?? match[3] ?? '').trim() : text;
}

function normaliseName(value) {
  return unquote(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function channelEntities(snapshot) {
  return [
    ...(snapshot.categories || []).map((entity) => ({ ...entity, kind: 'category' })),
    ...(snapshot.channels || []).map((entity) => ({ ...entity, kind: 'channel' })),
  ];
}

function isRecentReference(value) {
  return /^(?:it|this|that|this channel|that channel|the channel|this category|that category|the category)$/i.test(value);
}

function findChannel(snapshot, rawReference, recentContext) {
  const reference = unquote(rawReference).trim();
  if (isRecentReference(reference)) {
    const recent = recentContext?.reference;
    return recent && ['channel', 'category'].includes(recent.kind) ? recent : null;
  }

  const mentionId = reference.match(/^<#(\d{15,25})>$/)?.[1] || null;
  const cleaned = reference
    .replace(/^(?:the\s+)?(?:channel|category)\s+/i, '')
    .replace(/^#/, '')
    .trim();
  const entities = channelEntities(snapshot);
  if (mentionId || /^\d{15,25}$/.test(cleaned)) {
    const id = mentionId || cleaned;
    return entities.find((entity) => entity.id === id) || null;
  }

  const needle = normaliseName(cleaned);
  const matches = entities.filter((entity) => normaliseName(entity.name) === needle);
  return matches.length === 1 ? matches[0] : null;
}

function findCategory(snapshot, rawReference) {
  const reference = unquote(rawReference)
    .replace(/^(?:the\s+)?category\s+/i, '')
    .trim();
  const needle = normaliseName(reference);
  const matches = (snapshot.categories || []).filter(
    (category) => category.id === reference || normaliseName(category.name) === needle,
  );
  return matches.length === 1 ? matches[0] : null;
}

function channelName(value, type) {
  const name = unquote(value).slice(0, 100).trim();
  if (!name) return '';
  if (type && type !== 'text') return name;
  // Discord text-channel names use lowercase and hyphens rather than spaces.
  return name.toLowerCase().replace(/^#/, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function parseDuration(value) {
  if (!value) return null;
  const match = String(value).trim().match(
    /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)(?:\s+(?:because|due to)\s+(.+))?$/i,
  );
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('d')
    ? 1440
    : unit.startsWith('h')
      ? 60
      : unit.startsWith('s')
        ? 1 / 60
        : 1;
  const minutes = Math.ceil(amount * multiplier);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 40320) return null;
  return { minutes, reason: match[3]?.trim() || null };
}

function planRename(text, snapshot, recentContext) {
  // An explicit bot/self nickname request must never fall through to a
  // channel named "bot" when its nickname is invalid or unavailable.
  if (/^(?:rename|change|set)\s+(?:yourself|your\s+(?:name|nickname|nick)|(?:the\s+)?bot(?:'s)?(?:\s+(?:name|nickname|nick))?)\s+to\s+/i.test(text)) {
    return null;
  }
  const match = text.match(/^(?:rename|change the name of)\s+(.+?)\s+(?:to|into)\s+(.+)$/i);
  if (!match) return null;
  const target = findChannel(snapshot, match[1], recentContext);
  if (!target) return null;
  const fresh = channelEntities(snapshot).find((entity) => entity.id === target.id) || target;
  const requested = unquote(match[2]).slice(0, 100).trim();
  const name = fresh.kind === 'category'
    ? requested
    : channelName(requested, fresh.type || 'text');
  if (!name) return null;
  return [{ tool: 'rename_channel', args: { channel: target.id, name } }];
}

function planCreateCategory(text) {
  const match = text.match(/^(?:create|add|make)(?:\s+a|\s+an)?\s+category\s+(?:(?:called|named)\s+)?(.+)$/i);
  if (!match) return null;
  const name = unquote(match[1]).slice(0, 100).trim();
  return name ? [{ tool: 'create_category', args: { name } }] : null;
}

function planCreateChannel(text, snapshot) {
  const match = text.match(
    /^(?:create|add|make)(?:\s+a|\s+an)?\s+(?:(text|voice|stage|announcement|forum)\s+)?channel\s+(?:(?:called|named)\s+)?(.+)$/i,
  );
  if (!match) return null;
  const type = match[1]?.toLowerCase() || 'text';
  let namePart = match[2];
  let category = null;
  const parent = namePart.match(/^(.*?)\s+(?:in|under)\s+(?:the\s+)?(?:category\s+)?(.+)$/i);
  if (parent) {
    namePart = parent[1];
    category = findCategory(snapshot, parent[2]);
    if (!category) return null;
  }

  const name = channelName(namePart, type);
  if (!name) return null;
  const args = { name, type };
  if (category) args.category = category.id;
  return [{ tool: 'create_channel', args }];
}

function planModeration(text) {
  const match = text.match(/^(mute|timeout|unmute|untimeout|kick|ban|unban)\s+(?:the\s+)?(.+)$/i);
  if (!match) return null;
  const verb = match[1].toLowerCase();
  const rest = match[2].trim();
  const target = rest.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(?:for|because)\s+(.+))?$/i);
  if (!target) return null;

  const member = unquote(target[1] ?? target[2] ?? target[3]);
  const suffix = target[4]?.trim() || '';
  // Direct moderation is high-confidence only for an unambiguous single
  // target: a mention, id, @username, quoted name, or one-word username.
  if (!member || (/\s/.test(member) && !/^["']/.test(rest))) return null;

  if (verb === 'mute' || verb === 'timeout') {
    const duration = parseDuration(suffix);
    // Never turn an invalid/out-of-range explicit duration into a five-minute
    // mute with the duration silently reinterpreted as the reason.
    if (suffix && /^\d/.test(suffix) && !duration) return null;
    const args = { member, minutes: duration?.minutes || 5 };
    const reason = duration?.reason || (!duration && suffix ? suffix : '');
    if (reason) args.reason = reason.slice(0, 500);
    return [{ tool: 'timeout_member', args }];
  }

  if (verb === 'unmute' || verb === 'untimeout') {
    const args = { member };
    if (suffix) args.reason = suffix.slice(0, 500);
    return [{ tool: 'clear_timeout', args }];
  }

  const tool = verb === 'kick' ? 'kick_member' : verb === 'ban' ? 'ban_member' : 'unban_member';
  const args = { member };
  if (suffix) args.reason = suffix.slice(0, 500);
  return [{ tool, args }];
}

function planPurge(text, snapshot, recentContext) {
  const match = text.match(/^(?:delete|clear|purge)\s+(\d{1,3})\s+messages?\s+(?:from|in)\s+(.+)$/i);
  if (!match) return null;
  const count = Number(match[1]);
  const channel = findChannel(snapshot, match[2], recentContext);
  if (!channel || channel.kind !== 'channel' || count < 1 || count > 100) return null;
  return [{ tool: 'delete_messages', args: { channel: channel.id, count } }];
}

function directMemberReference(raw) {
  const text = String(raw || '').trim();
  const member = unquote(text);
  if (!member || member.length > 120) return null;
  if (/\s/.test(member) && !/^["']/.test(text)) return null;
  return member;
}

function planNickname(text, snapshot) {
  const self = text.match(
    /^(?:rename|change|set)\s+(?:yourself|your\s+(?:name|nickname|nick)|(?:the\s+)?bot(?:'s)?(?:\s+(?:name|nickname|nick))?)\s+to\s+(.+)$/i,
  ) || text.match(
    /^(?:change|set)\s+(?:the\s+)?(?:name|nickname|nick)\s+of\s+(?:the\s+)?(?:bot|yourself)\s+to\s+(.+)$/i,
  );
  if (self) {
    const nickname = unquote(self[1]);
    return snapshot.bot?.id && nickname.length <= 32
      ? [{ tool: 'set_member_nickname', args: { member: snapshot.bot.id, nickname } }]
      : null;
  }

  let match = text.match(/^(?:change|set)\s+(.+?)\s+(?:nickname|nick)\s+to\s+(.+)$/i);
  if (!match) {
    match = text.match(/^(?:change|set)\s+(?:the\s+)?nickname\s+of\s+(.+?)\s+to\s+(.+)$/i);
  }
  if (match) {
    const member = directMemberReference(match[1]);
    const nickname = unquote(match[2]);
    if (!member || nickname.length > 32) return null;
    return [{ tool: 'set_member_nickname', args: { member, nickname } }];
  }

  const clear = text.match(/^(?:clear|remove)\s+(?:the\s+)?nickname\s+(?:of|for)\s+(.+)$/i);
  if (!clear) return null;
  const member = directMemberReference(clear[1]);
  return member ? [{ tool: 'set_member_nickname', args: { member, nickname: '' } }] : null;
}

function planServerName(text) {
  const match = text.match(/^(?:rename|change)\s+(?:the\s+)?server\s+(?:name\s+)?to\s+(.+)$/i);
  if (!match) return null;
  const name = unquote(match[1]);
  return name.length >= 2 && name.length <= 100
    ? [{ tool: 'set_server_name', args: { name } }]
    : null;
}

function planNsfw(text, snapshot, recentContext) {
  let match = text.match(/^(?:mark|make)\s+(.+?)\s+(?:as\s+)?(nsfw|sfw)$/i);
  let nsfw;
  if (match) {
    nsfw = match[2].toLowerCase() === 'nsfw';
  } else {
    match = text.match(/^(enable|disable)\s+nsfw\s+(?:in|for|on)\s+(.+)$/i);
    if (!match) return null;
    nsfw = match[1].toLowerCase() === 'enable';
    match = [match[0], match[2]];
  }
  const channel = findChannel(snapshot, match[1], recentContext);
  return channel?.kind === 'channel'
    ? [{ tool: 'set_channel_nsfw', args: { channel: channel.id, nsfw } }]
    : null;
}

function planInvite(text, snapshot, recentContext) {
  const match = text.match(/^(?:create|make)(?:\s+an|\s+a)?\s+invite\s+(?:for|to|in)\s+(.+)$/i);
  if (!match) return null;
  let reference = match[1];
  let maxUses = 0;
  const uses = reference.match(/^(.*?)\s+(?:that allows|with|for)\s+(\d{1,3})\s+uses?$/i);
  if (uses) {
    reference = uses[1];
    maxUses = Number(uses[2]);
  }
  const channel = findChannel(snapshot, reference, recentContext);
  if (channel?.kind !== 'channel' || maxUses > 100) return null;
  return [{ tool: 'create_invite', args: { channel: channel.id, maxAgeSeconds: 86400, maxUses, temporary: false } }];
}

function planTopic(text, snapshot, recentContext) {
  const match = text.match(/^(?:set|change)\s+(?:the\s+)?topic\s+(?:of|for|in)\s+(.+?)\s+to\s+(.+)$/i);
  if (!match) return null;
  const channel = findChannel(snapshot, match[1], recentContext);
  const topic = unquote(match[2]);
  if (channel?.kind !== 'channel' || topic.length > 1000) return null;
  return [{ tool: 'set_channel_topic', args: { channel: channel.id, topic } }];
}

function planSlowmode(text, snapshot, recentContext) {
  const off = text.match(/^(?:disable|turn off)\s+slowmode\s+(?:in|for|on)\s+(.+)$/i);
  let reference;
  let seconds;
  if (off) {
    reference = off[1];
    seconds = 0;
  } else {
    const match = text.match(
      /^(?:set|change)\s+slowmode\s+(?:in|for|on)\s+(.+?)\s+to\s+(\d{1,5})(?:\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours))?$/i,
    );
    if (!match) return null;
    reference = match[1];
    const amount = Number(match[2]);
    const unit = match[3]?.toLowerCase() || 's';
    seconds = amount * (unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1);
  }
  const channel = findChannel(snapshot, reference, recentContext);
  if (channel?.kind !== 'channel' || seconds > 21600) return null;
  return [{ tool: 'set_channel_slowmode', args: { channel: channel.id, seconds } }];
}

function planVoice(text, snapshot) {
  const disconnect = text.match(/^disconnect\s+(.+?)\s+from\s+(?:voice|voice channel)$/i);
  if (disconnect) {
    const member = directMemberReference(disconnect[1]);
    return member ? [{ tool: 'disconnect_member_voice', args: { member } }] : null;
  }

  const move = text.match(/^move\s+(.+?)\s+to\s+(?:voice|voice channel)\s+(.+)$/i);
  if (!move) return null;
  const member = directMemberReference(move[1]);
  const channel = findChannel(snapshot, move[2], null);
  return member && channel?.kind === 'channel'
    ? [{ tool: 'move_member_voice', args: { member, channel: channel.id } }]
    : null;
}

/** Return one high-confidence action call, or null to use the AI planner. */
function createDirectActions({ prompt, snapshot, recentContext = null }) {
  const raw = String(prompt || '');
  if (raw.includes('\n') || raw.includes('\r')) return null;
  const text = normalisePrompt(raw);
  if (!text || /[,;]/.test(text)
      || /\b(?:and then|then|also)\b/i.test(text)
      || /(?:\b(?:and|plus)\b|&)\s+(?:create|make|add|delete|remove|rename|set|move|give|assign|ban|kick|mute|timeout|purge|clear|disconnect)\b/i.test(text)
      || /(?:\b(?:and|plus)\b|&)\s+(?:(?:a|an|the)\s+)?(?:category|role|channel)\b/i.test(text)) return null;

  const actionWords = text.match(
    /\b(?:create|change|make|add|delete|remove|rename|set|move|give|assign|ban|kick|mute|timeout|purge|clear|disconnect)\b/gi,
  ) || [];
  if (actionWords.length > 1) return null;

  return planNickname(text, snapshot)
    || planRename(text, snapshot, recentContext)
    || planCreateCategory(text)
    || planCreateChannel(text, snapshot)
    || planModeration(text)
    || planPurge(text, snapshot, recentContext)
    || planServerName(text)
    || planNsfw(text, snapshot, recentContext)
    || planInvite(text, snapshot, recentContext)
    || planTopic(text, snapshot, recentContext)
    || planSlowmode(text, snapshot, recentContext)
    || planVoice(text, snapshot);
}

module.exports = {
  createDirectActions,
  normalisePrompt,
  parseDuration,
  findChannel,
};
