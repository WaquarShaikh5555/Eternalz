---
name: discord-oauth-dashboard
description: >-
  Build a secure Discord OAuth2 login flow and an authenticated web dashboard for a
  Discord bot — guild configuration panels, live bot statistics, role and permission
  management, and the REST API that connects the frontend to the bot's database.
  Use when adding a dashboard, a web panel, a "manage my server" website, or when
  implementing Discord OAuth2 (identify / guilds / guilds.join scopes, invite URL
  generation, state/CSRF handling, session management). Triggers: "dashboard",
  "web panel", "Discord OAuth2", "login with Discord", "guild settings UI",
  "bot statistics page", "role management UI", "invite link builder".
license: MIT
compatibility: Examples use Node.js + Express + discord.js v14 + React. The OAuth2 and session rules apply to any stack.
metadata:
  author: arena-agent
  version: "1.0.0"
  created: "2026-10-23"
---

# Discord OAuth2 & Web Dashboards

A dashboard is a privileged surface: it can change what the bot does in someone's
server. Treat its authentication as the security boundary of the whole product.

---

## 1. The four concepts people confuse

Get these straight before writing code — most OAuth bugs are concept bugs.

| Concept | Who grants it | Where it lives | Used for |
|---|---|---|---|
| **OAuth scope** | The *user*, at the consent screen | `scope=` query param | What data the bot may read on the user's behalf (`identify`, `guilds`, `guilds.join`) |
| **Bot permissions** | The *server owner*, on the invite screen | `permissions=` integer bitfield | What the bot may *do* in the server (Send Messages, Ban Members, …) |
| **Gateway intent** | The *developer*, in the Developer Portal | `intents:` array | Which *events* the bot receives (Message Content, Guild Members are **privileged**) |
| **Application command permission** | The *user or role*, per guild | `setDefaultMemberPermissions` / `allowedUsers` | Who may run a specific slash command |

A scope never grants a bot permission, and a permission never grants a scope. `identify`
does not let the bot ban anyone; `Ban Members` does not let the dashboard read the
user's other guilds.

---

## 2. OAuth2 flow (authorization code grant)

```
Browser                Dashboard server              Discord
   |                          |                         |
   |-- click "Login" -------->|                         |
   |                          |-- redirect to /authorize?client_id=...&scope=identify guilds&state=NONCE&redirect_uri=...
   |------------------------------------------------------>|
   |                          |                         |  user logs in, consents
   |<------------------------- 302 ?code=CODE&state=NONCE
   |                          |                         |
   |                          |-- POST /api/oauth2/token (code, client_secret, redirect_uri, grant_type)
   |                          |---------------------------------------->|
   |                          |<------- { access_token, token_type, expires_in, refresh_token, scope }
   |                          |                         |
   |                          |-- GET /users/@me with Bearer token
   |                          |---------------------------------------->|
   |                          |<------- { id, username, global_name, avatar, ... }
   |                          |                         |
   |                          |-- store session (server-side, HttpOnly cookie)
   |<--------- set-cookie session=... ; redirect to /dashboard
```

### 2.1 The authorize URL

```js
const DISCORD_API = 'https://discord.com/api/v10';

export function buildAuthorizeUrl({ clientId, scopes, state, redirectUri }) {
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);              // CSRF nonce — REQUIRED
  url.searchParams.set('redirect_uri', redirectUri);  // must exactly match a registered redirect URI
  url.searchParams.set('prompt', 'none');             // optional: silent re-auth if already consented
  return url.toString();
}
```

### 2.2 State parameter (CSRF) — non-negotiable

`state` binds the callback to the browser that started the flow. Generate it
**server-side**, store it (short-lived), and compare it **in constant time** on return.

```js
import crypto from 'node:crypto';

// 1. start
const state = crypto.randomBytes(32).toString('base64url');
await db.oauthState.create({ data: { state, sessionId, expiresAt: new Date(Date.now() + 10 * 60_000) } });

// 2. callback
const stored = await db.oauthState.findUnique({ where: { state: receivedState } });
if (!stored || stored.expiresAt < new Date()) throw new Error('Invalid or expired OAuth state');
if (stored.sessionId !== req.session.id) throw new Error('OAuth state session mismatch');
await db.oauthState.delete({ where: { state: receivedState } });   // single use
```

Never accept a `state` you did not generate. Never skip the comparison "because the
code is already a secret" — the code protects the *token exchange*, `state` protects the
*user's browser session*.

### 2.3 Token exchange

```js
export async function exchangeCode({ code, redirectUri }) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,   // never in the browser
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();  // { access_token, token_type, expires_in, refresh_token, scope }
}
```

**The client secret must never reach the browser.** If your dashboard is a pure SPA, put
a small backend in front of it — the "BFF" (backend-for-frontend) pattern.

### 2.4 Fetching the user

```js
export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch /users/@me: ${res.status}`);
  return res.json();   // { id, username, discriminator, global_name, avatar, ... }
}
```

Use `global_name` for the display name (the new username system) and fall back to
`username`. Build the avatar URL as
`https://cdn.discordapp.com/avatars/${id}/${avatar}.${avatar?.startsWith('a_') ? 'gif' : 'png'}?size=128`.

### 2.5 Guild list and bot membership

- `scope=guilds` → `GET /users/@me/guilds` returns the guilds the user is in, with
  permissions the user holds **in that guild** (`permissions` field).
- `scope=guilds.join` → lets your bot add itself to a guild the user is in, using
  `PUT /guilds/{guild.id}/members/{user.id}` with `access_token` and `bot` in the body.
- The bot's own membership for a guild → `client.guilds.cache.get(guildId)`.

**Authorisation rule for the dashboard:** a user may only configure a guild where
**both** are true:
1. The bot is in that guild.
2. The user has the **Manage Guild** permission in that guild (from
   `/users/@me/guilds` → `permissions` bitfield, or better `guild.permissions`).

```js
const MANAGE_GUILD = 1 << 5n;   // 32
function canManage(userGuilds, guildId) {
  const g = userGuilds.find((x) => x.id === guildId);
  return Boolean(g && (BigInt(g.permissions) & MANAGE_GUILD));
}
```

Use `BigInt` for permission math — permissions exceed 32 bits.

---

## 3. Scopes: what to request and when

| Scope | Grants | Request when |
|---|---|---|
| `identify` | The user's id, username, avatar | Always (it is the basis of the session) |
| `guilds` | The list of guilds the user is in + their permissions in them | A guild dashboard |
| `guilds.join` | Add the bot to a guild the user is in | "Add to server" button on the dashboard |
| `bot` | Add the bot with a specific permission integer | The invite flow |
| `applications.commands` | Manage the app's slash commands | Command management UI |
| `connections` | The user's linked third-party accounts | Rarely needed; ask for justification |
| `email` | The user's email | Only if truly needed — it is PII |
| `messages.read` | Read the user's DM history | Almost never needed — do not request |

**Request the minimum.** Every extra scope is a consent-screen liability and a
privacy problem. `identify` + `guilds` covers most dashboards.

---

## 4. Invite / "Add to Server" URL

```js
export function buildInviteUrl({ clientId, scopes = ['bot', 'applications.commands'], permissions }) {
  const url = new URL(`https://discord.com/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('permissions', permissions.toString());
  url.searchParams.set('response_type', 'code');   // required for bot invites
  return url.toString();
}
```

**Least privilege:** compute the permission integer from the features you actually
ship, not `0x8` (Administrator). Build it from named bits so it is reviewable:

```js
import { PermissionFlagsBits } from 'discord.js';

const FEATURE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageRoles,        // reaction roles / autoroles
  PermissionFlagsBits.ManageMessages,     // automod / purge
  PermissionFlagsBits.ModerateMembers,    // timeouts
  PermissionFlagsBits.BanMembers,         // bans
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageWebhooks,     // logs / tickets
  PermissionFlagsBits.ManageChannels,     // ticket panels
];

const PERMISSION_INT = FEATURE_PERMISSIONS.reduce((acc, p) => acc | p, 0n);
```

Never request `Administrator`. `Administrator` bypasses every channel overwrite and
every hierarchy check — it defeats the entire permission model and is the single
biggest security mistake in Discord bots.

Also consider `discord.com/api/oauth2/authorize` with `disable_guild_select` to force
a single guild during setup.

---

## 5. Session management

**Server-side sessions, opaque cookie.** Never put the Discord access token in a
readable cookie, in `localStorage`, or in the URL.

```js
import crypto from 'node:crypto';

export function createSessionId() {
  return crypto.randomBytes(32).toString('base64url');   // 256 bits
}

export function setSessionCookie(res, sessionId, { maxAgeSec = 60 * 60 * 24 * 7 } = {}) {
  res.cookie('sid', sessionId, {
    httpOnly: true,      // not readable from JavaScript → XSS cannot steal it
    secure: true,        // HTTPS only
    sameSite: 'lax',     // 'strict' breaks the OAuth redirect back from Discord
    path: '/',
    maxAge: maxAgeSec * 1000,
  });
}
```

| Rule | Why |
|---|---|
| `httpOnly` | An XSS bug cannot exfiltrate the session id |
| `secure` | Never send the session over plaintext HTTP |
| `sameSite=lax` | `strict` breaks the OAuth redirect; `none` requires `secure` and widens CSRF exposure |
| Rotate on login | New session id after a successful OAuth callback — prevents session fixation |
| Rotate on privilege change | e.g. after the user changes their role in a guild |
| Expire idle sessions | Absolute max lifetime (7–30 days) + idle timeout |
| Store the token server-side | The DB holds the token; the cookie holds only an opaque id |
| Revoke on logout | Delete the DB row **and** call `POST /oauth2/token/revoke` |

---

## 6. Storing the Discord access token

- Encrypt at rest (AES-256-GCM with a key from the secret store / KMS).
- Store **only what you need**: for a dashboard you need `user id`, `username`,
  `avatar`, `access_token`, `refresh_token`, `expires_at`.
- **Refresh** before expiry (Discord access tokens live ~2 hours by default; the exact
  lifetime is in the token response's `expires_in`):

```js
export async function getValidToken(session) {
  if (session.tokenExpiresAt > Date.now() + 60_000) return session.accessToken;  // 60 s skew
  if (!session.refreshToken) throw new Error('Session expired');
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const data = await res.json();
  session.accessToken = data.access_token;
  session.refreshToken = data.refresh_token ?? session.refreshToken;
  session.tokenExpiresAt = Date.now() + data.expires_in * 1000;
  await session.save();
  return session.accessToken;
}
```

---

## 7. The dashboard API

Every dashboard endpoint must re-check authorisation server-side. The UI hiding a
button is not authorisation.

```js
// GET /api/guilds  -> the guilds this user may manage
app.get('/api/guilds', requireSession, async (req, res) => {
  const token = await getValidToken(req.session);
  const guilds = await fetchDiscordUserGuilds(token);   // GET /users/@me/guilds
  const manageable = guilds.filter((g) => (BigInt(g.permissions) & MANAGE_GUILD) !== 0n);
  res.json(manageable.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    owner: g.owner,
    permissions: g.permissions,
    botPresent: client.guilds.cache.has(g.id),
  })));
});

// PATCH /api/guilds/:guildId/config
app.patch('/api/guilds/:guildId/config', requireSession, requireCsrf, async (req, res) => {
  const guildId = req.params.guildId;
  if (!await userCanManageGuild(req, guildId)) return res.status(403).json({ error: 'forbidden' });
  if (!client.guilds.cache.has(guildId)) return res.status(404).json({ error: 'bot not in this guild' });

  const allowed = ['logChannelId', 'welcomeChannelId', 'welcomeMessage', 'dmOnWarn', 'maxWarn'];
  const patch = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!allowed.includes(k)) continue;               // whitelist — never persist arbitrary keys
    patch[k] = v;
  }
  await db.guildConfig.upsert({ where: { guildId_key: { guildId, key: 'settings' } }, create: { guildId, key: 'settings', value: patch }, update: { value: patch } });
  res.json({ ok: true, config: patch });
});
```

**Validation rules**
- **Whitelist** the fields that may be written. Never persist an arbitrary JSON blob
  supplied by the client.
- Validate channel ids **against the guild**: `guild.channels.fetch(id)` and confirm
  `channel.guildId === guildId`. Otherwise a user could point your log channel at a
  channel in another server.
- Validate role ids the same way, and check the role's hierarchy position.
- Escape/strip HTML from any user-supplied text that will be rendered in an embed.

---

## 8. CSRF protection on the dashboard API

SameSite cookies protect against *most* CSRF, but add an explicit token for
state-changing requests.

```js
// issue
req.session.csrfToken ??= crypto.randomBytes(24).toString('base64url');

// check (header must match the session value, compared in constant time)
function requireCsrf(req, res, next) {
  const sent = req.get('x-csrf-token') ?? req.body?._csrf;
  const expected = req.session?.csrfToken;
  if (!sent || !expected) return res.status(403).json({ error: 'missing csrf token' });
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'invalid csrf token' });
  }
  next();
}
```

Also enforce `Content-Type: application/json` on mutating routes (this alone blocks
classic HTML-form CSRF) and reject requests with an unexpected `Origin`.

---

## 9. Live bot statistics

The dashboard is a separate process from the bot, so it cannot read the bot's in-memory
state directly. Two options:

**Option A — the bot writes stats to a shared store (recommended)**

```js
// in the bot, every 60s
await redis.set('bot:stats', JSON.stringify({
  guilds: client.guilds.cache.size,
  users: client.users.cache.size,
  channels: client.channels.cache.size,
  commands: commandCounter.value(),
  uptimeSec: Math.floor(process.uptime()),
  ping: client.ws.ping,
  memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  ts: Date.now(),
}), { EX: 120 });
```

The dashboard reads the key. The `EX: 120` TTL means a dead bot shows stale data rather
than a frozen "live" number — and the dashboard should label it as such.

**Option B — the bot exposes an internal HTTP endpoint**

Only on an internal network or behind a shared secret header. Never expose guild or
user data on an unauthenticated endpoint.

**Approach the data correctly**
- `client.guilds.cache.size` counts only **cached** guilds. If `Guilds` intent is
  enabled (it must be), the cache is complete. If not, it under-reports — say so.
- `client.users.cache.size` counts users seen since the last restart; it is **not** the
  number of registered users. Label it "users cached".
- Real member totals come from `guild.memberCount` (available for cached guilds) or the
  `GUILD_MEMBERS` intent.
- Show the value **and** the timestamp it was computed.

---

## 10. Frontend ↔ backend

- The frontend calls **your** API (`/api/...`) with `credentials: 'include'`; it never
  calls Discord's API directly. This keeps the client secret and the access token
  server-side.
- Send the CSRF token as a header from the session bootstrap endpoint.
- **Never** put secrets in `NEXT_PUBLIC_*` / `VITE_*` / `REACT_APP_*` variables — those
  are compiled into the browser bundle.
- Use relative URLs (`/api/guilds`) so the same build works in every environment.
- Set a CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  and `X-Frame-Options: DENY` (or `frame-ancestors 'none'` in CSP) on dashboard pages.

### Minimal dashboard API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/session` | Current user + CSRF token + guild list |
| `GET` | `/api/guilds/:id/config` | Effective config for a guild |
| `PATCH` | `/api/guilds/:id/config` | Update the whitelisted config fields |
| `GET` | `/api/guilds/:id/roles` | Roles with positions and member counts |
| `POST` | `/api/guilds/:id/roles` | Create / assign a reaction role |
| `GET` | `/api/stats` | Live bot statistics (from the shared store) |
| `GET` | `/api/guilds/:id/logs` | Paginated audit log |
| `POST` | `/api/logout` | Destroy the session + revoke the token |

---

## 11. Abuse protection on the dashboard

- **Rate-limit** the OAuth callback and the API by IP and by user
  (`upstash-ratelimit` skill — sliding window over Redis).
- Apply a per-IP cap on `/oauth2/authorize` starts to stop login-loop abuse.
- Log every config change with the actor's id — the dashboard is an admin surface.
- Add a **confirmation step** for destructive actions (deleting a reaction role, wiping
  a warning history) and never perform them from a GET.
- Consider requiring a Discord **role** (e.g. a "Bot Admin" role) for the dashboard,
  checked server-side on each request — guild permission alone may be broader than you
  want.

---

## 12. Checklist before shipping the dashboard

- [ ] `state` generated server-side, single-use, expiring, compared in constant time
- [ ] `client_secret` never in the browser or in a `NEXT_PUBLIC_*` variable
- [ ] Minimum scopes only (`identify`, `guilds`, and `guilds.join` if needed)
- [ ] Session cookie: `httpOnly`, `secure`, `sameSite=lax`, rotated on login
- [ ] Access token stored server-side, encrypted at rest, refreshed before expiry
- [ ] Every API route re-checks authorisation server-side
- [ ] Config writes are whitelisted and channel/role ids validated against the guild
- [ ] CSRF token checked on all mutating routes; `Content-Type: application/json` enforced
- [ ] Rate limiting on the OAuth callback and the API
- [ ] Invite URL uses a least-privilege permission integer — **never** `Administrator`
- [ ] CSP and security headers set
- [ ] Secrets in the secret store / git-ignored `.env` — never in source or logs
- [ ] Audit log records every dashboard-initiated change
- [ ] Graceful degradation when the bot is offline (show "last updated" timestamps)
