# CSEZ Bot Configuration & Patterns

CSEZ (Contractors Showdown ExfilZone) uses the same bot architecture as GoT but with key differences.

## Discord Channel

- **Channel:** `#csez_updates` on Zzzilla Island
- **Channel ID:** `1511247103043702834`

## Build Number Extraction (from Discord Message)

Unlike GoT (which scrapes external sources), CSEZ build numbers are baked into the forwarded patch notes. Extract with this priority:

```python
CSEZ_VERSION_PATTERN = re.compile(r"(\d+\.\d+\.\d+\.\d+)")

def extract_csez_build(msg_text):
    if not msg_text:
        return None
    # 1. Bold headers: **1.6.8.0** or **v1.6.8.0**
    m = re.search(r"\*\*[Vv]?\s*(\d+\.\d+\.\d+\.\d+)\s*\*\*", msg_text)
    if m: return m.group(1)
    # 2. Version:/Build: labels
    m = re.search(r"(?:[Vv]ersion|[Bb]uild)\s*[:\-]?\s*v?(\d+\.\d+\.\d+\.\d+)", msg_text)
    if m: return m.group(1)
    # 3. v1.6.8.0 pattern
    m = re.search(r"v(\d+\.\d+\.\d+\.\d+)", msg_text)
    if m: return m.group(1)
    # 4. Generic X.X.X.X
    m = re.search(r"(\d+\.\d+\.\d+\.\d+)", msg_text)
    if m: return m.group(1)
    return None

# Also check embeds for forwarded content
for embed in msg.get("embeds", []):
    desc = embed.get("description", "")
    if desc:
        build = extract_csez_build(desc)
        if build: return build
    for field in embed.get("fields", []):
        val = field.get("value", "")
        if val:
            build = extract_csez_build(val)
            if build: return build
```

## CSEZ Version Format

- **Format:** `1.6.8.0` (4 segments, 3 dots) — NOT GoT's `0.13.0.8808.63144` (5 segments)
- **Regex:** `\d+\.\d+\.\d+\.\d+`
- **Current (as of June 2026):** `1.6.8.0`

## Wiki Structure

- **Changelog page:** `csez.miraheze.org/wiki/Changelog`
- **Version template:** `csez.miraheze.org/wiki/Template:Version`
- **Template wikitext:** `[[Changelog|v1.6.8.0]]`

## Changelog Parsing (CSEZ-specific)

CSEZ changelog has a different structure from GoT:

```
== Alpha ==
=== 2026-06-01 (1.6.8.0) ===
==== Full Wipe ====
* content
==== New Features ====
* content

=== 2026-05-29 (1.6.7.0) ===
* content

== Beta ==
=== 2025-12-15 (1.0.0.0) ===
* content
```

**Parsing approach:**
```python
# Split on level-2 headings (categories)
categories = re.split(r'\n==\s+([^=]+?)\s+==\n', wikitext)

# Within each category, split on level-3 headings (date + version)
date_blocks = re.split(r'\n===\s+(\d{4}-\d{2}-\d{2})\s+\(([^)]+)\)\s+===', cat_content)

# Within each date block, split on level-4 headings (sections)
sec_blocks = re.split(r'\n====\s+(.+?)\s+====', body)
```

**Key difference from GoT:**
- GoT: `== Version (Date) ==` (level-2) → `=== Section ===` (level-3)
- CSEZ: `== Category ==` (level-2) → `=== Date (Version) ===` (level-3) → `==== Section ====` (level-4)

## GitHub Pages

- **Repo:** `DonZzzilla/csez-changelog`
- **Live site:** `https://donzzzilla.github.io/csez-changelog/`
- **RSS feed:** `https://donzzzilla.github.io/csez-changelog/feed.xml`
- **Clone path:** `/tmp/csez-changelog`

## Bot State Files

- **State:** `/home/donzzz/projects/got-patch-bot/csez_bot_state.json`
- **Build history:** `/home/donzzz/projects/got-patch-bot/last_csez_build.txt`
- **Wiki task:** `/home/donzzz/projects/got-patch-bot/csez_wiki_task.json`
- **Wiki trigger:** `/home/donzzz/projects/got-patch-bot/csez_wiki_update_trigger.json`

## Message Format (CSEZ)

```
🔫 Contractors Showdown ExfilZone — Update Detected

Detected: YYYY-MM-DD HH:MM UTC
Build:
```
<build_number>
```

Forwarded notes: <first 100 chars>...

-# Auto-detected by Zzzilla
```

## Wiki Template Update Flow

Since Miraheze API login is disabled, the bot cannot directly edit wiki pages. Instead:

1. Bot detects new build → writes `csez_wiki_update_trigger.json`
2. `csez_changelog_sync.py` reads the trigger and writes `csez_wiki_task.json`
3. Cron job (`CSEZ+GOT Wiki Template Updater`, every 10 min) checks for pending tasks
4. Cron uses browser automation (ZeroSkills login) to edit `Template:Version`

**Task file format:**
```json
{
  "action": "update_template_version",
  "page": "Template:Version",
  "new_wikitext": "[[Changelog|v1.6.8.0]]",
  "current_version": "1.6.7.0",
  "new_build": "1.6.8.0",
  "status": "pending"
}
```

## Multi-Game Bot Architecture

When one bot monitors multiple games/channels:

```python
GOT_CHANNEL_ID  = 1511246958868693012   # #got_updates
CSEZ_CHANNEL_ID = 1511247103043702834   # #csez_updates

# Separate state files per game
GOT_STATE_FILE  = ".../bot_state.json"
CSEZ_STATE_FILE = ".../csez_bot_state.json"

# In main loop:
# 1. Check #got_updates → GOT scraping flow
# 2. Check #csez_updates → CSEZ extraction flow
# 3. Run GOT hourly scraping if active
# 4. Sleep and repeat
```

**Key principle:** Each game has its own state machine, build detection method, and output targets. The bot loop handles all games in parallel.

## File Locations Summary

| File | Path |
|------|------|
| Bot code | `/home/donzzz/projects/got-patch-bot/bot.py` |
| CSEZ sync | `/home/donzzz/projects/got-patch-bot/csez_changelog_sync.py` |
| CSEZ wiki update | `/home/donzzz/projects/got-patch-bot/csez_wiki_update.py` |
| Wiki checker | `/home/donzzz/projects/got-patch-bot/wiki_update_checker.py` |
| Hermes trigger | `/home/donzzz/projects/got-patch-bot/hermes_wiki_trigger.json` |
| Systemd service | `~/.config/systemd/user/got-patch-bot.service` |
| Log file | `/home/donzzz/projects/got-patch-bot/bot.log` |
