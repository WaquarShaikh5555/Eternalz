# GoT Scraper Source Fixes — June 3, 2026

## Problem: All 3 Bot Scraper Sources Were Broken

The `got_scraper()` function in `bot.py` used these URLs:
1. `ghostsoftabor.com/api/store/build` → **404** (WordPress site, old API gone)
2. `api.steampowered.com/...appid=996450` → **Wrong app ID** (should be `1957780`; even with correct ID, `required_version: 1000` is useless)
3. `ghostsoftabor.com/api/build` → **404** (same reason)

Meanwhile, `changelog_sync.py` used the **correct** source:
- `queststoredb.com/game/ghosts-of-tabor-7614022262006379/` → **WORKS** (JSON-LD `softwareVersion` in static HTML)

The bot code and sync script were out of sync — the bot had stale URLs while the sync script had the working one.

## Fix: Updated Bot Scraper Sources

Replaced the bot's 3 sources with:
1. **QuestStoreDB** (primary): `queststoredb.com/game/ghosts-of-tabor-7614022262006379/`
   - Parse JSON-LD: `<script type="application/ld+json">` → `softwareVersion` field
   - Fallback: HTML table regex `app version</td><td>([\d.]+)`
   - Requires custom User-Agent (blocks default requests UA)
2. **Steam News** (fallback): `ISteamNews/GetNewsForApp/v2/?appid=1957780&count=3`
3. **Steam API** (tertiary): Correct app ID `1957780` (but `required_version: 1000` is meaningless)

## Changelog Sync Gap

After the bot updates the wiki Changelog page, it must also save the full wikitext to `/tmp/changelog_wikitext.txt` so `changelog_sync.py` can pick it up and regenerate the GitHub Pages HTML.

The bot's scraper function should call the wiki API to fetch the updated page:

```python
# After update_got_changelog succeeds:
import requests as _req
r = _req.get("https://got.miraheze.org/w/api.php",
    params={"action":"parse","page":"Changelog","prop":"wikitext","format":"json"},
    headers={"User-Agent":"ZzzillaBot/1.0"}, timeout=15)
wt = r.json().get("parse",{}).get("wikitext",{}).get("*","")
if wt:
    with open("/tmp/changelog_wikitext.txt","w") as _f:
        _f.write(wt)
```

The `changelog_sync.py` script reads from `/tmp/changelog_wikitext.txt` (preferred) or falls back to `changelog.json`.
