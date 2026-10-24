# Environment variables - where to get each one and where to put it

## The short version

| Variable | Where you get it | Where you put it |
| --- | --- | --- |
| `DISCORD_TOKEN` | Discord Developer Portal → your application → **Bot** → **Reset Token** → **Copy** | Wispbyte → your server → **Startup** → **Environment Variables** |
| `DISCORD_CLIENT_ID` | Developer Portal → **General Information** → **Application ID** → **Copy** | same |
| `DISCORD_GUILD_ID` | Discord app → right-click your server → **Copy Server ID** (needs Developer Mode) | same |
| `AI_API_KEY` | Groq: <https://console.groq.com/keys> → **Create API Key** | same |
| `AI_PROVIDER` | You choose it yourself: `groq` (recommended), `openrouter`, `gemini`, `openai` | same |
| `AI_MODEL` | You choose it yourself: `openai/gpt-oss-120b` (recommended) | same |
| `AI_MAX_OUTPUT_TOKENS` | Optional; keep `512` for Groq's free tier | same |
| `AI_ADMIN_USER_IDS` | Optional static allowlist; alternatively use `/add-admin user:@member` | same |
| `AI_MULTI_GUILD` | Optional; set `true` to permit configured/granted access in other servers | same |
| `AI_AUDIT_CHANNEL_ID` | Discord app → right-click a private channel → **Copy Channel ID** | same |
| `AI_ADMIN_ENABLED` | You set it: `true` or `false` | same |
| `AI_WRITE_ENABLED` | You set it: `true` or `false` | same |
| `STORAGE_DRIVER` | You set it: `auto` (recommended), `sqlite`, `json` | same |
| `DATA_DIR` | You set it: `./data` (recommended) | same |
| `PORT` | You set it: `3000` | same |
| `LOG_LEVEL` | You set it: `info` | same |

## 1. Turn on Developer Mode in Discord (needed for all the ids)

1. Open Discord (desktop app or browser).
2. Click the gear icon ⚙️ next to your username → **User Settings**.
3. Left sidebar → **Advanced** (under "App Settings").
4. Switch **Developer Mode** ON.
5. Close the settings. Now every right-click menu has a **Copy … ID** option.

## 2. `DISCORD_TOKEN` - the bot's password

1. Go to <https://discord.com/developers/applications>.
2. Click **New Application** (or open the existing `Eternalz` application).
3. Give it a name → **Create**.
4. Left sidebar → **Bot**.
5. Click **Reset Token** → confirm → **Copy**.
6. That long string is your `DISCORD_TOKEN`.

> ⚠️ Treat this like a password. Anyone who has it can control your bot.
> Never paste it into a GitHub file, a Discord message or a screenshot.
> If it ever leaks, click **Reset Token** again - the old one stops working.

**Optional on the same page:** the **Message Content Intent** switch is only
needed by the older `/aichat` and `/search` commands. The AI administrator does
**not** need it, so you can leave it off if you prefer.

## 3. `DISCORD_CLIENT_ID` - the application id

1. Still in the Developer Portal, left sidebar → **General Information**.
2. Copy the **Application ID** field (a long number).
3. That is your `DISCORD_CLIENT_ID`.

This is *not* the token and *not* the public key - it is the plain number
labelled "Application ID".

## 4. `DISCORD_GUILD_ID` - the primary AI administration server

1. In Discord, right-click your **server name / icon** in the left sidebar.
2. Click **Copy Server ID**.
3. Paste that number into `DISCORD_GUILD_ID`.

Without this, the AI administration refuses to work at all (by design - it
must never act on a server you did not name).

## 5. `AI_API_KEY` - the brain

### Recommended: Groq

1. Go to <https://console.groq.com/keys>.
2. Sign in (a Google account works, no credit card needed).
3. Click **Create API Key**, give it a name, copy the key.
4. It starts with `gsk_...` - that is your `AI_API_KEY`.

Then set:

```
AI_PROVIDER=groq
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=gsk_...
```

### Alternative: OpenRouter

1. <https://openrouter.ai/keys> → sign in → **Create Key**.
2. The key starts with `sk-or-...`.

```
AI_PROVIDER=openrouter
AI_MODEL=openrouter/free
AI_API_KEY=sk-or-...
```

### Alternative: Google Gemini

1. <https://aistudio.google.com/apikey> → **Get API key** → **Create API key**.
2. The key starts with `AIza...`.

```
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash-lite
AI_API_KEY=AIza...
```

### Any OpenAI-compatible provider

```
AI_PROVIDER=custom
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=the-model-id
AI_API_KEY=...
```

## 6. `AI_ADMIN_USER_IDS` - optional static `/ai` allowlist

You do not need to add every person here. The Discord application owner can
instead grant access in the current server with:

```text
/add-admin user:@member
```

Only the application owner can use that command, and only where they also own
the server or have **Administrator** / **Manage Server**. Grants are persisted
per server and never let the recipient add other administrators.

For a static environment-based allowlist, right-click a user's avatar, choose
**Copy User ID**, and paste the numeric IDs separated by commas:

```env
AI_ADMIN_USER_IDS=111111111111111111,222222222222222222
```

The primary-server owner never needs to be listed. A static ID or an
`/add-admin` grant is required for other users; a Discord role by itself is not
sufficient.

### Optional: use `/ai` in other servers you administer

Keep `DISCORD_GUILD_ID` pointed at the primary server and set:

```env
AI_MULTI_GUILD=true
```

`AI_ADMIN_USER_IDS` is optional if you use `/add-admin`. Outside the primary
server, statically configured users must also own the current server or have
**Administrator** / **Manage Server**. A user added through `/add-admin` instead
receives exactly one persisted guild grant. Neither kind of access carries over
to another server, and primary-server role IDs are never reused.

Run `npm run register:global` after enabling this (or restart with automatic
registration enabled). Global command propagation can take up to an hour. The
bot must also be invited to each server with the permissions required for the
changes you request.

## 7. `AI_AUDIT_CHANNEL_ID` - optional private log channel

1. In your server, create a **private text channel** (e.g. `#ai-audit`) that
   only you and the bot can see.
2. Right-click the channel → **Copy Channel ID**.
3. Put it in `AI_AUDIT_CHANNEL_ID`.

Every request, plan, confirmation, cancellation, success and failure is then
mirrored into that channel. Leave it empty to keep the log in the database
only (`/ai-audit` still works).

## 8. The rest (you choose the values yourself)

```
AI_ADMIN_ENABLED=true        # false = turn /ai off completely
AI_WRITE_ENABLED=true        # false = inspect and plan, but never change anything
AI_MAX_PLANNING_ROUNDS=1     # keep free-tier requests small
AI_MAX_OUTPUT_TOKENS=512     # completion budget per model call
STORAGE_DRIVER=auto          # auto = SQLite when available, JSON otherwise
DATA_DIR=./data              # where the database file lives
PORT=3000                    # keep-alive web server
LOG_LEVEL=info               # debug for more detail
```

## 9. Where to put them - Wispbyte

1. Open the Wispbyte panel and select your server.
2. Go to the **Startup** tab.
3. Scroll to **Environment Variables**.
4. For each variable, add a row: **Key** = the name (e.g. `DISCORD_TOKEN`),
   **Value** = the value (e.g. the token).
5. Save.
6. Still in **Startup**, set the **Startup Command** to:

   ```
   node index.js
   ```

7. Restart the server (or start it if it is stopped).
8. Watch the console. You should see `storage: sqlite store ready`,
   `ai: provider ready`, and `Bot is online!`.

> Do **not** put the secrets in a `.env` file that you upload, and do not put
> them in `index.js`. The panel's environment variables are the right place.

## 10. Where to put them - local development

Copy the example file and fill it in:

```bash
cp .env.example .env
nano .env
```

`.env` is already in `.gitignore`, so it will never be committed.

## 11. A complete working example (placeholders only)

```
DISCORD_TOKEN=PASTE_YOUR_BOT_TOKEN_HERE
DISCORD_CLIENT_ID=1234567890123456789
DISCORD_GUILD_ID=987654321098765432
AI_PROVIDER=groq
AI_MODEL=openai/gpt-oss-120b
AI_API_KEY=gsk_PASTE_YOUR_GROQ_KEY_HERE
AI_ADMIN_USER_IDS=1111111111111111111
AI_AUDIT_CHANNEL_ID=
AI_ADMIN_ENABLED=true
AI_WRITE_ENABLED=true
STORAGE_DRIVER=auto
DATA_DIR=./data
PORT=3000
LOG_LEVEL=info
```

## 12. How to check that it worked

In your server, run `/ai-status`. It shows, without revealing any secret:

* the provider, the model and the base URL,
* whether the API key is configured,
* whether write operations are enabled,
* the target server and the audit channel.

If something is missing, the startup console also prints a clear line such as
`startup: DISCORD_TOKEN is not set (the bot cannot connect to Discord).`
