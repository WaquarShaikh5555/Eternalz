# Wiki Page Restoration Pattern (June 2026)

## When to Restore

If bot edits corrupt a wiki page (e.g., broken formatting, wrong content, encoding issues), restore from revision history rather than trying to patch.

## Restoration Steps

### 1. Find the Last Good Revision

```python
import requests

s = requests.Session()
s.headers.update({"User-Agent": "BotName/1.0 (ZeroSkills)"})
base = "https://<wiki>.miraheze.org/w/api.php"

# Login
r = s.get(base, params={"action":"query","meta":"tokens","type":"login","format":"json"}, timeout=10)
tok = r.json()["query"]["tokens"]["logintoken"]
r = s.post(base, data={"action":"login","lgname":"ZeroSkills","lgpassword":"ForkedT2000","lgtoken":tok,"format":"json"}, timeout=10)

# Get recent revisions
r = s.get(base, params={
    "action": "query", "prop": "revisions", "titles": "Changelog",
    "rvlimit": 20, "rvprop": "ids|timestamp|comment|user", "format": "json"
}, timeout=10)

pages = r.json()["query"]["pages"]
for pid, pdata in pages.items():
    for rev in pdata.get("revisions", []):
        print(f"rev {rev['revid']} | {rev['timestamp']} | {rev.get('user')} | {rev.get('comment','')[:60]}")
```

Look for the last revision by a human user (not ZeroSkills/bot). Note its `revid`.

### 2. Get That Revision's Content

```python
GOOD_REVID = 17123  # example

r = s.get(base, params={
    "action": "query", "prop": "revisions", "titles": "Changelog",
    "rvstartid": GOOD_REVID, "rvlimit": 1, "rvprop": "content", "format": "json"
}, timeout=10)

pages = r.json()["query"]["pages"]
for pid, pdata in pages.items():
    old_content = pdata["revisions"][0]["*"]
    print(f"Content length: {len(old_content)} chars")
```

### 3. Restore

```python
r = s.get(base, params={"action":"query","meta":"tokens","format":"json"}, timeout=10)
csrf = r.json()["query"]["tokens"]["csrftoken"]

r = s.post(base, data={
    "action": "edit", "title": "Changelog", "text": old_content,
    "summary": "Restore to rev %d — undo bot edits" % GOOD_REVID,
    "bot": "true", "token": csrf, "format": "json"
}, timeout=15)
print("Restore:", r.json().get("edit",{}).get("result"))
```

### 4. Revert Bot State

```python
import json

# Revert bot state — actual file is state.json (NOT bot_state.json)
# There is no last_build.txt — build info is in state.json
state = {
    "latest_got_build": "0.13.0.8808.63144",
    "latest_got_version": "0.13.0",
    "phase": "Early Access",
    "last_got_message_id": None,
    "last_csez_message_id": None
}
with open("/home/donzzz/projects/got-patch-bot/state.json", "w") as f:
    json.dump(state, f, indent=2)

# Clear any stale message file
import os
try:
    os.remove("/home/donzzz/projects/got-patch-bot/last_got_message.txt")
except FileNotFoundError:
    pass

# Revert template
r = s.post(base, data={
    "action": "edit", "title": "Template:Gameversion",
    "text": "[[Changelog|0.13.0.8808.63144]]\n\n<noinclude>\nThis is a simple template to change the game version displayed on the main page.\n</noinclude>\n\n[[Category:Templates]]",
    "summary": "Revert to 0.13.0.8808.63144",
    "bot": "true", "token": csrf, "format": "json"
}, timeout=15)
```

### 5. Restart Bot

```bash
systemctl --user restart got-patch-bot.service
```

## Before Re-Testing After Revert

After reverting wiki pages and bot state for a fresh test:

1. **Clear `last_got_message.txt`** — stale patch notes from before the revert will be re-used by the bot
2. **Clear `wiki_tasks.json`** — remove any pending tasks from before the revert
3. **Verify bot state** — `cat ~/projects/got-patch-bot/state.json` should show the reverted build
4. **Check for duplicate services** — `systemctl --user list-units --all | grep got` — kill any duplicates
5. **Restart bot** — `systemctl --user restart got-patch-bot.service`
6. **Verify bot loaded correct state** — check logs for "Current GoT build: <reverted version>"

## Prevention

- Always `py_compile.compile(doraise=True)` after editing bot.py
- Test on a small scale before bulk edits
- Keep bot state files in sync with wiki state
- Use `ast.parse()` to verify Python syntax after patches
