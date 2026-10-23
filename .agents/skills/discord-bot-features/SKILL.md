---
name: discord-bot-features
description: >-
  Production patterns for advanced Discord bot features that go beyond slash-command
  plumbing — moderation and automod, warnings / bans / timeouts / audit logs, welcome
  messages, verification, reaction roles and autoroles, ticket systems, XP / leveling /
  leaderboards / economy, custom commands and per-guild configuration, giveaways, polls,
  reminders and scheduled tasks, music, AI assistants, Minecraft server integration, and
  bot statistics. Use when implementing or reviewing any of these feature families in a
  Discord bot. Triggers: "moderation", "automod", "warn", "ban", "timeout", "audit log",
  "welcome", "verify", "reaction role", "autorole", "ticket", "level", "XP",
  "leaderboard", "economy", "giveaway", "poll", "reminder", "music bot", "AI chatbot",
  "Minecraft", "bot stats".
license: MIT
compatibility: Requires discord.js v14 (patterns shown in JS) or discord.py v2 (patterns noted). Database access is assumed for persistent features.
metadata:
  author: arena-agent
  version: "1.0.0"
  created: "2026-10-23"
---

# Advanced Discord Bot Features

Every feature family below shares the same skeleton. Learn the skeleton once, then apply
it per feature.

## The universal feature skeleton

```
1. GUILD SCOPED DATA      -> persisted per guild, in one place
2. CONFIG RESOLUTION      -> guild config > default config > hard-coded fallback
3. PERMISSION GATE        -> check the *invoker*, the *bot*, and the *target* separately
4. INTERACTION BUDGET     -> acknowledge within 3s; defer/background anything slower
5. PERSIST + AUDIT        -> write the state change, then write the audit record
6. FEEDBACK               -> confirm to the user, visibly, in the right channel
```

### 1. Guild-scoped data

Never store per-guild state in module-level variables or in-memory maps — they are lost on
restart and are wrong the moment you run more than one process. Put it in the database,
keyed by `guildId`.

```js
// src/lib/guild-config.js
export async function getGuildConfig(guildId, key, fallback = null) {
  const row = await db.guildConfig.findFirst({ where: { guildId, key } });
  return row ? row.value : fallback;
}

export async function setGuildConfig(guildId, key, value) {
  await db.guildConfig.upsert({
    where: { guildId_key: { guildId, key } },
    create: { guildId, key, value },
    update: { value },
  });
}
```

For a real database schema, see the `postgres-best-practices` and `prisma-expert` /
`drizzle-orm-expert` skills; for the existing MongoDB setup in this repo see `mongodb`.

### 2. Config resolution order

```
command-specific override → guild config → global default → built-in fallback
```

Resolve once, at the top of the handler, and pass the resolved value down. Reading
`process.env` or a hard-coded constant deep inside business logic is how bots end up
inconsistent between guilds.

```js
const config = {
  logChannelId: await getGuildConfig(guild.id, 'logChannelId', null),
  dmOnWarn:    await getGuildConfig(guild.id, 'dmOnWarn', true),
  maxWarn:     await getGuildConfig(guild.id, 'maxWarn', 3),
};
```

### 3. Three permission checks, not one

Most moderation bugs come from checking only one of these:

```js
// a) Can the INVOKER use the command at all?
if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
  return interaction.reply({ content: 'You need `Moderate Members`.', ephemeral: true });
}

// b) Can the BOT act on the target? (hierarchy + the bot's own perms)
const me = interaction.guild.members.me;
if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
  return interaction.reply({ content: 'I lack the `Ban Members` permission.', ephemeral: true });
}
if (target.roles.highest.position >= me.roles.highest.position) {
  return interaction.reply({ content: 'That member outranks me.', ephemeral: true });
}

// c) Is the TARGET protected?
if (target.id === interaction.guild.ownerId) {
  return interaction.reply({ content: 'I cannot act on the server owner.', ephemeral: true });
}
if (target.roles.highest.position >= interaction.member.roles.highest.position) {
  return interaction.reply({ content: 'That member outranks you.', ephemeral: true });
}
```

### 4. Interaction budget

Discord requires an acknowledgement within **3 seconds**. Anything that touches a network
(an API, a slow DB query, a file) can blow that.

```js
// Fast path — pure DB read, reply directly.
await interaction.reply({ embeds: [buildEmbed(data)] });

// Slow path — defer FIRST, then work, then editReply.
await interaction.deferReply({ ephemeral: false });
const data = await slowExternalCall();
await interaction.editReply({ embeds: [buildEmbed(data)] });
```

Use `ephemeral: true` for anything that is personal (a warning summary, a DM preview) or
that a moderator should not want announced publicly.

---

## Feature families

### A. Moderation & automod

**Building blocks**

- **Word / phrase filter** — normalise (lowercase, strip zero-width chars, collapse
  whitespace, leetspeak-fold `1→i`, `3→e`, `0→o`) *before* matching, or evaders win.
- **Link filter** — block invite links to other servers, blocked domains, and URL
  shorteners. Parse the URL and check the **registrable domain**, not the raw string,
  so `discord.gg` behind a redirect is still caught.
- **Caps / flood** — ratio of uppercase letters, repeated-character runs, duplicate
  messages within a window.
- **Mention / mass-mention** — `@here`, `@everyone`, and role mentions.
- **Anti-spoof** — display names that impersonate staff roles.

**Escalation ladder** — make severity configurable per guild:

```
warn (1st)  →  timeout 10m (2nd)  →  timeout 1h (3rd)  →  kick (4th)  →  ban (5th)
```

Never silently escalate. Log every step, and DM the member *before* a timeout/ban where
possible so they know why.

**Audit log** — write to a dedicated channel, and to the database. See section B.

**Starter rules config shape**

```js
{
  antiSpam:   { enabled: true, maxMessages: 6, intervalSec: 8, action: 'delete+warn' },
  links:      { enabled: true, blockInvites: true, blockedDomains: ['example.com'] },
  words:      { enabled: true, list: ['spamword'], action: 'delete+warn' },
  mentions:   { enabled: true, maxMentions: 5, action: 'delete' },
  caps:       { enabled: false, ratio: 0.7, minLength: 12 },
  escalations:{ warn: 3, timeout: 10 * 60_000, timeoutHours: 60 * 60_000, kick: 4, ban: 5 },
}
```

**Notes**
- Message-content intent is **privileged**. Request it only if a feature genuinely needs
  it, and degrade gracefully (slash commands, reaction-based rules, and author-id checks
  all work without it).
- Discord's own built-in AutoMod is free and surprisingly capable — offer it as a
  complementary option rather than pretending a regex is better.
- Bulk-delete only removes messages <14 days old and caps at 100 per request. Handle the
  partial-deletion case gracefully.

---

### B. Warnings, bans, timeouts & audit logging

**Data model**

```js
// warnings
{ id, guildId, userId, moderatorId, reason, weight: 1, createdAt, removedAt?, caseId? }
// cases (optional grouping)
{ id, guildId, userId, openedBy, reason, active, closedAt? }
// mod actions (audit log)
{ id, guildId, actorId, targetId, action, reason, metadata, createdAt }
// guild bans (shadow ban list)
{ id, guildId, userId, reason, expiresAt?, createdAt }
```

**Warn flow**

```js
async function addWarning(interaction, target, reason) {
  const warnings = await db.warning.create({
    data: { guildId: interaction.guildId, userId: target.id, moderatorId: interaction.user.id, reason },
  });
  await audit(interaction, 'WARN', target, { reason, warningId: warnings.id });

  const config = await getGuildConfig(interaction.guildId, 'moderation', DEFAULT_MODERATION);
  const active = await db.warning.count({ where: { guildId: interaction.guildId, userId: target.id, removedAt: null } });
  const total = active * (warnings.weight ?? 1);

  if (total >= config.escalations.ban) {
    await interaction.guild.members.ban(target.id, { reason: `Auto-ban: ${reason}` });
    await audit(interaction, 'BAN', target, { reason, automatic: true });
  } else if (total >= config.escalations.kick) {
    await interaction.guild.members.kick(target.id, reason);
    await audit(interaction, 'KICK', target, { reason, automatic: true });
  } else if (total >= config.escalations.timeoutHours) {
    await target.timeout(config.escalations.timeoutHours, reason);
    await audit(interaction, 'TIMEOUT', target, { reason, ms: config.escalations.timeoutHours });
  } else if (total >= config.escalations.timeout) {
    await target.timeout(config.escalations.timeout, reason);
    await audit(interaction, 'TIMEOUT', target, { reason, ms: config.escalations.timeout });
  }
  return { total };
}
```

**Timeouts**
- Maximum duration is **28 days**. Longer → use `kick` + a "softban" record.
- Discord also supports `communicationDisabledUntil` (per-channel) for granular timeouts.
- A timeout is *not* a mute in every client — verify the target is a member first
  (`guild.members.fetch`); timeouts only work on members.

**Bans**
- `guild.members.ban(userId, { reason, deleteMessageSeconds })` —
  `deleteMessageSeconds` accepts up to 7 days (604800).
- `guild.bans.remove(userId)` to unban.
- For a "softban" (kick + purge) use `member.ban()` then `member.unban()`.

**Audit logging** — write to a channel *and* the database:

```js
async function audit(interaction, action, target, extra = {}) {
  const entry = { guildId: interaction.guildId, actorId: interaction.user.id, targetId: target?.id, action, metadata: extra };
  await db.modAction.create({ data: entry });                      // durable
  const channelId = await getGuildConfig(interaction.guildId, 'logChannelId', null);
  if (channelId) {
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    await channel?.send({ embeds: [auditEmbed(action, target, extra)] }).catch(() => {});
  }
}
```

Guard the audit channel send — a deleted log channel must never break a moderation
action. Wrapping it in `try/catch` (as above) is not optional.

**DM the user**: `target.user.send(...)` throws if DMs are closed → always wrap in
`try/catch` and report "could not DM".

---

### C. Welcome, verification, reaction roles & autoroles

**Welcome**
- `guildMemberAdd` event. Prefer a **DM** for the welcome message plus a short public
  message in a welcome channel (public welcomes let people farm reactions).
- Track `joinedAt` so a bot restart does not re-welcome everyone: only greet a member if
  `member.joinedAt` is within the last ~10 minutes.
- Make the welcome message templated: `{user}`, `{username}`, `{server}`, `{memberCount}`,
  and support `{rules}` that links to a configured rules channel.

**Verification (captcha-style)**
- On join, assign a "Pending" role; remove "Unverified".
- The bot DMs a verification link containing a **signed, short-lived token**
  (HMAC over `guildId:userId:exp` with a server secret) — never put raw IDs the user can
  edit.
- The user opens the link → the bot verifies the HMAC and the expiry → removes the
  pending role and grants the verified role.
- Alternatively: a reaction-role gate, or a "click the button" check (Discord buttons
  are per-message, so a DM button works well).

**Reaction roles**
- Store one row per role: `{ guildId, emoji, roleId, label, description }`.
- On `messageReactionAdd`, look up by `guildId + emoji` (use the raw emoji string for
  unicode, and `name:id` for custom emojis). Add the role.
- On `messageReactionRemove`, remove the role **only if the user has no other reaction
  that maps to it** — otherwise removing one badge strips an unrelated role.
- Use a dedicated "roles" channel; add the bot's reaction-role handler for `messageReactionAdd`
  **and** `messageReactionRemove`.

```js
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  const { message } = reaction;
  if (!message.guild) return;
  const key = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
  const rule = await db.reactionRole.findFirst({ where: { guildId: message.guild.id, emoji: key } });
  if (!rule) return;
  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  if (member.roles.cache.has(rule.roleId)) return;
  if (!member.roles.highest.position > message.guild.members.me.roles.highest.position) return; // hierarchy
  await member.roles.add(rule.roleId, 'reaction role').catch(() => {});
});
```

**Autoroles**
- Applied on join (and re-applied when a role is manually removed, if configured).
- The bot must be **above** the role in the hierarchy to assign it.
- Never let an autorole grant a role that grants moderation permissions.

---

### D. Ticket systems

**Design**

```
Panel (message with "Create Ticket" button)
  └─ user clicks
       └─ bot creates (or reuses) a private channel named ticket-<user-id>
            ├─ overwrites: @everyone denied VIEW_CHANNEL, user + staff allowed
            ├─ buttons: Close Ticket, Transcript, Escalate
            └─ bot records ticket row { guildId, channelId, userId, openedAt, status }
```

**Patterns**
- **One channel per user** (find an existing open ticket first) or **one channel per
  ticket** (simpler, allows parallel conversations). Pick one and enforce it.
- **Transcript on close** — read the channel history, render it to HTML/markdown, upload
  it, then delete the channel. Discord's own "download" is not exposed via the API, so
  you must read messages yourself (max 100 per request, paginate with `before`).
- **Permission overwrites** must explicitly deny `VIEW_CHANNEL` for `@everyone` or the
  role inherits access. This is the single most common ticket-system bug.
- **Button state**: use a `custom_id` that encodes the action and the ticket id, e.g.
  `ticket:close:<ticketId>`. Never trust other data from the interaction.
- Add `custom_id` length limits in mind: 100 characters max.
- Handle the panel being deleted (`interaction.message` may be gone) gracefully.

**Escalation**
- Add a "Support Team" role to the ticket channel automatically.
- Auto-close idle tickets after N hours with a warning message first.
- Respect Discord's channel-creation rate limits — create them sequentially, not in a
  tight loop.

---

### E. Leveling, XP, leaderboards & economy

**XP model**

```js
// xp_events table
{ id, guildId, userId, amount, source, createdAt }
```

**Rules that keep the system fair**
- Only award XP for *messages* the bot can actually see (message-content intent), or use
  an **interaction-based** XP source (slash commands, buttons) which needs no privileged
  intent at all. Interaction-based XP is the modern, safe default.
- Cap XP per user per time window (e.g. 100 XP/hour) to stop spam loops.
- Ignore bots, ignore the bot's own messages, ignore channels that are excluded.
- Use a **cooldown** per channel so XP cannot be farmed in one busy channel.

**Level curve** — diminishing returns, so early levels come fast:

```js
function xpForLevel(level) {
  // 100, 200, 300 ... simple linear
  return 100 * level;
  // or quadratic: 50 * level ** 2
}
function levelFromXp(totalXp) {
  let level = 0;
  while (totalXp >= xpForLevel(level + 1)) level++;
  const into = totalXp - xpForLevel(level);
  const needed = xpForLevel(level + 1) - xpForLevel(level);
  return { level, into, needed, progress: needed ? into / needed : 1 };
}
```

**Leaderboards**
- **Do not** `ORDER BY` over a huge XP table on every command. Maintain a
  `user_stats { guildId, userId, xp, level }` row updated in the same transaction as the
  XP event, and index `(guildId, xp)`.
- For top-N, use a descending index and `LIMIT` — with an index this is fast at
  millions of rows.
- Use a **cursor/pagination** approach for "around user X" (get their rank with a
  `COUNT(*) WHERE xp > mine` query — indexed, still fast) rather than fetching the whole
  list.
- **Cache the leaderboard** for 30–60 s and invalidate on XP change if you need it fresh.

**Economy**
- Balances live in `economy { guildId, userId, balance }` with a **unique** index on
  `(guildId, userId)`.
- **Every balance change must be a transaction** — read-modify-write races are the
  classic economy bug:

```js
await db.$transaction(async (tx) => {
  const row = await tx.economy.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId, balance: amount },
    update: { balance: { increment: amount } },
  });
  await tx.economyLog.create({ data: { guildId, userId, delta: amount, reason, actorId } });
  return row;
});
```

- Use `increment`/`decrement` (atomic SQL `UPDATE ... SET balance = balance + ?`) instead
  of "read then write".
- Store the balance as an integer of **minor units** (cents) — never a float.
- Write an immutable **transaction log** alongside the balance so disputes can be
  reconstructed. The log is the source of truth; the balance is a cached projection.
- Cap daily earnings per user to stop inflation bots.

---

### F. Custom commands & per-guild configuration

**Custom commands**
- Trigger on a prefix (e.g. `!`) — requires message-content intent — or on slash
  commands with a name argument (no privileged intent, works everywhere).
- Stored per guild: `{ guildId, name, aliases, response, enabled, useEmbed, cooldownMs }`.
- Support placeholders: `{user}`, `{username}`, `{server}`, `{memberCount}`, `{userCount}`,
  `{random: a,b,c}`, `{userCount}`.
- **Cooldowns per command**, plus a global per-user cooldown to stop abuse.
- **Escalating permissions**: a custom command that can post as the bot in any channel is
  a spam vector. Restrict output channels and add a global rate limit.
- If the bot cannot use message content, offer slash-command-based custom commands as
  the default and prefix commands as an opt-in.

**Per-guild configuration**
- A `guild_config { guildId, key, value }` key/value table is flexible; a typed table
  per feature is better for validation. Use typed columns where the shape is known
  (welcome message, log channel id) and key/value for sparse settings.
- Provide `/config` subcommands: `view`, `set`, `reset`, `export`, `import`.
- Always show the **current effective value** and where it came from
  (guild override vs default) — this is a huge quality-of-life win for admins.

---

### G. Giveaways, polls, reminders & scheduled tasks

**Giveaways**
- Data: `{ id, guildId, channelId, messageId, prize, winnerCount, endsAt, entrants[], ended, winners[] }`.
- Entrants are **users**, not members (a user can join before/after leaving the guild).
- Use a **button** with a custom id `giveaway:join:<giveawayId>` — buttons avoid
  message-content intent entirely.
- **Selecting winners**: use `guild.members.fetch()` and then
  `guild.members.fetch({ userIds: [...ids] })` to get members, then `member.user` for
  mentions. Random selection must be genuinely random — `crypto.randomInt` for
  correctness, and remove winners from the pool.
- **Re-entrancy**: after a giveaway ends, the button must stop working — check `ended`
  before processing, and disable the button.
- End the giveaway with `interaction.editReply` to update the original message.
- Schedule the end with a durable job (see below), but also **verify on startup** that
  any giveaway whose `endsAt` has passed gets finalised — the scheduler may have been
  down.

**Polls**
- Reactions as votes: a scheduled job tallies reaction counts.
- Buttons as votes: store per-voter choice in the DB (a reaction tally cannot tell you
  *who* voted, and can be gamed by alt accounts).
- Support multiple-choice with buttons; store `{ pollId, userId, optionId }` with a
  unique constraint on `(pollId, userId)` so re-voting updates rather than duplicates.
- Tally by counting DB rows, not by counting reactions.

**Reminders**
- `{ id, userId, guildId?, channelId, message, dueAt, createdAt, deliveredAt?, cancelled }`.
- Set a Discord-native **timeout on the user** as the delivery mechanism when the
  reminder is ≤28 days — this survives restarts for free and needs no scheduler.
- For longer reminders, use a durable job queue (`bullmq-specialist` for Node +
  Redis, or `systemd-services` timers) and re-check on boot.
- Always offer "no reminder" when the user already has one pending (avoid spam).

**Scheduled tasks (general)**
- Use `bullmq-specialist` (Redis-backed, with retries + DLQ) or `systemd-services`
  timers for durability. A bare `setInterval` dies with the process.
- Every job must be **idempotent** — jobs can and will run twice.
- Validate cron expressions with the `cron-doctor` skill before shipping them.
- Stagger work: do not wake 5,000 guilds at the same minute — spread across the hour
  with a deterministic offset (`hash(guildId) % 3600`).

---

### H. Music

**Legality and reality check**

- Playing audio from YouTube violates the YouTube Terms of Service. Do not build a
  YouTube-downloading music feature. Stream from sources that explicitly permit it:
  licensed radio streams (SomaFM, Icecast stations), direct audio URLs you are
  authorised to use, or your own hosted audio.
- "Legal" does not mean "free of operational cost": bandwidth, Discord voice limits and
  a 24/7 process all cost money.

**Technical requirements**
- `@discordjs/voice` requires the `Voice` intent? — No: it needs `GatewayIntentBits.Guilds`
  plus `GuildVoiceStates` (**not** privileged).
- The bot's voice **region** must match the user's, and the bot needs `Connect` +
  `Speak` in that channel.
- **Node 22+ / DJS v14**: use `@discordjs/voice`'s `joinVoiceChannel` with
  `selfDeaf: true`. The old `joinVoiceChannel` + `AudioPlayer` "createVoiceConnection"
  pattern still works; keep one `AudioPlayer` per guild.
- **FFmpeg is required** — it is a native binary. Install it in the image
  (`apt-get install -y ffmpeg`, already present in this repo's Dockerfile).
- Track per-guild player state: `{ guildId, connection, player, queue[], nowPlaying }`.
- Always `queue` operations with `AudioResource` metadata (title, URL, duration,
  requestedBy) so the `nowplaying` command can display it.
- Handle `AudioPlayerStatus.Idle` → advance the queue; `Idle` with an empty queue →
  leave the channel (or idle-timeout after N minutes to save money).
- **Rate limits**: Discord voice connections are limited; cache audio metadata, and
  avoid re-resolving the same URL repeatedly.
- `AudioPlayer` errors (e.g. unsupported codec) must be caught per-resource.

---

### I. AI chatbots & assistants

See the `claude-api` skill (authoritative model ids, pricing, streaming, tool use) and
`llm-application-dev-ai-assistant` (context management and integration boundaries).

**Bot-specific patterns**

- **Never** put the bot token, API keys, or raw user data into the prompt. Filter the
  context you send.
- **Memory**: keep a per-user, per-channel conversation history in the DB with a TTL
  and a cap (e.g. last 20 messages). Trim the system prompt to a fixed budget.
- **Injection**: users will try to override your instructions. Keep the system prompt
  out of user-reachable content, and treat retrieved content (web pages, other bots'
  messages) as untrusted.
- **Cost control**: hard-cap `max_tokens`, cap requests per user per hour, cache
  identical prompts, and set an aggressive timeout (30 s) with graceful degradation.
- **Streaming**: for longer answers, use Discord's `interaction.editReply()` in chunks
  (respect the ~2000-char limit and the ~3 edits/3 s rate limit on follow-ups).
- **Discord limits**: a message is max **2000 characters** (4000 with Nitro) and
  **10 embeds**; an embed description is 4096 chars, embed title 256, total embed
  characters 6000. Split long output across messages or embeds.
- **Fail soft**: an AI outage must not look like the bot is broken — reply with a clear
  "the assistant is unavailable right now" and keep the rest of the bot working.

---

### J. Minecraft server integration

- **Server status**: use `api.mcsrvstat.us/3/<host>` (keyless, descriptive
  `User-Agent` required, cached 5 min upstream). `api.mcsrvstat.us/simple/<host>`
  returns 200/404 for an uptime check. Cache ≥60 s locally.
  See the `free-api-discovery` skill for the verified quota/licence table.
- **Server plugin side**: the `minecraft-bukkit-pro` skill covers Bukkit/Spigot/Paper
  plugin development; `minecraft-modpack-server` covers hosting modded servers.
- **Cross-channel design**: a Discord command that queries the game server and posts the
  result, or a webhook from the Minecraft server into Discord. Keep the webhook secret
  in the server's config, and validate it on every inbound request.
- Rate-limit the polling: one status check per server per 60 s, not per command.

---

### K. Statistics, analytics & server management

**Bot statistics**
- `client.guilds.cache.size`, `client.users.cache.size`, `client.channels.cache.size`,
  uptime, memory (`process.memoryUsage().rss`), and command-invocation counters.
- Expose via `/stats` (ephemeral) and a public web dashboard.
- Use `client.ws.ping` for gateway latency.

**Command analytics**
- Count invocations, errors and latency per command in an in-memory ring buffer, flush
  to the DB periodically (every 5–10 min) rather than per invocation — per-invocation
  writes will destroy your database throughput.
- Track: command name, guild, success/failure, duration bucket, error class.

**Server management**
- `/server` — server info: member counts, channels, roles, boost tier, creation date,
  features. `guild.premiumTier` for boost level, `guild.memberCount`.
- `/roles` — list roles with id, position, member count, colour, and whether they are
  managed/hierarchical.
- `/emojis`, `/channels` — listing with permission-filtered results.
- `/permissions` — compute the effective permissions of a member or role. This requires
  summing role permissions **and** applying channel overwrites; use
  `member.permissions.has()` which discord.js computes for you, but understand that it
  is guild-level, not channel-level.

**Analytics aggregation**
- For per-guild rollups, use a scheduled job writing to a daily summary table
  (`guild_daily { guildId, date, messages, commands, activeUsers }`) rather than
  querying raw events on demand.
- Add the right indexes before adding volume: `(guildId, createdAt)`, `(command, createdAt)`.

---

## Cross-cutting rules

1. **Never assume a permission exists** — check `member.permissions.has()` for the
   invoker *and* the bot, and check role hierarchy.
2. **Never let a third-party failure break a command** — wrap every external call.
3. **Always acknowledge within 3 seconds** — defer first for anything slow.
4. **Always persist before you announce** — if the write fails, do not claim success.
5. **Always audit a state change** — moderation, role grants, config edits, economy ops.
6. **Never trust the client** — re-validate role ids, channel ids, and amounts from the
   database, never from a custom-id or a button payload.
7. **Idempotency** — jobs, giveaways and reminders must survive restarts and re-runs.
8. **Least privilege** — request only the intents and permissions the features need;
   document which feature needs each privileged intent.
9. **Testable** — every command handler should accept injected dependencies so it can be
   unit-tested without a live Discord connection (see `jest-skill`).
10. **Respect Discord's limits** — 2000-char messages, 10 embeds, 100 messages per fetch,
    50 requests/second globally, 3-second interaction deadline.
