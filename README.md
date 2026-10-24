# Eternalz

A Discord bot for a personal server that also works as an **AI-powered server
administrator**: you describe a change in plain language, the bot inspects the
real server, builds a validated plan, asks for confirmation when the change is
risky, and then performs the change through the official Discord API.

> The AI never executes free-form output. It can only *propose* calls to a
> fixed allowlist of application tools, and every proposal is validated against
> a strict schema, checked against your permissions and checked against the
> current server state before anything is sent to Discord.

---

## Table of contents

1. [What it can do](#what-it-can-do)
2. [How the AI administration works](#how-the-ai-administration-works)
3. [Risk model](#risk-model)
4. [Safety model](#safety-model)
5. [Configuration](#configuration)
6. [Choosing an AI provider](#choosing-an-ai-provider)
7. [Inviting and configuring the bot in Discord](#inviting-and-configuring-the-bot-in-discord)
8. [Deploying on Wispbyte](#deploying-on-wispbyte)
9. [Local development](#local-development)
10. [Project layout](#project-layout)
11. [Tests](#tests)
12. [Emergency switches](#emergency-switches)
13. [Known limitations](#known-limitations)

---

## What it can do

### Existing bot features (unchanged)

| Command | Description |
| --- | --- |
| `/ping` | Latency check |
| `/meme` | Random meme |
| `/aichat` | Hugging Face chat |
| `/mostactive` | Most active members in a channel |
| `/poll` | Poll with buttons |
| `/search` | Web search (needs `SERPER_API_KEY`) |
| `/userinfo` | User information |

### New AI administration commands

| Command | Description |
| --- | --- |
| `/ai prompt:<text> [dry_run]` | Manage the server with a plain-language request |
| `/ai-status` | Show whether AI administration is configured (no secrets) |
| `/ai-audit` | Show the recent AI administration activity log |
| `/add-admin user:<member>` | Application owner grants `/ai` access in the current server only |

### Supported operations

**Inspection** — the server snapshot, the channel list, the role list, the
permission overwrites of a channel, the permissions of a role, the roles of a
member.

**Channels & categories** — create, rename, set the topic, set slowmode, move
between categories, delete, and manage permission overwrites.

**Roles** — create, rename, recolour, change permissions, delete, and assign or
remove **non-privileged** roles from members.

**Community** — create a private ticket/support channel with staff access,
publish server rules, configure the welcome message and the onboarding role.
The welcome settings are actually used: the bot greets new members and gives
them the onboarding role when they join.

**Messaging** — post an announcement or a formatted embed when it is
explicitly requested.

**Moderation** — timeout (mute), kick, ban, unban, and bulk delete up to 100
recent messages in a channel. Timeout, kick, ban and bulk delete always
require confirmation.

**Permission self-check** — before planning or executing, the bot compares the
required permissions with the ones it actually has and tells you exactly what
to grant and where (`Server Settings → Roles → <bot role>`), instead of
failing with a raw Discord 403.

Anything outside that list is not implemented and the model cannot invent it.
See **[docs/capabilities.md](docs/capabilities.md)** for the complete list of
what is and is not supported.

> Not sure which environment variable goes where? See
> **[docs/environment-variables.md](docs/environment-variables.md)** for a
> click-by-click guide.

---

## How the AI administration works

```
/ai prompt "create a Support category with a tickets channel"
   │
   ├─ 1. Authorisation          owner / configured or granted admins, scoped per guild
   ├─ 2. Rate limit + cooldown  per user
   ├─ 3. Snapshot               the real server state is read
   ├─ 4. Inspection phase       the model may call read-only tools
   ├─ 5. Planning phase         the model may call mutating tools
   ├─ 6. Schema validation      every tool call is validated strictly
   ├─ 7. Risk classification    safe / confirm / confirm twice
   ├─ 8. Confirmation           buttons, bound to the requester, expiring
   ├─ 9. Execution              Discord.js calls, paced and retried
   ├─ 10. Verification           each change is re-read from Discord
   ├─ 11. Report                successes, failures and partial results
   └─ 12. Audit                 database + optional private audit channel
```

Two model calls are used for a typical request (inspection + planning). The
server overview, tool schemas, read results and completion budget are bounded
so the normal flow fits free-provider token limits; read tools are used only
when the overview lacks a needed detail.

---

## Risk model

| Level | Meaning | Examples |
| --- | --- | --- |
| `safe` | Executed automatically | create a channel, rename a channel, create a plain role, assign a plain role, post an announcement |
| `confirm` | One explicit confirmation | delete a channel / category / role, ban, kick, any permission overwrite on an existing channel, changing the permissions of an existing role, creating a private channel, creating a role with a privileged permission |
| `confirm_twice` | Two separate confirmations | granting `Administrator`, three or more destructive actions in one plan, removing a role from three or more members at once |

The classification is derived from the **tool identity and its arguments** —
never from what the model says about the action.

---

## Safety model

* **Owner-controlled access.** The server owner, configured user ids, and
  members explicitly granted by the Discord application owner through
  `/add-admin` may use `/ai`. A grant is stored for one guild only and never
  grants the ability to add more administrators.
* **Owner-only delegation.** `/add-admin` verifies the Discord application
  owner and requires that person to own or administer the current guild.
* **Checked twice.** Authorisation is verified in code *before* the AI provider
  is contacted and again immediately before every single action is executed.
* **One target guild by default.** The bot refuses to act in any server other
  than `DISCORD_GUILD_ID`. With explicit `AI_MULTI_GUILD=true`, configured
  users and holders of a current-guild `/add-admin` grant can use `/ai` in
  other guilds. Primary-guild role IDs and grants never carry over.
* **Fixed tool allowlist.** The model can only request the tools in
  `src/discord/tools/`. Unknown tool names are rejected.
* **Strict schemas.** Every argument is validated (types, enums, ranges,
  required fields, unknown keys rejected) before it is used.
* **Permission and hierarchy checks.** The bot verifies its own Discord
  permissions and role hierarchy before each operation.
* **Untrusted content.** Channel names, topics, role names, embeds and quoted
  text are wrapped in a clearly delimited block and the system prompt states
  that they are data, never instructions. A prompt injection inside a channel
  topic cannot make the bot act.
* **Confirmation is bound to the requester.** Only the person who submitted the
  request can press Confirm or Cancel. Someone else gets an ephemeral refusal.
* **Plans expire.** A pending plan is void after `AI_CONFIRM_TIMEOUT_MS`
  (5 minutes by default) and stale plans are cleaned up at start-up.
* **Re-validation.** Permissions, hierarchy and the current server state are
  checked again at confirmation time, not just at planning time.
* **No blind repetition.** Duplicate channels, categories and roles are skipped
  instead of being created twice, and a partial failure never causes the whole
  plan to be replayed.
* **Honest reporting.** A success is only reported after Discord confirmed it.
  Failures are listed individually, e.g. "12 of 15 created, 3 failed".

### How much does the AI "think"?

The model is told to use judgement, not just to translate words:

* it picks sensible defaults itself (kebab-case channel names, a category when
  the request implies a group, a sensible colour);
* it reuses existing channels and roles instead of making duplicates;
* if a step is missing it adds the obvious prerequisite itself (create the
  category before creating a channel inside it);
* it checks its own permissions before planning and tells you what is missing;
* it refuses to do things the tools cannot do, and says what it *can* do
  instead.

It will **not** invent extra changes you did not ask for, and it will not
reorganise, rename or delete anything unrelated. That boundary is deliberate:
a creative administrator is useful, an unpredictable one is dangerous.

---

## Configuration

All configuration comes from environment variables. Copy `.env.example` to
`.env` for local development, or paste the values into your host's
environment-variable panel. **Never commit a filled-in `.env`.**

### Required

| Variable | Meaning |
| --- | --- |
| `DISCORD_TOKEN` | Bot token from the Developer Portal |
| `DISCORD_CLIENT_ID` | Application id from the Developer Portal |
| `DISCORD_GUILD_ID` | Primary server for AI administration and guild-scoped status/audit commands |

### Required for AI administration

| Variable | Meaning |
| --- | --- |
| `AI_PROVIDER` | `groq` (default), `openrouter`, `gemini`, `openai` or `custom` |
| `AI_API_KEY` | The key for the chosen provider |
| `AI_MODEL` | Model id. A sensible default is chosen per provider |
| `AI_BASE_URL` | Optional base URL override |
| `AI_ADMIN_USER_IDS` | Optional static user ids allowed to use `/ai`; `/add-admin` is the per-guild alternative |

### Optional

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_ADMIN_ROLE_IDS` | *(empty)* | Extra administrators by role in the primary guild |
| `AI_MULTI_GUILD` | `false` | Allow configured user ids in other guilds they own or administer |
| `AI_AUDIT_CHANNEL_ID` | *(empty)* | Private channel that receives the audit trail |
| `AI_ADMIN_ENABLED` | `true` | Master switch for `/ai` |
| `AI_WRITE_ENABLED` | `true` | Set to `false` to plan but never write |
| `AI_CONFIRM_TIMEOUT_MS` | `300000` | How long a plan stays confirmable |
| `AI_REQUEST_COOLDOWN_MS` | `10000` | Minimum time between two requests from one user |
| `AI_MAX_ACTIONS` | `25` | Maximum number of actions in one plan |
| `AI_MAX_PLANNING_ROUNDS` | `1` | Maximum inspection rounds (keeps free-tier token use low) |
| `AI_MAX_OUTPUT_TOKENS` | `512` | Maximum completion tokens per model call |
| `AI_TIMEOUT_MS` | `60000` | Provider request timeout |
| `AI_FALLBACK_PROVIDERS` | *(empty)* | e.g. `openrouter:https://openrouter.ai/api/v1:openrouter/free` |
| `STORAGE_DRIVER` | `auto` | `auto`, `sqlite` or `json` |
| `DATA_DIR` | `./data` | Where the database is written |
| `COMMAND_SCOPE` | `global` | `global` or `guild` |
| `REGISTER_COMMANDS_ON_START` | `true` | Register the slash commands at start-up |
| `PORT` | `3000` | Port of the keep-alive web server |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |

---

## Choosing an AI provider

Free tiers were checked in October 2026. **Free is not unlimited** — every
provider below enforces per-minute and per-day limits, and the bot surfaces a
clear "quota exhausted" message instead of failing silently.

| Provider | Free quota (verified) | Tool calling | Notes |
| --- | --- | --- | --- |
| **Groq** (recommended) | 30 req/min, **1 000 req/day**, 8 000 tok/min, 200 000 tok/day on `openai/gpt-oss-120b` / `openai/gpt-oss-20b` | Yes, OpenAI-compatible | No credit card. Very fast. Quota is per organisation, so extra keys do not help |
| **OpenRouter** | 20 req/min, **50 req/day** without buying credits (1 000/day after a one-off $10 purchase) | Yes on many `:free` models, but free endpoints sometimes fail with *"No endpoints found that support tool use"* | Use the `openrouter/free` router: it auto-selects a free model that supports tool calling. Good fallback, low daily quota |
| **Google Gemini** | Free tier, Flash / Flash-Lite only. Google no longer publishes fixed numbers — the limit is shown per project in AI Studio (reported values range from ~20 to 1 500 requests/day) | Yes | Use the native Gemini provider; the base URL differs from OpenAI |
| **OpenAI** | No free tier | Yes | Works, but needs a paid key |

### Recommended setup

```
AI_PROVIDER=groq
AI_API_KEY=<your Groq key>
AI_MODEL=openai/gpt-oss-120b
```

You do **not** need a paid tier for ordinary requests. The planner sends a
bounded server overview, compact tool schemas and at most 512 completion
tokens per call. Keep `AI_MAX_OUTPUT_TOKENS=512` (or lower) on Groq's free
tier; increasing it can make an otherwise small request exceed the 8,000 TPM
budget. Free quotas can still be exhausted by frequent usage.

Optional resilience — fall back to OpenRouter when Groq is rate limited:

```
AI_FALLBACK_PROVIDERS=openrouter|https://openrouter.ai/api/v1|openrouter/free
```

To use Gemini instead:

```
AI_PROVIDER=gemini
AI_API_KEY=<your AI Studio key>
AI_MODEL=gemini-2.5-flash-lite
```

Any other OpenAI-compatible service works with `AI_PROVIDER=custom` plus
`AI_BASE_URL` and `AI_MODEL`.

---

## Inviting and configuring the bot in Discord

### 1. Create the application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Name it (e.g. `Eternalz`) → **Create**.
3. Open **Bot** → **Reset Token** → copy it (this is `DISCORD_TOKEN`).
4. On the same page turn on:
   * **Presence** → *Visible, Online, Offline* (optional)
   * **Message Content Intent** — *only* needed by the older `/aichat` and
     `/search` commands. The AI administration commands do **not** need it.
5. Open **General Information** → copy the **Application ID**
   (this is `DISCORD_CLIENT_ID`).

### 2. Invite the bot with the right permissions

1. Open **OAuth2 → URL Generator**.
2. **Scopes:** `bot`, `applications.commands`.
3. **Bot permissions** — at minimum:
   * Manage Channels
   * Manage Roles
   * Manage Messages
   * Send Messages
   * Embed Links
   * Ban Members
   * Kick Members
   * Read Message History
   * View Channels
4. Copy the generated URL and open it in a browser, then choose your server.

If the bot is already in the server, it is easier to give its role the
permissions directly in **Server Settings → Roles → Eternalz**.

### 3. Get the ids

* **Server id** — Developer Mode (User Settings → Advanced) → right-click the
  server → *Copy Server ID* → `DISCORD_GUILD_ID`.
* **Your user id** — optional static allowlist: right-click yourself → *Copy
  User ID* → `AI_ADMIN_USER_IDS`. Alternatively, use `/add-admin` after the
  commands are registered.

### 4. Register the slash commands

```bash
npm run register:guild
```

This registers `/ai`, `/ai-status`, `/ai-audit` and `/add-admin` directly in
the target guild (they appear immediately) and registers ordinary commands
globally.
Use `npm run register:global` to register everything globally instead, and
`npm run register` to use the `COMMAND_SCOPE` setting.

The bot also registers the commands automatically at start-up, so this step is
only needed once (or after adding a command).

### Using `/ai` in several servers

Keep `DISCORD_GUILD_ID` set to your primary server and explicitly enable
multi-guild access:

```env
AI_MULTI_GUILD=true
```

`AI_ADMIN_USER_IDS` remains an optional static allowlist. A configured user
must own the other server or have **Administrator** / **Manage Server** there.

To delegate access without editing environment variables, use this in the
server where the person should receive access:

```text
/add-admin user:@member
```

Only the Discord application owner can use `/add-admin`, and that owner must
also own the current server or have **Administrator** / **Manage Server** there.
The target must be a member of that server. The grant persists in SQLite/JSON,
applies only to that server, and does not permit the recipient to use
`/add-admin`. The application owner can also add themselves instead of putting
their own ID in `AI_ADMIN_USER_IDS`.

Register `/ai` and `/add-admin` globally after changing the setting:

```bash
npm run register:global
```

Alternatively, restart with `REGISTER_COMMANDS_ON_START=true`; automatic
startup registration also moves `/ai` and `/add-admin` to global registration. Discord global
commands can take up to an hour to appear. Invite the bot to each server and
grant the bot the permissions needed for the requested changes. Use
`AI_MULTI_GUILD=false` and re-register to restore single-server access.

### 5. Make sure the bot is above the roles it manages

The bot can only manage roles that sit **below** its own highest role, and it
can never manage its own role or the server owner's roles. Drag the bot's role
to the top of the role list if needed.

---

## Deploying on Wispbyte

1. **Push the code** — the repository is public, so Wispbyte can deploy
   straight from Git, or you can upload the folder as a zip.
2. **Create the project** — choose the Node.js Docker image. Use **Node 22**
   or newer: the bot uses the built-in `node:sqlite` module when it is
   available and falls back to a JSON file automatically on older versions.
3. **Startup tab → Additional Node Packages** — leave empty if the image
   already contains the dependencies, or add `discord.js@14`, `dotenv`,
   `express` and `mongoose`. (Running `npm install` inside the container is
   also fine.)
4. **Startup tab → Environment Variables** — add every variable from the
   [Configuration](#configuration) table. Secrets go here, never in a file:

   ```
   DISCORD_TOKEN=...
   DISCORD_CLIENT_ID=...
   DISCORD_GUILD_ID=...
   AI_PROVIDER=groq
   AI_API_KEY=...
   AI_MODEL=openai/gpt-oss-120b
   AI_ADMIN_USER_IDS=...
   AI_AUDIT_CHANNEL_ID=...
   PORT=3000
   ```

5. **Startup command** — use:

   ```
   node index.js
   ```

6. **Data directory** — the SQLite file is written to `./data` (override with
   `DATA_DIR`). File-based storage is allowed on the free tier; mount a
   volume on `/app/data` if you want the audit log to survive a redeploy.
7. **Start the project** and watch the console. A healthy start-up looks like:

   ```
   2026-10-23T10:00:00.000Z [INFO] eternalz MONGO_URI is not set - running without the optional database connection.
   2026-10-23T10:00:00.100Z [INFO] eternalz storage: sqlite store ready
   2026-10-23T10:00:00.200Z [INFO] eternalz ai: provider ready
   2026-10-23T10:00:00.300Z [INFO] eternalz Runtime services ready.
   2026-10-23T10:00:01.000Z [INFO] eternalz Bot is online!
   ```

   Missing configuration is reported at start-up **without printing any
   secret** — for example
   `startup: DISCORD_TOKEN is not set (the bot cannot connect to Discord).`

8. **Register the commands once** if they do not appear. Either restart the
   bot (it registers at start-up) or run `npm run register:guild` locally with
   the same `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID`.

### Notes for the free tier

* The bot is small: ~250 MB of RAM is enough. There is no database server to
  run — SQLite and the JSON fallback are both file-based.
* Shared outbound IP addresses can make Discord return HTTP 429. The bot
  retries transient failures with backoff and reports rate limits clearly.
* Some free-tier models are flaky. The `AI_FALLBACK_PROVIDERS` chain lets the
  bot switch to another provider automatically.

---

## Local development

```bash
git clone https://github.com/WaquarShaikh5555/Eternalz.git
cd Eternalz
npm install
cp .env.example .env      # fill it in
npm run register:guild    # register the slash commands
npm start
```

Useful commands:

```bash
npm test          # run the test suite (node:test)
npm run check     # syntax-check the entry points
npm run verify    # check + test
```

---

## Project layout

```
index.js                      entry point: client, command loader, registration
webserver.js                  keep-alive HTTP server
config/deploy-commands.js     standalone slash-command registration
commands/
  admin/ai.js                 /ai
  admin/ai-status.js          /ai-status
  admin/ai-audit.js           /ai-audit
  admin/add-admin.js          /add-admin
  fun/, utility/              the existing commands
src/
  config/env.js               environment parsing, validation, redaction
  core/                       logger, errors, retry, rate limiter
  storage/                    SQLite driver + JSON fallback + factory
  ai/
    provider.js               provider factory and fallback chain
    openai-compatible.js      Groq / OpenRouter / OpenAI (fetch based)
    gemini.js                 native Gemini API
    planner.js                inspection phase + planning phase
    validate.js               dependency-free JSON-Schema subset validator
  discord/
    events.js                welcome / onboarding on guildMemberAdd
    snapshot.js               bounded server-state snapshot
    permissions.js            permission and hierarchy checks
    resolve.js                name/id resolution
    tools/                    the tool allowlist
  admin/
    authorization.js          environment + per-guild grant authorization
    grants.js                 persistent guild-scoped administrator grants
    owner.js                  Discord application-owner verification
    risk.js                   risk classification
    confirmation.js           pending plans, buttons, expiry
    executor.js               paced, retried, verified execution
    service.js                end-to-end orchestration
  audit/audit.js              audit trail (database + optional channel)
test/                         node:test suite
```

There are **no new npm dependencies** — the AI providers use the built-in
`fetch`, validation uses a small hand-written schema checker and the database
uses Node's built-in `node:sqlite`.

---

## Tests

```bash
npm test
```

163 tests covering:

* **authorisation** — owner, configured/granted admins, configured roles, ordinary
  members, the wrong guild, and the guarantee that *the AI provider is never
  contacted* for an unauthorised request;
* **risk classification** — every destructive and privileged operation, plus
  the bulk-deletion and bulk-access-removal escalation;
* **tool-call validation** — unknown tools, wrong types, missing fields,
  unknown fields, out-of-range values and enum violations;
* **model-response validation** — malformed tool calls, duplicate actions,
  oversized plans and prose-only answers;
* **duplicate prevention** — existing channels, categories and roles are
  skipped, not duplicated;
* **confirmation** — requester binding, expiry, cancellation and the
  two-step confirmation for especially destructive plans;
* **partial failure reporting** — "1 change applied, 1 failed" with the
  individual failures listed;
* **the emergency write switch** — `AI_WRITE_ENABLED=false` blocks every
  change while the rest of the bot keeps working;
* **storage** — SQLite and JSON drivers, round-trips and restarts;
* **the provider wire format** — request bodies, tool-call parsing, 429 →
  quota error, 401 → no retry, 5xx → retry, invalid JSON, and the native
  Gemini format (against a local HTTP server);
* **the full request flow** — a plain-language request that really creates a
  category and a channel through the mocked Discord API.

---

## Emergency switches

| Situation | Action |
| --- | --- |
| The AI is misbehaving | Set `AI_ADMIN_ENABLED=false` and restart — `/ai` is disabled, every other command keeps working |
| The AI must not change anything | Set `AI_WRITE_ENABLED=false` — the bot can still inspect and plan, but writes are refused |
| A plan is stuck | It expires automatically after `AI_CONFIRM_TIMEOUT_MS` |
| The provider is out of quota | The bot says so clearly and stays usable |

---

## Known limitations

* The AI can only work with the tools listed in
  [docs/capabilities.md](docs/capabilities.md). It cannot, for example, create
  a webhook, edit a member's nickname, manage emojis, change the server name
  or icon, or schedule a message.
* Privileged roles (anything carrying `Administrator`, `ManageGuild`,
  `ManageRoles`, …) can be created with confirmation but can never be assigned
  or removed from a member by the AI.
* Deletions, bans and kicks cannot be rolled back by the bot. The audit log
  records the previous state of *reversible* changes (previous name, previous
  topic, previous permissions) so an administrator can undo them by hand.
* Free AI tiers are rate limited. One `/ai` request costs at least two model
  calls.
* The AI administrator is restricted to a single guild (`DISCORD_GUILD_ID`).
* The bot does not implement a dashboard; everything happens through the slash
  commands.
