# GoT Patch Monitor Bot — Deployment Log (Updated June 2, 2026)

**Created:** May 31, 2026
**Updated:** June 2, 2026
**Bot Name:** Zzzilla (ID: 1511248700465483876)
**Status:** FULLY OPERATIONAL — 3-source fallback, v3 message format

## Architecture: Message-Triggered State Machine

The bot monitors `#got_updates` on Zzzilla Island for ANY new non-bot message.
On trigger, it runs a 3-phase check/cooldown cycle, scraping multiple sources
hourly for build number changes.

**Evolution:**
- v1: Polled Quest Store DB every 120s unconditionally
- v2: Added trigger → 9h check → 24h cooldown cycle
- v3: Multi-source fallback (QSDB → SideQuest → VRDB), source link in posts, triple-backtick build display
- v4: RSS feed generation alongside Discord posts, served via systemd http.server on port 8090
- v5: GitHub integration — RSS feed auto-pushed to DonZzzilla/taborian repo on every update

## Configuration

| Setting | Value |
|---------|-------|
| Target channel (Zzzilla #got_updates) | 1511246958868693012 |
| Bot script | /home/donzzz/projects/got-patch-bot/bot.py |
| Token file | constructed dynamically via os.path.join |
| Build cache | /home/donzzz/projects/got-patch-bot/last_build.txt |
| State file | /home/donzzz/projects/got-patch-bot/bot_state.json |
| Log file | /home/donzzz/projects/got-patch-bot/bot.log |
| systemd service | ~/.config/systemd/user/got-patch-bot.service |
| Idle poll interval | 60 seconds (Discord message check) |
| Active scrape interval | 3600 seconds (only during active phases) |
| Max check hours | 9 per phase |
| Cooldown hours | 24 between phases |
| Max phases | 3 |
| Initial baseline build | "0.11.3.8096.55222" |

### Pitfall: Initial Baseline Build

Set `INITIAL_BUILD` to a version **older** than the currently known version.
This ensures the first scrape after trigger detects a "change" and posts immediately.

## Version Scraping Sources (Ranked by Reliability)

| Source | URL | Status | Method |
|--------|-----|--------|--------|
| Quest Store DB | queststoredb.com/game/ghosts-of-tabor-7614022262006379/ | PRIMARY | JSON-LD `softwareVersion` in static HTML |
| SideQuest | sidequestvr.com/app/14965/ghosts-of-tabor | FALLBACK | `window.payload.versionname` in inline JS |
| VRDB | vrdb.app/game/ghosts-of-tabor/7614022262006379 | TERTIARY | `<span>` after `Version:` label in static HTML |
| Meta Store | meta.com/experiences/ | BLOCKED | Blocks all non-browser UAs |
| SteamDB | steamdb.info | IP BAN | Bans after few requests |
| Fandom wiki | ghosts-of-tabor.fandom.com | STALE | Often outdated |

**Note:** SideQuest versions may lag behind Quest Store DB (e.g., SQ showed
0.12.0.8387.58015 while QSDB had 0.13.0.8808.63144). Quest Store DB is authoritative.

**Note:** VRDB has the build number but may be slightly delayed compared to QSDB.
Always prefer QSDB → SideQuest → VRDB in that order.

## Parsing Techniques

### Quest Store DB (Primary)
Two parsing methods work against static HTML (no JS needed):

**Method 1: JSON-LD (preferred)**
Parse `<script type="application/ld+json">` → find `softwareVersion` field
in SoftwareApplication object.

**Method 2: HTML table (fallback)**
Regex: `app version</td><td>([\d.]+)`

Build number pattern: `\d+\.\d+\.\d+\.\d+\.\d+\.\d+`
Example: `0.13.0.8808.63144`

**IMPORTANT:** This version has **5 segments** (4 dots), not 6. Use regex
`0\.\d+\.\d+\.\d+\.\d+` (4 groups after `0.`), NOT `0\.\d+\.\d+\.\d+\.\d+\.\d+`.

### SideQuest (Fallback)
The page contains an inline `<script>` with `window.payload = {...}`.
The payload includes a `versionname` field with the build number.

```python
import re, json
m = re.search(r"window\.payload\s*=\s*({.*?})\s*;", r.text, re.DOTALL)
if m:
    data = json.loads(m.group(1))
    ver = data.get("versionname")
```

### VRDB (Tertiary)
The build number IS in the static HTML. The HTML structure uses Vue/React comment
markers between spans:

```html
<span class="text-muted-foreground text-sm mr-1">Version:</span><!--]-->
<span class="text-foreground text-sm"><!--[!-->
  <span class="text-foreground text-sm">0.13.0.8808.63144</span>
<!--]--></span>
```

The comment markers `<!--]-->` and `<!--[!-->` sit between the `Version:` label
and the value span. A simple regex anchored on "Version:" works:

```python
idx = r.text.find("Version:")
if idx >= 0:
    after = r.text[idx:idx+300]
    m = re.search(r"(0\.\d+\.\d+\.\d+\.\d+)", after)
    if m:
        ver = m.group(1)
```

**IMPORTANT:** Use `r.text.find("Version:")` first to locate the region, then
search for the version pattern in the next 300 chars. Do NOT use a single regex
across the whole page — the comment markers defeat `.*?` patterns even with
`re.DOTALL`.

**Regex pitfall:** The version `0.13.0.8808.63144` has 5 dot-separated segments.
Pattern `0\.\d+\.\d+\.\d+\.\d+` (4 groups after `0.`) matches.
Pattern `0\.\d+\.\d+\.\d+\.\d+\.\d+` (5 groups) does NOT match.

## Post Format (v3 — June 2, 2026)

```
🔫 Ghosts of Tabor — Update Detected

Detected: 2026-06-02 14:56 UTC
-# Source: Quest Store DB <https://queststoredb.com/game/ghosts-of-tabor-7614022262006379/>
Build: 
0.13.0.8808.63144

-# Auto-detected by Zzzilla
```

Key format requirements:
- Date and time on `Detected:` line (UTC)
- Source attribution as `-# Source: <name> <link>` (NOT Meta Store link)
- Build number in triple backticks below `Build:` label
- Gun emoji (🔫) in title
- No bold on title text
- `-# Auto-detected by Zzzilla` at bottom
