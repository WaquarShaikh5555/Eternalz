# GoT Changelog Parsing — Discord to Wiki (June 2026)

## Discord Message Format

GoT patch notes in `#got_updates`:

```
#  🔥Patch notes version 0.13.0 Hotfix 5🔥
Patch 0.13.0 Hotfix 5 has now been deployed...

## 🐛Bug fixes & improvements🐛
- Potentially fixed NaN issue...
- Fixed grip priority in backpack...

## ➕New features➕
- Added the ability to turn the mirror off...

## 🗒️ To Note:
- Removed Crawlers and Sui Dabz items...

## ⚠️ Known issues ⚠️
- Some players may experience voice chat issues

## 🛠️Maps fixes🛠️
- Fixed collision on Matka Miest underground
```

## Wiki Target Format

**CRITICAL: Preserve emojis in section headers.** The community uses emojis to visually differentiate GoT changelog entries from CSEZ (which uses clean text). Do NOT strip emojis.

```
== 0.13.0.8860.63875 (2026-06-03) ==

=== 🐛Bug fixes & improvements🐛(0.13.0 Hotfix #5) ===
* Potentially fixed NaN issue...
* Fixed grip priority in backpack...

=== ➕New features➕ ===
* Added the ability to turn the mirror off...

=== 🗒️ To Note: ===
* Removed Crawlers and Sui Dabz items...

=== ⚠️ Known issues ⚠️ ===
* Some players may experience voice chat issues

=== 🛠️Maps fixes🛠️ ===
* Fixed collision on Matka Miest underground
```

## Parsing Function

```python
def parse_got_patch_notes(text, build, hotfix_num=None):
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
            # PRESERVE emojis — do NOT strip them
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
            wiki_lines.append("=== %s(Hotfix #%s) ===" % (section, hotfix_num))
        else:
            wiki_lines.append("=== %s ===" % section)
        wiki_lines.append("")
        for bullet in bullets:
            wiki_lines.append("* %s" % bullet)
        wiki_lines.append("")
    return "\n".join(wiki_lines)
```

**Key change from earlier version:** The old parser stripped emojis with `re.sub(r'[\U0001f300-\U0001f9ff...]', '', section)`. This was wrong — emojis must be preserved for visual differentiation from CSEZ.

## Full Template Format (GoT and CSEZ)

Both templates must always include:

```
[[Changelog|VERSION]]

<noinclude>
This is a simple template to change the game version displayed on the main page.
</noinclude>

[[Category:Templates]]
```

## Build Number Regex

Use flexible regex: `^\d+(?:\.\d+)+$`

Do NOT use rigid `^\d+\.\d+\.\d+\.\d+$` — GoT builds have 5 segments (`0.13.0.8860.63000`), CSEZ has 4 (`1.6.10.0`). The flexible regex handles both.

## Saving Full Discord Message for Scraper

When a message arrives in `#got_updates`, save the full content to a file so the scraper can parse it later:

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

When the scraper detects a build change, parse the saved message:

```python
# In the scraper's build-change section:
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

## Wiki Page Restoration

If the changelog page gets corrupted (e.g., from bot edits), restore it using the wiki's revision history:

```python
# 1. Get revision list
r = s.get(base, params={
    "action": "query", "prop": "revisions", "titles": "Changelog",
    "rvlimit": 10, "rvprop": "ids|timestamp|comment|user", "format": "json"
})

# 2. Find the last good revision (before bot edits)
# Look for the last revision by a human user (not ZeroSkills/bot)

# 3. Get that revision's content
r = s.get(base, params={
    "action": "query", "prop": "revisions", "titles": "Changelog",
    "rvstartid": GOOD_REVID, "rvlimit": 1, "rvprop": "content", "format": "json"
})
old_content = r.json()["query"]["pages"][pid]["revisions"][0]["*"]

# 4. Restore
r = s.post(base, data={
    "action": "edit", "title": "Changelog", "text": old_content,
    "summary": "Restore to rev %d — undo bot edits" % GOOD_REVID,
    "bot": "true", "token": csrf, "format": "json"
})
```

Also revert the bot's state file and build file:
```python
# Revert build file
with open("/home/donzzz/projects/got-patch-bot/last_build.txt", "w") as f:
    f.write("0.13.0.8808.63144")

# Revert bot state
state = {"phase":0,"last_known_build":"0.13.0.8808.63144","scraping_active":False,...}
with open("/home/donzzz/projects/got-patch-bot/bot_state.json", "w") as f:
    json.dump(state, f, indent=2)
```
