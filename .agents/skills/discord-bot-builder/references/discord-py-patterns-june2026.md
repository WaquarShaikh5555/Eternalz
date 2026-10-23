# discord.py DM Handling + Channel Reports (June 2026)

## ⚠️ CRITICAL: discord.py Has NO `on_dm` Event

**Never use `@bot.event async def on_dm(message)`** — discord.py silently ignores it.
All DM handling MUST go through `on_message` with an `isinstance` check.

## UID-Based DM Filter Pattern

```python
import discord
from discord.ext import commands

OWNER_UID = 184818387518488577  # integer — Discord IDs are integers, NOT strings

intents = discord.Intents.default()
intents.message_content = True
intents.dm_messages = True  # REQUIRED for DM events

bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_message(message):
    # IMPORTANT: Must call bot.process_commands(message) at the end
    # for prefix commands to work. But for DMs, return early after handling.

    # ── DM Handling ──
    if isinstance(message.channel, discord.DMChannel):
        if message.author.bot:
            return
        # CRITICAL: message.author.id is an integer in discord.py
        if message.author.id != OWNER_UID:
            log("DM from non-owner UID %s, ignoring" % message.author.id)
            return
        await handle_dm(message)
        return  # Early return — don't process channel logic for DMs

    # ── Channel Handling ──
    if message.author.bot:
        return
    if message.channel.id == GOT_CHANNEL_ID:
        await handle_got_message(message)
    elif message.channel.id == CSEZ_CHANNEL_ID:
        await handle_csez_message(message)

    await bot.process_commands(message)  # Always last for command processing


async def handle_dm(message):
    # CRITICAL: Define 'lower' BEFORE any log/condition that uses it.
    # discord.py catches ALL exceptions silently — a NameError means no response sent.
    content = message.content.strip()
    lower = content.lower()

    # Now safe to log/debug using 'lower'
    log("DM from owner: %s" % content[:100])

    # Command handlers (exact match)
    if lower in ("!status", "status", "!health"):
        await message.channel.send(build_status_message())
    elif lower in ("!build", "build", "!builds"):
        await message.channel.send(build_message())
    elif lower in ("!help", "help"):
        await message.channel.send("Commands: `!status`, `!build`, `!help`")

    # Conversation handlers (substring match — order matters, most specific first)
    elif any(w in lower for w in ["how are you", "how's it going"]):
        await message.channel.send("All systems running smooth!")
    elif any(w in lower for w in ["hello", "hi", "hey", "sup", "yo"]):
        await message.channel.send("Hey! What can I do for you?")
    elif any(w in lower for w in ["thanks", "thank", "thx"]):
        await message.channel.send("Anytime!")
    elif any(w in lower for w in ["bye", "goodbye", "later"]):
        await message.channel.send("See you!")
    elif "patch" in lower:
        await message.channel.send("Forward patch notes to the update channel and I'll handle the rest.")
    elif "telegram" in lower or "interface" in lower or "instead" in lower:
        await message.channel.send(
            "You can DM me here, but I'm the patch monitor bot — "
            "not a full Hermes replacement. For wiki editing, GitHub, research, "
            "use Telegram or the Hermes TUI. Need something specific?"
        )

    # Fallback
    else:
        await message.channel.send("Got it. Use `!help` for commands or tell me what you need.")
```

## Debugging: Bot Receives DM But Sends No Response

**Most common cause:** `NameError` from using a variable before defining it. discord.py catches ALL exceptions silently.

Checklist:
1. **Variable definition order** — `lower = content.lower()` must come BEFORE any log/condition using `lower`
2. **Silent exception** — wrap handler in try/except with logging to surface errors
3. **`message.channel.send()` failing** — channel object may be stale; try `await message.author.send()` instead
4. **Syntax error** — verify with `ast.parse()` after any patch
5. **Wrong Python** — check with `readlink -f /proc/{PID}/exe`; must be venv Python with discord.py
6. **`@bot.event on_dm`** — if you used this, it's silently ignored. Move logic into `on_message`

## Creating Private Channels via API

```python
import requests

def create_private_channel(token, guild_id, name, owner_uid, category_id=None):
    headers = {"Authorization": "Bot " + token, "Content-Type": "application/json"}
    payload = {
        "name": name,
        "type": 0,
        "permission_overwrites": [
            {"id": guild_id, "type": 0, "deny": 0x00000400, "allow": 0},
            {"id": owner_uid, "type": 1, "allow": 0x00000400 | 0x00000800 | 0x00004000, "deny": 0}
        ]
    }
    if category_id:
        payload["parent_id"] = category_id
    r = requests.post(
        f"https://discord.com/api/v10/guilds/{guild_id}/channels",
        headers=headers, json=payload, timeout=15
    )
    return r.json()["id"] if r.status_code == 201 else None
```

## on_ready Debugging Checklist

1. Check format strings — broken `%s#s}` silently crashes discord.py on_ready
2. Check intents — `intents.dm_messages = True` for DM support
3. Check Python — must use venv with discord.py installed
4. Check token — verify file is readable and 72 chars
5. Test manually in foreground to see errors

## systemd with venv

**Option A — venv python directly (works if venv packages are properly isolated):**
```
ExecStart=/path/to/venv/bin/python3 /path/to/bot.py
```

**Option B — source activate (more reliable if venv python is symlink to system):**
```
ExecStart=/bin/bash -c 'source /path/to/venv/bin/activate && python3 /path/to/bot.py'
```

**Verify venv has discord.py:**
```bash
/path/to/venv/bin/python3 -c "import discord; print(discord.__version__)"
```

**After ANY venv recreation, reinstall all dependencies:**
```bash
source venv/bin/activate
pip install discord.py requests
```
