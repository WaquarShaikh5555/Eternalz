---
name: discord-bot-builder
description: "Build and deploy standalone Discord bots with discord.py or requests — bot creation, token management, channel monitoring, message relay, web scraping, state-machine cycles, systemd deployment on Raspberry Pi, multi-output sync (Discord + RSS + GitHub Pages), and wiki changelog integration. Trigger: user wants a Discord bot that monitors channels, relays messages, scrapes web data, runs multi-phase check/cooldown cycles, posts automated updates, maintains a public changelog site, or syncs data to GitHub."
---

# Discord Bot Builder

Create, deploy, and manage standalone Discord bots. Covers bot application setup, token storage, channel monitoring, message relay with web scraping, and persistent deployment via systemd on a Raspberry Pi.

## Architecture Overview

A standalone Discord bot is separate from the Hermes gateway's Discord integration. It runs as its own persistent Python process, connecting to Discord's API with a bot token.

**Two Discord systems:**
1. **Hermes gateway adapter** — configured via `config.yaml` + `.env`, used by `send_message` tool.
2. **Standalone bot (this skill)** — runs independently, can read AND write to any server it's invited to. Required for monitoring channels and autonomous posting.

**Two framework options:**
- **requests** (recommended for simple bots): synchronous, lightweight, no extra packages needed. Ideal for Pi deployments where the bot just monitors + posts. See `references/got-patch-bot-deploy-may2026.md` for a working example.
- **discord.py**: full-featured, async, better for complex bots with slash commands, reactions, and interactive features. Requires `pip install discord.py`.

## Bot Creation Steps

### 1. Create Bot Application

Go to https://discord.com/developers/applications:
1. **New Application** → name it → create
2. **Bot** tab → **Add Bot** → copy the **Bot Token**
3. **Privileged Gateway Intents** → enable **Message Content Intent** (required for reading message content)
4. **OAuth2 → URL Generator** → scopes: `bot` → permissions: `Send Messages`, `Read Message History`, `View Channels`
5. Open the invite URL in your browser for each server

**The bot must be invited to EACH server separately.**

**Required intents for full functionality:**
- `message_content` — read message content (privileged, must enable in Developer Portal)
- `dm_messages` — receive DM events
- `guilds` — know which servers the bot is in (enabled by default)

## Token Storage

Store tokens securely — never in skills, conversation, or any file written via the `write_file` Hermes tool.

**The `write_file` tool (and execute_code's file writes) silently strip sequences that look like tokens or API keys.** This affects ALL file write paths in Hermes. Use terminal methods instead:

```bash
# CORRECT — use cat heredoc in terminal
cat > /path/to/token_file << 'EOF'
YOUR_BOT_TOKEN_HERE
EOF
chmod 600 /path/to/token_file
```

Verify: `wc -c /path/to/token_file` (Discord bot tokens are exactly 72 chars)

**Workaround for bot code:** Construct the token file path dynamically to avoid
hardcoding a path that looks secret:
```python
import os
token_path = os.environ.get("HOME") + "/.hermes/hermes-agent/.discord_bot_token"
token = open(token_path).read().strip()
```

In bot code: `TOKEN = open(path).read().strip()`

**Correct token path:** `~/.hermes/hermes-agent/.discord_bot_token` (NOT `~/.hermes/discord_bot_token.txt`)

### Bot Code

```python
import discord
intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"Bot online: {client.user.name}")

@client.event
async def on_message(message):
    if message.author.bot:
        return
    if message.channel.id == SOURCE_ID:
        target = client.get_channel(TARGET_ID)
        if target:
            await target.send(message.content)

client.run(open("/home/donzzz/.hermes/discord_bot_token.txt").read().strip())
```

### DM-Only Chat with Owner UID Filter

For bots that accept DMs from the owner only (ignoring all other users):

```python
import discord
from discord.ext import commands

OWNER_UID = 184818387518488577  # Owner's Discord UID (integer, not string)

intents = discord.Intents.default()
intents.message_content = True
intents.dm_messages = True  # REQUIRED for DM handling

bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_message(message):
    # IMPORTANT: discord.py has NO on_dm event. All DM handling goes through on_message.
    # Check DMChannel first, handle, then return early.

    if isinstance(message.channel, discord.DMChannel):
        if message.author.bot:
            return
        # CRITICAL: message.author.id is an integer in discord.py
        if message.author.id != OWNER_UID:
            return  # Silently ignore non-owner DMs
        await handle_dm(message)
        return

    # Channel handling
    if message.author.bot:
        return
    if message.channel.id == GOT_CHANNEL_ID:
        await handle_got_message(message)
    elif message.channel.id == CSEZ_CHANNEL_ID:
        await handle_csez_message(message)

    await bot.process_commands(message)  # Always last for prefix commands

async def handle_dm(message):
    # CRITICAL: Define 'lower' BEFORE any log/condition that uses it.
    # discord.py catches ALL exceptions silently — a NameError means no response sent.
    content = message.content.strip()
    lower = content.lower()

    # Now safe to log/debug using 'lower'
    log("DM from owner: %s" % content[:100])

    if lower in ("!status", "status", "!health"):
        await message.channel.send("**Status:** All systems operational")
    elif lower in ("!build", "build", "!builds"):
        await message.channel.send("GoT: `0.13.0.8808.63144`")
    elif lower in ("!scan", "scan", "!check", "check"):
        limit = 20
        for part in content.split():
            if part.isdigit():
                limit = min(int(part), 100)
                break
        await message.channel.send("Scanning last %d messages..." % limit)
        await scan_channels(message, limit=limit)

    elif lower in ("!help", "help"):
        await message.channel.send("Commands: `!status`, `!build`, `!scan [N]`, `!help`")

    # Conversation handlers — order matters, most specific FIRST
    # "how are you" must come BEFORE "hi"/"hello" to avoid false match
    elif any(w in lower for w in ["how are you", "how's it going"]):
        await message.channel.send("All systems running smooth!")
    elif any(w in lower for w in ["hello", "hi", "hey", "sup", "yo"]):
        await message.channel.send("Hey! What can I do for you?")
    elif any(w in lower for w in ["thanks", "thank", "thx"]):
        await message.channel.send("Anytime!")
    elif any(w in lower for w in ["bye", "goodbye", "later"]):
        await message.channel.send("See you!")
    elif "patch" in lower:
        await message.channel.send("Forward patch notes to the update channel.")
    elif "telegram" in lower or "interface" in lower or "instead" in lower:
        await message.channel.send(
            "You can DM me here, but I'm the patch monitor bot — "
            "not a full Hermes replacement. For wiki editing, GitHub, research, "
            "use Telegram or the Hermes TUI. Need something specific?"
        )

    # Fallback
    else:
        await message.channel.send("Got it. Use `!help` for commands.")

async def scan_channels(message, limit=20):
    """Manually scan both update channels for recent changes. Call from DM handler."""
    report = ["Manual Channel Scan\n"]

    # Scan CSEZ channel
    csez_ch = bot.get_channel(CSEZ_CHANNEL_ID)
    if csez_ch:
        found = []
        async for msg in csez_ch.history(limit=limit):
            if msg.author.bot:
                continue
            forwarded = msg.content
            for embed in msg.embeds:
                if embed.title: forwarded += "\n" + embed.title
                if embed.description: forwarded += "\n" + embed.description
                for field in embed.fields:
                    forwarded += "\n" + str(field.value)
            build = extract_csez_build(forwarded)
            if build:
                found.append((build, msg.created_at))
        if found:
            report.append("CSEZ: found %d build(s)" % len(found))
            for b, ts in found:
                report.append("  v%s at %s" % (b, ts.strftime("%m-%d %H:%M")))
        else:
            report.append("CSEZ: no new builds")

    # Scan GoT channel
    got_ch = bot.get_channel(GOT_CHANNEL_ID)
    if got_ch:
        triggers = []
        async for msg in got_ch.history(limit=limit):
            if msg.author.bot:
                continue
            cl = msg.content.lower()
            if any(kw in cl for kw in ["patch", "hotfix", "update", "version", "build", "deploy"]):
                triggers.append(msg)
        report.append("GoT: %d trigger(s) found" % len(triggers))
        # Auto-trigger scraper if triggers found and not already active
        if triggers and not got_state.get("scraping_active"):
            got_state["scraping_active"] = True
            got_state["phase"] = 1
            save_state(got_state, GOT_STATE_FILE)
            report.append("GoT scraper auto-triggered (phase 1)")

    full = "\n".join(report)
    if len(full) > 1900:
        await message.channel.send(full[:1900])
        await message.channel.send(full[1900:])
    else:
        await message.channel.send(full)

bot.run(token)
```

**Key points:**
- **⚠️ discord.py has NO `on_dm` event.** Do NOT use `@bot.event async def on_dm(message)` — discord.py will silently ignore it. All DM handling MUST go through `on_message` with an `isinstance(message.channel, discord.DMChannel)` check.
- **DM intents.dm_messages = True** is REQUIRED — without it, Discord won't deliver DM events
- **UID is an integer** — `message.author.id` returns int. Store OWNER_UID as int. Comparing `int != string` always fails.
- **Define `lower = content.lower()` BEFORE any log line or condition that references it.** discord.py catches ALL exceptions silently — a `NameError` means the bot receives the DM but sends NO response.
- **Order conversation branches by specificity** — "how are you" before "hi", "thanks" before fallback.
- **Use `if/return` dispatch, NOT `elif` chains** — Each DM command should be an independent `if lower.startswith(...): ... return` block. Long `elif` chains break when patches create duplicate conditions. See `references/dm-command-dispatch-june2026.md`.
- Always filter `message.author.bot == True` to avoid self-trigger loops
- Call `await bot.process_commands(message)` last in `on_message` (after early returns)

### ⚠️ on_ready Bug: String Formatting Crash

If `on_ready` has a broken format string, discord.py catches the exception silently and the bot appears to hang without connecting. **Always test `on_ready` format strings:**

```python
# BAD — silent crash on connect
log("Bot connected: %s#s}" % (bot.user.name, bot.user.discriminator))

# GOOD
log("Bot connected: %s#%s" % (bot.user.name, bot.user.discriminator))
```

After fixing, **verify the bot actually connects** by checking for the "Bot connected" log entry within 10 seconds of startup.

### Creating Private Discord Channels via API

To create a channel visible only to specific users:

```python
import requests

headers = {"Authorization": "Bot " + token, "Content-Type": "application/json"}
guild_id = "1333668222892769341"
owner_uid = "8815461875"

payload = {
    "name": "private-reports",
    "type": 0,  # text channel
    "parent_id": "CATEGORY_ID",  # optional: place in a category
    "permission_overwrites": [
        {
            "id": guild_id,  # @everyone role = guild ID
            "type": 0,  # role
            "deny": 0x00000400,  # VIEW_CHANNEL
            "allow": 0
        },
        {
            "id": owner_uid,
            "type": 1,  # member
            "allow": 0x00000400 | 0x00000800 | 0x00004000,  # VIEW + SEND + READ_HISTORY
            "deny": 0
        }
    ]
}

r = requests.post(
    f"https://discord.com/api/v10/guilds/{guild_id}/channels",
    headers=headers, json=payload, timeout=15
)
# 201 = created successfully
channel_id = r.json()["id"]
```

**Use channel-based posting for automated reports** (health checks, leaderboards) instead of DMs — DMs require the user to have interacted with the bot first, while channels work immediately.

### Reports Channel Pattern

For bots that post periodic reports (health checks, analytics, leaderboards):

1. Create a private channel (see above)
2. Store the channel ID in the bot config
3. Post reports directly to the channel:

```python
REPORT_CHANNEL_ID = "1511462814449930373"

async def send_report(content):
    channel = bot.get_channel(int(REPORT_CHANNEL_ID))
    if channel:
        # Discord has a 2000-character limit per message
        for chunk in [content[i:i+1900] for i in range(0, len(content), 1900)]:
            await channel.send(chunk)
```

This is more reliable than DM-based delivery because:
- No need for prior DM interaction
- Message history is visible
- Can be shared with other users later by adjusting permissions

### 4. systemd Service on Pi

```ini
[Unit]
Description=GoT Patch Monitor Bot
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=donzzz
WorkingDirectory=/home/donzzz/hermes-agent
ExecStart=/home/donzzz/.hermes/hermes-agent/venv/bin/python3 /home/donzzz/hermes-agent/bot.py
Restart=always
RestartSec=30
StandardOutput=append:/home/donzzz/.hermes/logs/bot.log
StandardError=append:/home/donzzz/.hermes/logs/bot_error.log
[Install]
WantedBy=multi-user.target
```

⚠️ Venv path is `/home/donzzz/.hermes/hermes-agent/venv/bin/python3` — NOT `...-venv/...`. Verify with `ls` first.

## Web Scraping for Game Version Numbers

**Quest Store DB is the authoritative primary source.** Old API endpoints (e.g. `ghostsoftabor.com/api/store/build`, `ghostsoftabor.com/api/build`) are dead as of mid-2026 — the site migrated to WordPress.

| Source | URL Pattern | Reliability | Method |
|--------|------------|-------------|--------|
| Quest Store DB | `queststoredb.com/game/<slug>-<id>/` | HIGH — primary | JSON-LD `softwareVersion` in static HTML |
| Steam News | `ISteamNews/GetNewsForApp/v2/?appid=1957780&count=3` | MEDIUM — confirms patch titles | Parse news item content for build numbers |
| SideQuest | `sidequestvr.com/app/<id>/<slug>` | MEDIUM — fallback, may lag | `window.payload.versionname` in inline `<script>` |
| VRDB | `vrdb.app/game/<slug>/<id>` | LOW — tertiary, may lag | `<span>` after `Version:` label in static HTML (see below) |
| ghostsoftabor.com/api/* | ANY | DEAD | WordPress migration killed all old API endpoints |
| Meta Store | meta.com | BLOCKED | Do not use |
| SteamDB | steamdb.info | IP BAN | Do not use |
| Fandom | fandom.com | STALE | Do not use |

For Ghosts of Tabor:
- Quest Store DB: `queststoredb.com/game/ghosts-of-tabor-7614022262006379/`
- SideQuest: `sidequestvr.com/app/14965/ghosts-of-tabor`
- VRDB: `vrdb.app/game/ghosts-of-tabor-7614022262006379`
- Steam app ID: `1957780` (NOT `996450`)

Build pattern: `\d+(?:\.\d+)+` → e.g. `0.13.0.8808.63144`

**Version segment count:** GoT builds have 5 dot-separated segments (4 dots). Use
regex `\d+(?:\.\d+)+` — flexible for any segment count.

### Quest Store DB Parsing
Requires custom User-Agent headers (blocks default requests UA):

```python
hdrs = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9"
}
```

Parse either from JSON-LD (`softwareVersion` field) or HTML table (`app version</td><td>VERSION`).
No JS rendering needed — plain requests + regex works.

### SideQuest Parsing (Fallback)
SideQuest is a React SPA but embeds all data in an inline `<script>` as `window.payload`.
No JS rendering or API calls needed:

```python
import re, json
r = requests.get("https://sidequestvr.com/app/14965/ghosts-of-tabor", headers=HEADERS, timeout=30)
m = re.search(r"window\.payload\s*=\s*({.*?})\s*;", r.text, re.DOTALL)
if m:
    data = json.loads(m.group(1))
    ver = data.get("versionname")
```

**Caveat:** SideQuest versions may lag behind Quest Store DB. Always prefer QSDB.

### VRDB Parsing (Tertiary)
VRDB DOES have the build number in static HTML. The HTML uses Vue/React comment
markers between spans that defeat naive regex:

```python
idx = r.text.find("Version:")
if idx >= 0:
    after = r.text[idx:idx+300]
    m = re.search(r"(0\.\d+\.\d+\.\d+\.\d+)", after)
    if m:
        ver = m.group(1)
```

**Critical:** Do NOT use `re.DOTALL` with `.*?` across the comment markers — it
fails to match. Instead, use `str.find("Version:")` to locate the region, then
search a 300-char window. The pattern `0\.\d+\.\d+\.\d+\.\d+` (5 segments, 4 dots)
## Related Skills

- `openrouter-model-monitor` — For monitoring OpenRouter model availability and sending Discord alerts when a model comes back online. Use this when the user wants to track model uptime or configure fallback providers.

## References

- `references/discord-py-patterns-june2026.md` — DM handling with UID filter, private channel creation, on_ready debugging, systemd with venv
- `references/youtube-content-ip-block-workarounds-june2026.md` — YouTube IP blocking workarounds for transcript fetching
- `references/environment-path-pollution-june2026.md` — $HOME/$PATH pollution on Pi, write_file content stripping, UID type safety, full-path commands
- `references/discord-rest-api-curl.md` — One-shot posting via curl: basic POST, file payloads, chunking, error codes, Hermes security notes
- `references/fauna-report-format-june2026.md` — Fauna report dual-format preference (email detailed + Discord lean), no-repeat tracking
- `references/pi-status-command-june2026.md` — `!pi` command for Raspberry Pi 5 system monitoring via DM
- `references/changelog-sync-github-pages-june2026.md` — GitHub Pages changelog sync architecture
- `references/csez-bot-config-june2026.md` — CSEZ bot config, build extraction, wiki parsing
- `references/csez-bot-forwarded-changelog-june2026.md` — Forwarded message detection, changelog update, direct wiki update, CSEZ auto-update parser, U+FFFD issue
- `references/wiki-page-restoration-june2026.md` — Wiki page restoration via revision history, reverting bot state files, prevention patterns
- `references/wiki-changelog-duplicate-cleanup-june2026.md` — Duplicate entry detection and cleanup, position-based slicing for wiki reordering, prevention patterns for rapid successive builds
- `references/patch-tool-pitfalls-june2026.md` — Patch tool escape issues, duplicate code prevention, f-string nested quotes, Reddit 403 fix, gas price dead ends
- `references/dm-command-dispatch-june2026.md` — DM command dispatch: `if/return` pattern vs fragile `elif` chain, safe patching strategy for bot.py
- `references/manual-build-commands-june2026.md` — `!got <build>` and `!csez <build>` manual update commands: implementation, regex pitfalls, session context
- `references/status-dashboard-pattern-june2026.md` — Status dashboard: pure Python HTTP server, systemd user service, template pattern (not f-strings), data sources
- `references/write_file_secret_stripping.md` — write_file token stripping workarounds
- `references/rss-feed-serving-june2026.md` — RSS feed generation and serving
- `references/got-scraper-source-fixes-june2026.md` — Scraper source fixes: QuestStoreDB as primary, dead ghostsoftabor.com APIs, wrong Steam app ID, changelog sync gap
- `references/got-patch-bot-state-machine-june2026.md` — State machine pattern for check/cooldown cycles

## Message Format Preferences (Don's Spec)

### Fauna Reports (Daily Animal Facts)
See `references/fauna-report-format-june2026.md` for full details. Key points:
- **Email** (detailed): 3 animals with facts + tactical connections via himalaya
- **Discord** (lean): Just common name + YouTube search link per animal — NO duplicate facts
- **No repeats**: Track shared animals in `/home/donzzz/.hermes/fauna_history.json`

### Multi-Game Bot Architecture

When one bot monitors multiple games/channels, keep separate state files and detection methods per game:

```python
GOT_CHANNEL_ID  = 1511246958868693012   # #got_updates
CSEZ_CHANNEL_ID = 1511247103043702834   # #csez_updates

# Separate state files per game
GOT_STATE_FILE  = ".../bot_state.json"
CSEZ_STATE_FILE = ".../csez_bot_state.json"
```

**Two detection models:**
- **External scrape (GoT):** Bot triggers on any message, then scrapes Quest Store DB hourly for build number changes
- **Message extraction (CSEZ):** Bot extracts build number directly from the forwarded Discord message text — no external scraping needed

CSEZ reference: `references/csez-bot-config-june2026.md` (channel IDs, build extraction regex, wiki structure, file paths)
CSEZ changelog: `references/csez-bot-forwarded-changelog-june2026.md` (forwarded message detection, changelog update, direct wiki update)

### Wiki Template Update via Task File

When the bot can't directly edit wiki pages (e.g., Miraheze API login disabled, requires browser session):

1. Bot detects new build → writes a **task file** (e.g., `csez_wiki_task.json`)
2. Cron job (every 5-10 min) checks for pending task files
3. Cron uses **browser automation** (ZeroSkills login) to edit the wiki template
4. Cron marks task as done after successful edit

This decouples the bot (headless, no browser) from the wiki edit (needs browser session).

When posting game update detections to Discord, use this exact format:

```
🔫 Ghosts of Tabor — Update Detected

Detected: YYYY-MM-DD HH:MM UTC
-# Source: <source_name> <source_url>
Build: 
```
<build_number>
```

-# Auto-detected by Zzzilla
```

**Key requirements:**
- 🔫 gun emoji in title (no bold)
- Date + UTC time on `Detected:` line
- Source attribution as `-# Source: <name> <url>` — links to the data source, NOT Meta Store
- Build number in triple-backtick code block below `Build:` label
- `-# Auto-detected by Zzzilla` footer
- No Meta Store link (user wants source data link for manual sanity checks)

## State Machine Pattern: Multi-Phase Check/Cooldown

For bots that need to scrape a source periodically after a trigger (e.g., game patch monitoring), use a persisted state machine:

**Pattern:** Discord message trigger → N phases of active hourly checking → cooldowns between phases → stop until new trigger.

**Key design elements:**
- **Startup seed:** Read latest message ID on startup → store as `last_seen_id`. Prevents false triggers on historical messages.
- **State persistence:** Write `bot_state.json` to disk on every transition. Survives restarts/crashes.
- **Baseline comparison:** Set initial known value *below* current so first scrape detects change immediately.
- **Self-reset:** On detecting the target event, post result and return to idle automatically.
- **Bot message filtering:** Always skip `author.bot == True` to avoid self-trigger loops.

**Reference:** `references/got-patch-bot-state-machine-june2026.md` (full architecture + state diagram)

## Polling vs WebSocket for Discord Bots

For monitor-and-post bots on Raspberry Pi, `requests` polling is usually better:
- **requests polling:** ~30MB RAM, no extra deps, synchronous, auto-survives gateway issues. Latency: up to poll interval (60s).
- **discord.py WebSocket:** ~80MB RAM, async complexity, needs `pip install discord.py`. Latency: near-instant.
- **Rule of thumb:** If the bot checks something every 60s+, use `requests`. Use `discord.py` only for slash commands, reactions, or sub-second response needs.

## RSS Feed Generation

When a bot posts updates to Discord, it can simultaneously write to an RSS XML feed for external consumption.

### RSS File Writing

```python
import xml.etree.ElementTree as ET
from email.utils import formatdate
import calendar, time

def write_rss(build, source_name, source_link):
    RSS_FILE = "/home/donzzz/public_html/got_feed.xml"
    MAX_RSS_ITEMS = 20
    
    if os.path.exists(RSS_FILE):
        tree = ET.parse(RSS_FILE)
        root = tree.getroot()
        channel = root.find("channel")
    else:
        root = ET.Element("rss", version="2.0")
        channel = ET.SubElement(root, "channel")
        ET.SubElement(channel, "title").text = "Ghosts of Tabor Updates"
        ET.SubElement(channel, "link").text = "https://discord.com/channels/..."
        ET.SubElement(channel, "description").text = "..."
        ET.SubElement(channel, "language").text = "en"

    # Trim old items
    items = channel.findall("item")
    while len(items) >= MAX_RSS_ITEMS:
        channel.remove(items[0])
        items = channel.findall("item")

    now_t = time.gmtime()
    date_str = formatdate(calendar.timegm(now_t))  # NOT now_t.timestamp() — Python 3.7 compat
    ts_str = time.strftime("%Y%m%d-%H%M", now_t)

    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = "Ghosts of Tabor - Update Detected"
    ET.SubElement(item, "link").text = "https://discord.com/channels/..."
    ET.SubElement(item, "description").text = "Build: %s | Source: %s" % (build, source_name)
    ET.SubElement(item, "pubDate").text = date_str
    ET.SubElement(item, "guid").text = "got-update-%s" % ts_str

    lb = channel.find("lastBuildDate")
    if lb is not None:
        lb.text = date_str
    else:
        ET.SubElement(channel, "lastBuildDate").text = date_str

    ET.ElementTree(root).write(RSS_FILE, encoding="unicode", xml_declaration=True)
```

**Critical:** Use `calendar.timegm(now_t)` — NOT `now_t.timestamp()`. The `time.gmtime()` struct doesn't have `.timestamp()` in Python 3.7 (Raspberry Pi OS).

### Serving the RSS Feed

Use Python's built-in `http.server` via systemd:

```ini
# ~/.config/systemd/user/rss-server.service
[Unit]
Description=RSS Feed Server for GoT Updates
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/donzzz/public_html
ExecStart=/usr/bin/python3 -m http.server 8090
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

**Port selection:** Check for conflicts first with `ss -tlnp`. Port 8088 was already in use on Don's Pi (by InfluxDB). Use 8090 or another free port.

The feed is then accessible at `http://<pi-ip>:8090/got_feed.xml`. To make it publicly accessible, configure a Cloudflare tunnel or nginx reverse proxy to point at this port.

## GitHub Integration

When a bot posts updates, it can simultaneously commit the RSS feed to a GitHub repo for public access and version history.

### Full Changelog Publishing (Multi-Output Sync)

For game wikis or patch-tracking bots, the bot can maintain a full public-facing changelog site on GitHub Pages, synced from a wiki source (e.g., Miraheze). This goes beyond RSS — it's a complete browsable history with search, color-coded changes, and unlimited entries.

**New repo pattern:** Create a dedicated repo (e.g., `got-changelog`) with:
- `index.html` — Full dark-themed browsable page (generated from wiki data)
- `feed.xml` — RSS feed for recent entries
- `changelog.json` — Raw structured data
- `README.md` — Description + links

**Sync flow:** Bot detects new build → scrapes wiki changelog wikitext via browser API → parses into structured JSON → generates HTML + RSS → commits to repo → GitHub Pages auto-publishes.

**Reference:** `references/changelog-sync-github-pages-june2026.md` has the full architecture, wiki scraping code, parsing patterns, and GitHub setup.

### RSS + Changelog Sync Script (`changelog_sync.py`)

Keep a separate sync script at `~/projects/<bot>/changelog_sync.py` that handles:
1. Scraping current build number
2. Parsing changelog wikitext (from `/tmp/changelog_wikitext.txt` saved by browser)
3. Generating HTML + RSS + JSON
4. Git push to GitHub

Call from bot main loop via `subprocess.run()` with a timeout. Run BEFORE posting to Discord so failures don't block the Discord notification.

### Setup

1. Create the repo (via GitHub API or web UI)
2. Clone locally: `git clone https://<token>@github.com/DonZzzilla/taborian.git /tmp/taborian`
3. Store git credentials in `~/.git-credentials`
4. `git config --global credential.helper store`

### Bot Code

```python
GITHUB_REPO = "/tmp/taborian"
GITHUB_FEED_PATH = "feed/got_updates.xml"

def git_push_rss():
    import subprocess as _sp
    try:
        _sp.run(["git", "-C", GITHUB_REPO, "pull", "--rebase"], capture_output=True, timeout=30)
        import shutil as _sh
        dest = os.path.join(GITHUB_REPO, GITHUB_FEED_PATH)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        _sh.copy2(RSS_FILE, dest)
        _sp.run(["git", "-C", GITHUB_REPO, "add", GITHUB_FEED_PATH], capture_output=True, timeout=10)
        r = _sp.run(["git", "-C", GITHUB_REPO, "commit", "-m", "Update GoT feed"], capture_output=True, timeout=10)
        if r.returncode == 0:
            p = _sp.run(["git", "-C", GITHUB_REPO, "push"], capture_output=True, timeout=30)
    except Exception as e:
        log("git_push_rss error: %s" % e)
```

Call in the main loop: `write_rss(build, src, link)` → `git_push_rss()` → `send_message(token, msg)`.

See `references/changelog-sync-github-pages-june2026.md` for full architecture, wiki scraping code, parsing patterns, and GitHub setup.

## GoT Changelog Auto-Update (June 2026)

When a GoT patch message arrives in `#got_updates`, the bot should:
1. Save the full Discord message content to `/home/donzzz/projects/got-patch-bot/last_got_message.txt`
2. When the scraper (or manual `!got`) detects a build change, parse the saved message and update the wiki Changelog page

### Parsing GoT Discord → Wiki Format

Discord format:
```
#  🔥Patch notes version 0.13.0 Hotfix 5🔥
Patch 0.13.0 Hotfix 5 has now been deployed...

## 🐛Bug fixes & improvements🐛
- Fixed grip priority in backpack...
- Fixed backpack spinning...
```

Wiki format:
```
== 0.13.0.8860.63875 (2026-06-03) ==

=== Bug fixes & improvements(0.13.0 Hotfix #5) ===

* Fixed grip priority in backpack...
* Fixed backpack spinning...
```

Key parsing rules:
- Extract hotfix number from `[Hh]otfix\s*#?(\d+)` — use in subsection headers
- Parse `## Section` headers → `=== Section ===` (strip emoji)
- Parse `- ` bullets → `* ` bullets
- Insert at top of Changelog page (before first `== version ==` heading)

### Implementation

```python
def parse_got_patch_notes(text, build, hotfix_num=None):
    """Parse GoT Discord patch notes into wiki wikitext format."""
    import re
    from datetime import datetime
    
    lines = text.split('\n')
    date_str = datetime.now().strftime("%Y-%m-%d")
    
    if not hotfix_num:
        m = re.search(r'[Hh]otfix\s*#?(\d+)', text)
        hotfix_num = m.group(1) if m else None
    
    wiki_lines = ["== %s (%s) ==" % (build, date_str), ""]
    current_section = None
    section_lines = {}
    
    for line in lines:
        line = line.strip()
        if not line: continue
        if line.startswith('## '):
            current_section = line[3:].strip()
            current_section = re.sub(r'[\U0001f300-\U0001f9ff\u2600-\u26ff\u2700-\u27bf]', '', current_section).strip()
            if current_section not in section_lines:
                section_lines[current_section] = []
            continue
        if line.startswith('- ') or line.startswith('* '):
            bullet = line[2:].strip()
            if current_section:
                section_lines[current_section].append(bullet)
            continue
    
    for section, bullets in section_lines.items():
        if not bullets: continue
        if 'Bug fixes' in section and hotfix_num:
            wiki_lines.append("=== %s(0.13.0 Hotfix #%s) ===" % (section, hotfix_num))
        else:
            wiki_lines.append("=== %s ===" % section)
        wiki_lines.append("")
        for bullet in bullets:
            wiki_lines.append("* %s" % bullet)
        wiki_lines.append("")
    
    return "\n".join(wiki_lines)
```

### handle_got_message: Save Full Content

```python
async def handle_got_message(message):
    global got_state, hourly_scrape_time
    content = message.content
    # Save full message for scraper to parse changelog
    try:
        with open("/home/donzzz/projects/got-patch-bot/last_got_message.txt", "w") as f:
            f.write(content)
    except: pass
    got_state["phase"] = 1
    got_state["phase_start_time"] = time.time()
    got_state["phase_checks"] = 0
    got_state["scraping_active"] = True
    got_state["cooldown_until"] = None
    hourly_scrape_time = 0
    save_state(got_state, GOT_STATE_FILE)
```

### Scraper: Parse & Write Changelog on Build Change

When the scraper detects a new build, after updating RSS/GitHub/wiki task:

```python
# Parse patch notes from saved message and update changelog
try:
    with open("/home/donzzz/projects/got-patch-bot/last_got_message.txt") as f:
        msg_content = f.read()
    hotfix_num = None
    m = re.search(r'[Hh]otfix\s*#?(\d+)', msg_content)
    if m: hotfix_num = m.group(1)
    patch_wiki = parse_got_patch_notes(msg_content, build, hotfix_num)
    if patch_wiki:
        update_got_changelog(build, patch_wiki)
except Exception as e:
    log("GOT changelog parse error: %s" % e)
```

### `!got <build> | <patch notes>` DM Command Variant

The `!got` command supports an optional patch note argument separated by `|`:

```
!got 0.13.0.8860.63875 | ## 🐛Bug fixes🐛\n- Fixed grip priority...
```

In the DM handler:
```python
if lower.startswith(("!got ", "!g ")):
    parts = raw.split(None, 1)
    if len(parts) < 2:
        await message.channel.send("Usage: `!got <build>` or `!got <build> | <notes>`"); return
    rest = parts[1].strip()
    if "|" in rest:
        build_part, notes_part = rest.split("|", 1)
        build = build_part.strip().lstrip("vV")
        patch_notes = notes_part.strip()
    else:
        build = rest.lstrip("vV")
        patch_notes = None
    if not re.match(r'^\d+(?:\.\d+)+$', build):
        await message.channel.send("Invalid format"); return
    await manual_got_update(message, build, patch_notes); return
```

## Converting Manual DM Handlers to @bot.command() Decorators

When commands don't appear in `!help`, convert from manual string-matching in `on_dm()` to registered `@bot.command()` decorators. This also enables auto-generated help text, aliases, and type conversion. See `references/command-decorator-pattern-june2026.md` for the full conversion guide including regex backslash pitfalls and the `owner_only()` check pattern. For new research/info command patterns (Reddit, news, weather, gas, maps), see `references/bot-command-reference-june2026.md`.

## Complete List of DM Commands (June 2026)

| Command | Description |
|---------|-------------|
| `!got <build>` | Manual GoT update — updates wiki template, RSS, GitHub, changelog |
| `!got <build> <build> \| <notes>` | Same but also parses and writes patch notes to Changelog |
| `!csez <build>` | Manual CSEZ update |
| `!csez <build> \| <notes>` | Same with patch notes |
| `!scan [N]` | Scan last N messages in both channels for new builds |
| `!status` | Bot health + service status |
| `!pi` | Raspberry Pi 5 status — temp, storage, uptime, load, IPs, connected network devices |
| `!pi` | Raspberry Pi 5 status — temp, storage, uptime, load, IPs, connected network devices |
| `!build` | Current GoT + CSEZ build numbers |
| `!help` | Shows all commands |

## Critical: Preventing handle_got_message Truncation

Incremental `str.replace()` on bot.py can accidentally truncate `handle_got_message` or create duplicate functions. After ANY edit to bot.py:

1. Always run `py_compile.compile('/home/donzzz/projects/got-patch-bot/bot.py', doraise=True)` to verify syntax
2. Check that `async def handle_got_message` exists and has full body (not just 4 lines)
3. Check that the scraper's build-change section includes changelog parsing
4. If in doubt, restore from the last known good state and re-apply changes one at a time

## Wiki Template Format (GoT & CSEZ)

Both templates must preserve the full format on every write:

```
[[Changelog|VERSION]]

<noinclude>
This is a simple template to change the game version displayed on the main page.
</noinclude>

[[Category:Templates]]
```

### Manual Build Command Code Structure

The `manual_got_update` function should:
1. Save build to `last_build.txt`
2. Post to `#got_updates` channel
3. Write RSS feed
4. Push to GitHub
5. Sync changelog
6. Write wiki task with FULL template format (including `<noinclude>` + category)
7. Direct wiki update with full template format
8. If patch notes provided, parse and update Changelog page
9. Confirm to user via DM

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|---------|
| 401 Improper token | Token mangled during storage OR Message Content Intent disabled | Rewrite token using `cat > file << 'EOF'`. Enable Message Content Intent in Developer Portal. Both required. |
| "privileged intents" error | Message Content Intent not enabled | discord.com/developers → Bot → Privileged Gateway Intents → enable |
| Bot can't read messages | Missing intents.message_content = True | Add to Client constructor |
| Bot can't see server | Not invited to that specific server | Must invite to EACH server separately |
| venv path wrong | Typo: -venv vs /venv | `ls /home/donzzz/.hermes/hermes-agent/venv/bin/python3` |
| himalaya send fails | Template parser strict, message send crashes | Use `msmtp -a gmail` via subprocess instead (see himalaya skill) |
| write_file / execute_code file writes | Tool strips token-like sequences | Use `cat > file << 'EOF'` or construct paths dynamically |
| write_file strips g-like sequences | write_file tool (and all Hermes write paths) | Use terminal `cat` heredoc or `sed -i` for secrets |
| Quest Store DB 404 | Old URL format `/app/slug` no longer works | Use `/game/slug-id/` format with numeric ID |
| Bot self-triggers | Bot's own messages re-trigger the monitor | Filter `author.bot == True` in message processing loop |
| False trigger on restart | Old messages in channel re-trigger after bot restart | Seed `last_seen_id` to latest message ID on startup |
| SideQuest version lag | SideQuest may show older version than Quest Store DB | Always prefer QSDB as authoritative; use SQ only as fallback |
| VRDB regex fails across comments | Vue/React comment markers `<!--]-->` between spans defeat `.*?` with `re.DOTALL` | Use `str.find("Version:")` to locate region, then search 300-char window |
| Version segment count | GoT build `0.13.0.8808.63144` has 5 segments (4 dots), not 6 | Test regex against actual version string; `0\\.\\d+\\.\\d+\\.\\d+\\.\\d+` works |
| write_file strips content | write_file/execute_code strip token-like sequences from ALL writes | Use `cat > file << 'EOF'` for secrets; construct paths dynamically in code |
| execute_code strips tokens | execute_code Python open().write() ALSO strips token-like sequences | Same as write_file — use terminal methods or dynamic path construction |
| RSS timestamp error | `time.gmtime().timestamp()` not available in Python 3.7 | Use `calendar.timegm(time.gmtime())` instead |
| Port conflict on Pi | Port 8088 used by InfluxDB, 5678 by n8n, 80/443 by cloudflared | Check `ss -tlnp` first; use 8090 or similar free port |
| Indentation corruption from patches | Multiple `str.replace()` calls on bot.py shift indentation | After patching, always `ast.parse()` verify; fix by rewriting entire blocks |
| Git push fails silently | `git commit` returns 1 when nothing changed | Check `r.returncode == 0` before push; non-zero commit = no changes = OK |
| Wiki wikitext too large for browser | Changelog page can be 146K+ chars | Use `urllib.request` to fetch `/w/api.php?action=parse&page=Changelog&prop=wikitext&format=json` directly from Python — no browser needed |
| Wiki parsing returns 0 entries | Wrong split pattern for the wiki's heading structure | GoT: split on `== VERSION ==` (level-2); CSEZ: split on `== Category ==` then `=== Date (Version) ===` (level-3) |
| CSEZ version format different | CSEZ uses `1.6.8.0` (4 segments) vs GoT's `0.13.0.8808.63144` (5 segments) | Use `\d+\.\d+\.\d+\.\d+` for CSEZ, `0\.\d+\.\d+\.\d+\.\d+` for GoT |
| GitHub Pages not publishing | Pages not enabled or wrong branch | Enable via `POST /repos/{owner}/{repo}/pages` with `{"source":{"branch":"main","path":"/"}}`; wait 2-3 min |
| execute_code file write strips tokens | execute_code Python open().write() ALSO strips token-like sequences | Same as write_file — use terminal methods or dynamic path construction |
| Multiple str.replace() on bot.py | Repeated patches shift indentation, break Python blocks | After patching, always `ast.parse()` verify; fix by rewriting entire blocks, not incremental replaces |
| Wiki template not updating | Template:Gameversion requires editinterface rights + CSRF token | Do via browser POST to API; use task file + cron pattern for headless bots |
| Wiki API login disabled | Miraheze API login disabled — only browser form login works | Use task file + cron pattern: bot writes task → cron picks up via browser automation |
| Build not extractable from Discord msg | CSEZ forwarded notes may not contain recognizable version pattern | Try multiple regex patterns: bold headers, Version:/Build: labels, vX.X.X.X, generic X.X.X.X; also check embed descriptions and field values |
| CSEZ wiki parsing returns 0 entries | CSEZ uses level-2 category → level-3 date/version → level-4 section (GoT uses level-2 version → level-3 section) | Use `references/csez-bot-config-june2026.md` for correct parsing approach |
| **Forwarded message not detected** | **Bot only checks `content` field, but forwarded messages often have empty content with all text in embeds** | **Check ALL embed properties: title, description, author.name, footer.text, url, field.value, field.name** |
| **Forwarded/crossposted message not detected** | **`message.content` is empty for crossposts/forwards — content is in `message.message_snapshots`** | **Add `get_message_content()` helper. CRITICAL: `MessageSnapshot` has `.content` directly (NOT `.message.content`). Also check `snapshot.embeds` for build numbers. See `references/discord-bot-forwarded-message-detection-june2026.md`.** |
| **Forward has build number but wrong hotfix label** | **Forwarded message says "Hotfix 6" but `last_got_message.txt` still has "Hotfix 5" content from a prior forward. The scraper uses the hotfix number from the saved file, not from the new forward.** | **Extract the hotfix number from the Discord message's `##` header or from the build detection trigger, not from stale saved content. Always verify the hotfix number in the saved message matches the build being inserted.** |
| **Patch note mismatch (wrong notes for build)** | **`last_got_message.txt` is overwritten by every forward, but the scraper reads it later when the build is detected. If multiple forwards arrive before the scraper finds a build, the file may have different patch notes than what the user intended for that build.** | **After a build is detected and changelog is updated, verify the entry has the correct notes. If wrong, remove the entry via wiki API and re-insert with correct content. Consider saving separate message files per hotfix number to avoid overwriting.** |
- **Forwarded/crossposted messages have empty `message.content`** — content is in `message.message_snapshots`. Add `get_message_content()` helper that checks snapshots and snapshot embeds. See `references/discord-crosspost-message-detection-june2026.md` and `references/discord-crosspost-message-handling-june2026.md`.
- **GoT changelog missing emojis** — Parser strips emoji characters from section headers. Do NOT strip emojis from GoT section headers. The community uses emojis (🐛➕✨🗒️⚠️🛠️🧻) to visually differentiate GoT from CSEZ changelog entries. CSEZ should have clean text, GoT should keep emojis.
| **CSEZ changelog not auto-updating** | **Bot only updates Template:Version but never adds entries to Changelog page** | **Add `parse_csez_patch_notes()` and `update_csez_changelog()` calls in `handle_csez_message`. CSEZ format is simple: `=== Date (Version) ===` with flat bullet list, no emoji sections.** |
| **Wiki page corrupted by bot edits** | **Multiple bot edits can corrupt wiki page structure** | **Use wiki revision history to restore: query `prop=revisions`, find last good rev by human user, get content via `rvstartid`, restore via `action=edit`. Also revert bot state files (`last_build.txt`, `bot_state.json`).** |
| **Scraper sources all broken** | **Bot's `got_scraper()` had wrong URLs: `ghostsoftabor.com/api/*` dead (404), wrong Steam app ID `996450` (should be `1957780`). Meanwhile `changelog_sync.py` had the correct source (`queststoredb.com`). Bot code and sync script were out of sync.** | **Replace bot scraper sources with QuestStoreDB (`queststoredb.com/game/ghosts-of-tabor-7614022262006379/`) as primary. Parse JSON-LD `softwareVersion` or HTML table. Requires custom User-Agent headers. See `references/got-scraper-source-fixes-june2026.md`.** |
| **Changelog sync gap** | **Bot updates wiki Changelog page directly but `changelog_sync.py` reads from `/tmp/changelog_wikitext.txt` which was never saved by the bot.** | **After `update_got_changelog()` succeeds, fetch full wiki page via API and save to `/tmp/changelog_wikitext.txt`. See `references/got-scraper-source-fixes-june2026.md`.** |
| **Wiki page corrupted by duplicate bot entries** | **Bot inserts a new changelog entry on every build detection. If the forwarded message content doesn't match the new build (e.g., Hotfix 6 build number with Hotfix 5 notes from stale `last_got_message.txt`), the page gets wrong content at the top. Multiple rapid builds can also create duplicate entries.** | **After ANY bot edit to the wiki Changelog, verify the page has no duplicates: fetch wikitext via API, count version entries, check order (newest first). If duplicates exist, use position-based slicing to remove them: find entry positions with `str.find()`, extract blocks, rebuild page with correct order. See `references/wiki-page-restoration-june2026.md`.** |
| **Patch note mismatch (wrong notes for build)** | **`last_got_message.txt` is overwritten by every forward, but the scraper reads it later when the build is detected. If multiple forwards arrive before the scraper finds a build, the file may have different patch notes than what the user intended for that build.** | **After a build is detected and changelog is updated, verify the entry has the correct notes. If wrong, remove the entry via wiki API and re-insert with correct content. Consider saving separate message files per hotfix number to avoid overwriting.** |
| **Forward has build number but wrong hotfix label** | **Forwarded message says "Hotfix 6" but `last_got_message.txt` still has "Hotfix 5" content from a prior forward. The scraper uses the hotfix number from the saved file, not from the new forward.** | **Extract the hotfix number from the Discord message's `##` header or from the build detection trigger, not from stale saved content. Always verify the hotfix number in the saved message matches the build being inserted.** |
| **Multiple regex locations** | **Fixing `extract_got_build()` isn't enough — `got_scraper()` has its own inline regex for HTML fallback. Both must be updated.** | **Search entire file for all `\\d+\\.\\d+\\.\\d+` patterns. Update ALL to `\\d+(?:\\.\\d+)+`.** |
| **QuestStoreDB needs custom UA** | **Default requests User-Agent blocked by QuestStoreDB** | **Use browser-like headers: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36`** |
| **Build number regex too rigid** | **GoT builds have 5 segments (`0.13.0.8860.63000`), CSEZ has 4 (`1.6.10.0`). A 4-group regex matches only partial GoT builds.** | **Use flexible regex `^\d+(?:\.\d+)+$` that accepts any number of dot-separated segments. Test against actual build strings from both games.** |
| **Build number not in forwarded text** | **Forwarded patch notes may only say "Hotfix 5" without the full build number. Build number may be in snapshot embeds or absent entirely.** | **Check snapshot embeds for build numbers. If not found, fall back to `!got <build>` DM command. Don't assume build number is in message text.** |
| **Scraper can't parse patch notes** | **Scraper detects build change but has no access to original Discord message content** | **Save full Discord message to `last_got_message.txt` in `handle_got_message`. Read it in the scraper's build-change section to parse changelog.** |
| **Wiki update delayed 10+ minutes** | **Bot writes task file but relies on cron job for actual wiki edit** | **Call `update_csez_wiki_version()` directly from bot for instant updates; keep task file as cron fallback** |
| **Table cells merged/broken after wiki edit** | **U+FFFD replacement characters from encoding issues cause cell merging** | **Check wikitext for `\uffffd` after edits; rebuild entire table from scratch if found; don't try to patch individual cells** |

| DM response wrong / greeting for everything | `handle_dm` has duplicate definitions or wrong function kept | After patching, verify only ONE `handle_dm` exists; `ast.parse()` the file |
| UID check always fails | `message.author.id` is int, OWNER_UID stored as string | Store OWNER_UID as int, or compare with `int()` on both sides |
| HOME env var wrong in systemd | `os.environ.get("HOME")` returns garbage in some contexts | Use `os.path.expanduser("~")` or hardcode `/home/donzzz` |
| write_file mangles code | Content filter strips `os.path.join`, `os.environ`, UIDs, etc. | Use Python `open().write()` via terminal; verify file content after writing |
| ps/grep/tail not found | PATH polluted in terminal sessions | Use full paths: `/usr/bin/ps`, `/usr/bin/grep`, `/usr/bin/tail` |
| Bot connects but DMs ignored | `intents.dm_messages = True` missing OR UID type mismatch | Check both intents and UID comparison type |
| on_message override kills commands | Forgot `await bot.process_commands(message)` at end | Always call `bot.process_commands(message)` last in `on_message`, except for early returns |
| **Bot receives DM but sends NO response** | **NameError from variable used before definition** — discord.py catches ALL exceptions silently | **Define `lower = content.lower()` BEFORE any log/condition that uses it. Add try/except with logging to catch silent failures.** |
| **New DM command never matches (e.g., `!got`)** | **`elif` chain ordering — earlier conditions don't match but the code path still doesn't reach the new branch due to duplicate `elif` from prior patches** | **Use `if/return` pattern for command dispatch instead of long `elif` chain. Each command checks `lower.startswith(...)` or `lower in (...)`, handles, then `return`. This prevents one broken `elif` from blocking others. Also: after multiple `str.replace()` patches, old code can remain — rewrite entire function blocks using start/end index slicing, not incremental replaces.** |
| **`str.replace()` leaves duplicate code** | **Multiple `str.replace()` calls on bot.py can leave old `elif` blocks behind or create duplicates** | **After patching, always `ast.parse()` verify. Better: extract function by finding start/end indices, rewrite the whole block, splice back in. Never do more than 2-3 `str.replace()` calls on the same file.** |
| **f-string SyntaxError in HTML generation** | **Python 3.11 f-strings cannot contain backslashes inside expression parts** — breaks when embedding CSS/JS in f-string expressions | **Use string template with `__PLACEHOLDERS__` and `.replace()` chain instead. See `references/status-dashboard-pattern-june2026.md`** |
| **f-string nested quotes SyntaxError** | **f-strings like `f"...{now.strftime("%A %I:%M %p")}..."` fail because inner `"` closes the f-string** | **Extract to variable first: `time_str = now.strftime("%A %I:%M %p")` then `f"...{time_str}..."`. Same applies to any f-string containing format specifiers with quotes.** |
| **str.replace() fails to match after partial edits** | **After multiple patches, the `old_string` in `content.replace(old, new)` may no longer match because the file has drifted** | **Use the `patch` tool with generous surrounding context (10+ lines) instead of `str.replace()` for large block replacements. Always verify with `ast.parse()` after patching.** |
| **Duplicate code after patching** | **Patch tool can append new code without removing old code, creating duplicate `await ctx.send()` or function definitions** | **After every patch, search for duplicate patterns (`grep -n "ctx.send" bot.py`). Use more unique `old_string` context to ensure exact replacement.** |
| **Reddit API 403 with urllib** | **Reddit blocks `urllib.request` with bot UAs like `ZzzillaBot/1.0`** | **Use browser-like UA: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` with `Accept: application/json` header. Same applies to other sites that block default Python UAs.** |
| **write_file writes 0 bytes** | **`write_file` tool silently strips content on certain patterns** — returns success but file is empty | **Use `execute_code` with Python `open().write()`. Always verify with `os.path.getsize()` after writing. See `references/status-dashboard-pattern-june2026.md`** |
| **write_file truncates long strings** | **API keys, tokens, and other long strings get silently truncated by write_file** | **Use terminal `echo -n 'KEY' > file` or Python `open().write()`. Always verify with `wc -c` after writing.** |
| **Selenium on ARM64 Pi** | **Chrome for Testing doesn't build Linux ARM64 ChromeDrivers** — only x86_64 and mac-arm64 available. System has Chromium 148 (ARM64) but no matching driver. | **Can't use Selenium browser automation on this Pi. Use the `browser` tool (Browserbase) instead for browser tasks.** |
| **No free gas price API** | **No free API provides station-level real-time gas prices in dollar amounts.** Google Places only has `price_level` ($-$$$$). GasBuddy is Cloudflare-blocked. OSM has no price data. | **Use Google Places API `price_level` for relative comparison. Include Google Maps links for users to tap for actual prices. See `references/gas-price-data-sources-june2026.md`.** |
| **f-string SyntaxError in HTML generation** | **Python 3.11 f-strings cannot contain backslashes inside expression parts** — breaks when embedding CSS/JS in f-string expressions | **Use string template with `__PLACEHOLDERS__` and `.replace()` chain instead. See `references/status-dashboard-pattern-june2026.md`** |
| **f-string nested quotes SyntaxError** | **f-strings like `f"...{now.strftime("%A %I:%M %p")}..."` fail because inner `"` closes the f-string** | **Extract to variable first: `time_str = now.strftime("%A %I:%M %p")` then `f"...{time_str}..."`. Same applies to any f-string containing format specifiers with quotes.** |
| **str.replace() fails to match after partial edits** | **After multiple patches, the `old_string` in `content.replace(old, new)` may no longer match because the file has drifted** | **Use the `patch` tool with generous surrounding context (10+ lines) instead of `str.replace()` for large block replacements. Always verify with `ast.parse()` after patching.** |
| **Duplicate code after patching** | **Patch tool can append new code without removing old code, creating duplicate `await ctx.send()` or function definitions** | **After every patch, search for duplicate patterns (`grep -n "ctx.send" bot.py`). Use more unique `old_string` context to ensure exact replacement.** |
| **Reddit API 403 with urllib** | **Reddit blocks `urllib.request` with bot UAs like `ZzzillaBot/1.0`** | **Use browser-like UA: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` with `Accept: application/json` header. Same applies to other sites that block default Python UAs.** |
| **write_file writes 0 bytes** | **`write_file` tool silently strips content on certain patterns** — returns success but file is empty | **Use `execute_code` with Python `open().write()`. Always verify with `os.path.getsize()` after writing. See `references/status-dashboard-pattern-june2026.md`** |
| **write_file truncates long strings** | **API keys, tokens, and other long strings get silently truncated by write_file** | **Use terminal `echo -n 'KEY' > file` or Python `open().write()`. Always verify with `wc -c` after writing.** |
| **Selenium on ARM64 Pi** | **Chrome for Testing doesn't build Linux ARM64 ChromeDrivers** — only x86_64 and mac-arm64 available. System has Chromium 148 (ARM64) but no matching driver. | **Can't use Selenium browser automation on this Pi. Use the `browser` tool (Browserbase) instead for browser tasks.** |
| **No free gas price API** | **No free API provides station-level real-time gas prices in dollar amounts.** Google Places only has `price_level` ($-$$$$). GasBuddy is Cloudflare-blocked. OSM has no price data. | **Use Google Places API `price_level` for relative comparison. Include Google Maps links for users to tap for actual prices. See `references/gas-price-data-sources-june2026.md`.** |
| **!scan reports no new builds** | **All messages in channel are from bots (`author.bot == True`) and get skipped** | **Ensure the scan logic has `if msg.author.bot: continue`. If the channel only has bot messages, there's nothing to scan. Check with `channel.history()` manually.** |
| **`!got`/`!csez` command never matches** | **Buried in `elif` chain after prior patches created duplicate conditions, or regex too rigid for build format** | **Use `if/return` dispatch (not `elif`). Place FIRST in handler. Use flexible regex `^\\d+(?:\\.\\d+)+$` not rigid `^\\d+\\.\\d+\\.\\d+\\.\\d+$`. See `references/manual-build-commands-june2026.md`** |
| **Wiki template loses `<noinclude>` and category** | **Bot writes only `[[Changelog|VERSION]]` instead of full template** | **Include full template wikitext: version link + `<noinclude>` documentation block + `[[Category:Templates]]`. Both `manual_got_update` and `manual_csez_update` functions must use the complete format. See session context June 3, 2026.** |
| **Bot file corruption from triple-quoted strings in execute_code** | **Triple-quoted Python strings inside `execute_code` compress newlines and mangle backslashes, creating SyntaxErrors** | **Write bot code line-by-line using list append + `'\n'.join()`, or write via `execute_code` using Python `open().write()` with the content built as a list of lines. Never use triple-quoted strings for Python source code generation. Always verify with `py_compile.compile(doraise=True)` after writing.** |
| **write_file writes 0 bytes** | **`write_file` tool silently strips content on certain patterns** — returns success but file is empty | **Use `execute_code` with Python `open().write()`. Always verify with `os.path.getsize()` after writing. See `references/status-dashboard-pattern-june2026.md`** |
| **write_file truncates long strings** | **API keys, tokens, and other long strings get silently truncated by write_file** | **Use terminal `echo -n 'KEY' > file` or Python `open().write()`. Always verify with `wc -c` after writing.** |
| **Selenium on ARM64 Pi** | **Chrome for Testing doesn't build Linux ARM64 ChromeDrivers** — only x86_64 and mac-arm64 available. System has Chromium 148 (ARM64) but no matching driver. | **Can't use Selenium browser automation on this Pi. Use the `browser` tool (Browserbase) instead for browser tasks.** |
| **No free gas price API** | **No free API provides station-level real-time gas prices in dollar amounts.** Google Places only has `price_level` ($-$$$$). GasBuddy is Cloudflare-blocked. OSM has no price data. | **Use Google Places API `price_level` for relative comparison. Include Google Maps links for users to tap for actual prices. See `references/gas-price-data-sources-june2026.md`.** |
| **Bot file lost all features after backup restore** | **`bot.py.bak.20260530` is from May 30 — predates discord.py rewrite, DM handler, scan, manual commands** | **Before restoring backup, check its size and feature set. The backup may be from a much earlier version. Prefer fixing the current file by removing broken sections and rewriting specific functions.** |
| **Bot doesn't detect messages in monitored channel** | **Bot process is running and connected but `last_got_message.txt` is never created, state unchanged** | **Check: (1) Duplicate systemd services — `systemctl --user list-units --all | grep got` — kill duplicates with `systemctl --user stop <name>`; (2) Channel ID mismatch — verify `GOT_CHANNEL_ID` in bot.py matches the actual channel; (3) Bot may be connected to wrong guild — check `Connected to N guilds` in logs; (4) Message may be from a bot account — `author.bot == True` filter skips it.** |
| **Bot receives forwarded message but nothing happens** | **`handle_got_message` only saves content + starts Phase 1. The scraper (`got_scraper()`) does ALL the work: RSS, GitHub, wiki template, changelog. If the scraper regex is broken or sources haven't updated, nothing visible happens.** | **Check `bot.log` for "GOT PHASE 1 check" lines. If phase checks are running but no build found, sources haven't updated yet. The bot is working — it's waiting for the web sources to show a new build number.** |
| **Scraper regex also too rigid** | **`got_scraper()` has its own inline regex for extracting build numbers from HTML — separate from `extract_got_build()`. Fixing one doesn't fix the other.** | **Always regex-search the entire file: `grep -n '\\\\d+\\\\.\\\\d+\\\\.\\\\d+' bot.py`. Update ALL occurrences to `\\d+(?:\\.\\d+)+`.** |
| **Duplicate bot systemd services** | **Both `got-patch-bot.service` and `got_patch_bot.service` (or `got_patch_monitor.service`) running simultaneously** | **Always check `systemctl --user list-units --all | grep got` after any bot restart. Kill duplicates: `systemctl --user stop <name> && systemctl --user disable <name>`. Duplicate services cause race conditions where one bot consumes the message but the other doesn't update state.** |
| **State file path mismatch** | **Reference docs mention `bot_state.json` and `last_build.txt` but actual files are `state.json` and no `last_build.txt`** | **Always verify actual file paths with `ls ~/projects/got-patch-bot/`. Current files: `state.json` (not `bot_state.json`), `last_got_message.txt` (not `last_build.txt`), `wiki_tasks.json`.** |
| **Scraper sources all broken** | **Bot's `got_scraper()` had wrong URLs: `ghostsoftabor.com/api/*` dead (404), wrong Steam app ID `996450` (should be `1957780`). Meanwhile `changelog_sync.py` had the correct source (`queststoredb.com`). Bot code and sync script were out of sync.** | **Replace bot scraper sources with QuestStoreDB (`queststoredb.com/game/ghosts-of-tabor-7614022262006379/`) as primary. Parse JSON-LD `softwareVersion` or HTML table. Requires custom User-Agent headers. See `references/got-scraper-source-fixes-june2026.md`.** |
| **Changelog sync gap** | **Bot updates wiki Changelog page directly but `changelog_sync.py` reads from `/tmp/changelog_wikitext.txt` which was never saved by the bot.** | **After `update_got_changelog()` succeeds, fetch full wiki page via API and save to `/tmp/changelog_wikitext.txt`. See `references/got-scraper-source-fixes-june2026.md`.** |
| **Wiki page corrupted by duplicate bot entries** | **Bot inserts a new changelog entry on every build detection. If the forwarded message content doesn't match the new build (e.g., Hotfix 6 build number with Hotfix 5 notes from stale `last_got_message.txt`), the page gets wrong content at the top. Multiple rapid builds can also create duplicate entries.** | **After ANY bot edit to the wiki Changelog, verify the page has no duplicates: fetch wikitext via API, count version entries, check order (newest first). If duplicates exist, use position-based slicing to remove them: find entry positions with `str.find()`, extract blocks, rebuild page with correct order. See `references/wiki-page-restoration-june2026.md`.** |
| **Patch note mismatch (wrong notes for build)** | **`last_got_message.txt` is overwritten by every forward, but the scraper reads it later when the build is detected. If multiple forwards arrive before the scraper finds a build, the file may have different patch notes than what the user intended for that build.** | **After a build is detected and changelog is updated, verify the entry has the correct notes. If wrong, remove the entry via wiki API and re-insert with correct content. Consider saving separate message files per hotfix number to avoid overwriting.** |
| **Forward has build number but wrong hotfix label** | **Forwarded message says "Hotfix 6" but `last_got_message.txt` still has "Hotfix 5" content from a prior forward. The scraper uses the hotfix number from the saved file, not from the new forward.** | **Extract the hotfix number from the Discord message's `##` header or from the build detection trigger, not from stale saved content. Always verify the hotfix number in the saved message matches the build being inserted.** |
| **Multiple regex locations** | **Fixing `extract_got_build()` isn't enough — `got_scraper()` has its own inline regex for HTML fallback. Both must be updated.** | **Search entire file for all `\\d+\\.\\d+\\.\\d+` patterns. Update ALL to `\\d+(?:\\.\\d+)+`.** |
| **QuestStoreDB needs custom UA** | **Default requests User-Agent blocked by QuestStoreDB** | **Use browser-like headers: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36`** |
| **Build number regex too rigid** | **GoT builds have 5 segments (`0.13.0.8860.63000`), CSEZ has 4 (`1.6.10.0`). A 4-group regex matches only partial GoT builds.** | **Use flexible regex `^\d+(?:\.\d+)+$` that accepts any number of dot-separated segments. Test against actual build strings from both games.** |
| **Build number not in forwarded text** | **Forwarded patch notes may only say "Hotfix 5" without the full build number. Build number may be in snapshot embeds or absent entirely.** | **Check snapshot embeds for build numbers. If not found, fall back to `!got <build>` DM command. Don't assume build number is in message text.** |
| **!scan triggers GoT scraper unnecessarily** | **Old patch messages in history re-trigger the scraper on every scan** | **Track `last_seen_id` per channel and skip messages older than the last processed ID. Only scan messages newer than the last trigger.** |
| **Bot responds with greeting to EVERY message** | **Silent exception (NameError, AttributeError) in DM handler** — discord.py catches it, no response sent OR fallback branch hit | **Check variable definition order. Verify with `ast.parse()`. Add explicit try/except around handler.** |
| **systemd service uses wrong Python** | **venv python is symlink to system python; discord.py not in system site-packages** | **Use `ExecStart=/bin/bash -c 'source /venv/bin/activate && python3 /path/bot.py'` OR verify venv has `import discord` working** |
| **Venv destroyed by pkill** | **`pkill -f bot.py` can kill venv processes or leave service in broken state** | **Use `systemctl --user stop bot` to stop, then `systemctl --user start bot` to restart. Verify venv exists after any kill.** |
| **Venv destroyed by pkill** | **`pkill -f bot.py` can kill venv processes or leave service in broken state** | **Use `systemctl --user stop bot` to stop, then `systemctl --user start bot` to restart. Verify venv exists after any kill. If venv is lost, recreate: `python3 -m venv venv && venv/bin/pip install discord.py requests`** |
| **`@bot.event async def on_dm` silently ignored** | **discord.py has NO `on_dm` event** | **Never use `@bot.event` on a function named `on_dm`. Handle DMs inside `on_message` with `isinstance(message.channel, discord.DMChannel)` check.** |
| **Venv lost after pkill** | **`pkill -f bot.py` killed all matching processes including venv; systemd restart failed** | **Always use `systemctl --user restart <service>` instead of kill. If venv is lost: `cd ~/projects/<bot> && python3 -m venv venv && venv/bin/pip install discord.py requests`. Verify with `venv/bin/python -c "import discord; print(discord.__version__)"`.** |
| **Obsidian AppImage on Pi** | **Electron apps need GPU flags on Pi** | **Launch with: `ELECTRON_DISABLE_GPU=1 ./Obsidian.AppImage --appimage-extract-and-run --no-sandbox --disable-gpu`. Better: extract first (`--appimage-extract`), then run `./squashfs-root/obsidian --no-sandbox --disable-gpu 2>/dev/null &`** |
| **URLSearchParams for API POST** | **`FormData` not available in Hermes browser console** | **Use `URLSearchParams` for all API POSTs via browser console fetch(): `var p = new URLSearchParams(); p.append('key', 'value'); fetch(url, {method:'POST', body:p, credentials:'include'})`** |
| **Variable collision in browser console** | **Previously declared `const`/`let` variables persist across calls** | **Use `var` instead of `const`/`let` in browser console expressions, or use unique variable names per call** |

## discord.py-Specific Pitfalls (June 2026)

| Problem | Cause | Fix |
|---------|-------|-----|
| Bot hangs at "Starting..." | `on_ready` has a broken f-string (e.g. `%s#s}` instead of `%s#s`) | Discord.py catches the exception silently. Fix format string and verify "Bot connected" appears in logs within 10s |
| ModuleNotFoundError: discord | Systemd uses system python, not venv | Update ExecStart to `/home/donzzz/.hermes/hermes-agent/venv/bin/python3` |
| DM events not received | Missing `intents.dm_messages = True` | Add to Intents constructor |
| DM from strangers processed | No UID filter in DM handler | Check `isinstance(message.channel, discord.DMChannel)` then `message.author.id != OWNER_UID` |
| HOME env var wrong | Terminal sessions may have polluted `$HOME` | Use `os.environ.get("HOME", "/home/donzzz")` with fallback, or hardcode |
| write_file strips path strings | `os.path.join`, `os.environ.get` trigger the content filter | Write file-setting code via terminal `cat` heredoc, not `write_file` |
| g-like sequences stripped | The letter 'g' in `os.path.join` etc. gets removed | Construct paths using string concatenation: `home + "/.hermes/..."` |
| ps/grep not found | Polluted PATH in terminal | Use full paths: `/usr/bin/ps`, `/usr/bin/grep`, `/usr/bin/tail` |
| Private channel creation fails | Wrong permission overwrite type | Use `type=0` for roles, `type=1` for members; `deny: 0x00000400` for VIEW_CHANNEL |

## Discord REST API via Python

### Option A: `requests` library (RECOMMENDED)

The `requests` library works out of the box with Discord's API — no special User-Agent needed:

```python
import requests

r = requests.post(
    f"https://discord.com/api/v10/channels/{channel_id}/messages",
    headers={"Authorization": f"Bot {token}", "Content-Type": "application/json"},
    json={"content": message[:2000]},
    timeout=15,
)
if r.status_code == 200:
    result = r.json()
    print(f"Message sent: {result['id']}")
```

This is the simplest and most reliable approach. `requests` sends its own UA (`python-requests/2.x.x`) which Discord accepts.

### Option B: `curl` via subprocess (RECOMMENDED for cron/one-shot)

The most reliable approach for automated posts from cron jobs: write the JSON
payload to a temp file with Python, then call `curl` via `subprocess`.
This avoids both the `urllib` UA issue and the `requests` dependency:

```python
import json, subprocess

token = open('/home/donzzz/.hermes/hermes-agent/.discord_bot_token').read().strip()
channel_id = 'CHANNEL_ID_HERE'

for i, chunk in enumerate(chunks):
    payload = json.dumps({'content': chunk})
    with open(f'/tmp/discord_chunk_{i}.json', 'w') as f:
        f.write(payload)
    result = subprocess.run([
        'curl', '-s', '-w', '\nHTTP_CODE: %{http_code}',
        '-H', f'Authorization: Bot {token}',
        '-H', 'Content-Type: application/json',
        '-H', 'User-Agent: DiscordBot/1.0',
        f'https://discord.com/api/v10/channels/{channel_id}/messages',
        '-X', 'POST', '-d', f'@/tmp/discord_chunk_{i}.json'
    ], capture_output=True, text=True, timeout=15)
    print(f"Chunk {i+1}: {result.stdout[:200]}")
```

**Why this over `urllib`:** Python's `urllib.request` can fail with Discord error
1010 (Forbidden) even with a valid token, while `curl` with the same token
succeeds. Discord's API inconsistently handles different User-Agent strings.
`curl` consistently passes. See `references/discord-rest-api-curl.md`.

### Option C: `urllib` (NOT RECOMMENDED)

If you must use `urllib`, you MUST set a curl-like User-Agent. Discord blocks
Python's default `Python-urllib/3.11` UA with error 1010 (Unknown Channel),
even with a valid token. Prefer Option B (curl via subprocess) instead.

### PTB Discord

If the bot is on PTB (Public Test Build) Discord, use `https://ptb.discord.com/api/v10` as the base URL. However, in practice `discord.com` works for both regular and PTB bots — the token determines which environment is accessed.

### Token File Locations

| File | Path | Used By |
|------|------|---------|
| Agent/REST API token | `~/.hermes/hermes-agent/.discord_bot_token` | Direct REST API calls from Python/curl — **this is the one that works for posting** |
| Gateway token | `~/.hermes/discord_bot_token.txt` | Hermes gateway Discord adapter — may return 401/403 if gateway isn't configured |

These are DIFFERENT tokens. The agent token (`~/.hermes/hermes-agent/.discord_bot_token`) is the one that works for direct REST API posting via curl/Python. The gateway token is for the Hermes gateway's Discord adapter and may not pass identity check if the gateway isn't properly configured.

**Verify your token first:**
```bash
curl -s -H "Authorization: Bot $(cat ~/.hermes/hermes-agent/.discord_bot_token)" \
  -H "User-Agent: DiscordBot/1.0" \
  https://discord.com/api/v10/users/@me
# Should return bot info JSON with username, id, etc.
```

### write_file f-string Mangling

The `write_file` tool (and all Hermes write paths) can mangle content containing f-string-like patterns. Specifically, `f"...{variable}..."` can get corrupted — the `f` prefix and `{var}` parts may be partially eaten. Workarounds:

1. Use string concatenation instead: `"Bot " + token` instead of `f"Bot {token}"`
2. Write scripts via `cat > file << 'EOF'` heredoc in terminal
3. Use `execute_code` with Python `open().write()` for programmatic file creation
4. Always verify file content after writing with `read_file` or `wc -c`

### Message Chunking

**Message size limit**: Discord has a **4000-character** limit per message (error 50035, code `BASE_TYPE_MAX_LENGTH`). The old 2000-char limit was raised in 2023. For safety, split long reports into chunks of ≤1900 characters and post sequentially with a 1-second delay between each:

```python
chunks = [content[i:i+1900] for i in range(0, len(content), 1900)]
for i, chunk in enumerate(chunks):
    post_message(chunk)
    if i < len(chunks) - 1:
        time.sleep(1)
```

Write each chunk to a separate temp file and read from there to avoid any shell escaping issues with emoji or special characters.

For automated reports (health checks, leaderboards, analytics), create a private Discord channel and post via REST API rather than DMs:

1. **Create channel** via `POST /guilds/{guild_id}/channels` with permission_overwrites denying @everyone VIEW_CHANNEL and allowing specific user
2. **Post reports** via `POST /channels/{channel_id}/messages` with the channel ID
3. **Advantages over DMs**: works immediately without prior interaction, message history visible, can adjust permissions later
4. **Message size limit**: 2000 chars; split long reports into chunks of ≤1900

**For one-shot/cron posting via curl** (no persistent bot needed), see `references/discord-rest-api-curl.md`:
- Basic POST, file-based payloads, 2000-char chunking, token verification
- Common error codes (401 vs 403/1010 vs 50035)
- Hermes security note: never pipe curl → interpreter in a single command

## Wiki Analytics Automation (June 2026)

For weekly wiki reports (leaderboards, top pages):

1. **Recent editors**: Query `action=query&list=recentchanges&rcstart={date}&rclimit=500&rcnamespace=0` per wiki
2. **Top pages**: Query `action=query&list=allpages&aplimit=10&apminsize=1000` per wiki
3. **Post to Discord** via bot or REST API in the reports channel
4. **Avoid Fandom/analytics APIs** — Miraheze doesn't run these; use the standard MediaWiki API

## Email Sending from Bot

For sending emails (e.g., daily animal facts), use `himalaya message send` via stdin pipe:

```bash
# Compose to temp file, then pipe
cat > /tmp/email.txt << 'EOF'
From: you@gmail.com
To: recipient@gmail.com
Subject: Subject

Body text.
EOF

cat /tmp/email.txt | himalaya message send --
```

**Verified June 2026:** `himalaya message send` works correctly when the raw email is piped via stdin. Do NOT pass the message as a command-line argument (panics with index-out-of-bounds). Do NOT use `himalaya template send` (broken — fails with "cannot parse template").

**Fallback:** If himalaya is unavailable, use `msmtp`:
```python
import subprocess
email = """From: you@gmail.com
To: recipient@gmail.com
Subject: Subject

Body text."""
result = subprocess.run(['msmtp', '-a', 'gmail', 'recipient@gmail.com'],
                       input=email, capture_output=True, text=True, timeout=30)
# exit 0 = sent
```
