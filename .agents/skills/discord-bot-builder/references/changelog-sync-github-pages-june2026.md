# Changelog Sync to GitHub Pages — June 2, 2026

## Architecture: Wiki → Parse → Generate → Publish

For game wikis with extensive changelogs (GoT, CSEZ), the bot can maintain a full
public-facing changelog site on GitHub Pages, synced from the Miraheze wiki.

**Pattern:** Bot detects new build → scrapes wiki changelog wikitext → parses into
structured JSON → generates HTML + RSS → commits to repo → GitHub Pages auto-publishes.

## Repos Created

| Game | Repo | Site | Entries | Current Build |
|------|------|------|---------|---------------|
| Ghosts of Tabor | DonZzzilla/got-changelog | donzzzilla.github.io/got-changelog | 73 | 0.13.0.8808.63144 |
| CSEZ | DonZzzilla/csez-changelog | donzzzilla.github.io/csez-changelog | 71 | 1.6.8.0 |

## Wiki Scraping via API

Miraheze wikitext can be fetched without login using the MediaWiki API:

```python
import urllib.request, json

url = 'https://<wiki>/w/api.php?action=parse&page=Changelog&prop=wikitext&format=json'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read())
    wikitext = data['parse']['wikitext']['*']
```

This works for any public Miraheze wiki page. No browser session needed.

## Wiki Parsing Patterns

### GoT Changelog Structure
```
== VERSION (DATE) ==
=== Section Name ===
* item 1
* item 2
```

Split on `== VERSION (DATE) ==` (level-2 headers), then parse `=== Section ===` (level-3) sub-headers.

### CSEZ Changelog Structure
```
== Category ==
=== DATE (VERSION) ===
==== Sub-Section ====
* item 1
```

Split on `== Category ==` first, then `=== DATE (VERSION) ===` (level-3), then `==== Sub-Section ====` (level-4).

**Key difference:** GoT uses `== Version ==` as top-level, CSEZ uses `== Category ==` → `=== Date (Version) ===`.

### Version Number Formats
- GoT: `0.13.0.8808.63144` (5 segments, 4 dots) — regex: `0\.\d+\.\d+\.\d+\.\d+`
- CSEZ: `1.6.8.0` (4 segments, 3 dots) — regex: `\d+\.\d+\.\d+\.\d+`
- Some entries have no version number (e.g., "Alpha build 1")

### Wiki Markup Cleaning
```python
item = re.sub(r"'''(.*?)'''", r'\1', item)  # bold
item = re.sub(r"''(.*?)''", r'\1', item)     # italic
item = re.sub(r'\[\[([^|\]]+)\|([^\]]+)\]\]', r'\2', item)  # [[link|text]]
item = re.sub(r'\[\[([^\]]+)\]\]', r'\1', item)  # [[link]]
item = re.sub(r'<[^>]+>', '', item)  # HTML tags
item = re.sub(r'\[\[Category:[^\]]+\]\]', '', item).strip()  # categories
```

## HTML Generation

Both sites use a dark theme with:
- Color-coded items: green (added), yellow (fixed), removed (red)
- Search box (client-side JS filtering)
- Responsive layout
- Stats per entry (change count, section count)

The HTML is generated as a single self-contained file (no external CSS/JS).

## GitHub Pages Setup

1. Create repo via GitHub API: `POST /user/repos` with `{"name":"got-changelog","auto_init":false}`
2. Enable Pages: `POST /repos/{owner}/{repo}/pages` with `{"source":{"branch":"main","path":"/"}}`
3. Clone locally: `git clone https://<token>@github.com/DonZzzilla/got-changelog.git /tmp/got-changelog`
4. Generate files into the local clone
5. `git add -A && git commit -m "..." && git push`

**Site URL:** `https://<username>.github.io/<repo>/`

## Sync Script Pattern

Keep a separate `changelog_sync.py` script that:
1. Scrapes current build number (from wiki Template:Version or Quest Store DB)
2. Scrapes full changelog wikitext via API
3. Parses into structured JSON
4. Generates HTML + RSS + JSON
5. Git pushes to GitHub

Call from bot main loop via `subprocess.run(["python3", "changelog_sync.py"], timeout=120)`.

## RSS Feed Generation

```python
from email.utils import formatdate
import calendar, time

now_t = time.gmtime()
date_str = formatdate(calendar.timegm(now_t))  # NOT .timestamp() — Python 3.7 compat
```

Use `calendar.timegm()` — NOT `time.gmtime().timestamp()` which doesn't exist in Python 3.7 (Raspberry Pi OS).

## Serving RSS Locally

```ini
# ~/.config/systemd/user/rss-server.service
[Service]
ExecStart=/usr/bin/python3 -m http.server 8090 --directory /home/donzzz/public_html
```

Check port availability first: `ss -tlnp`. Port 8088 = InfluxDB, 5678 = n8n, 80/443 = cloudflared on Don's Pi.

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Wiki API returns 404 | Wrong page name or wiki URL | Verify page exists; check namespace |
| Parsed 0 entries | Wrong split pattern for wiki structure | Debug with `print(blocks[:3])` |
| HTML too large for execute_code | 127K+ char strings | Write via `open().write()` not execute_code |
| Git push fails | Token in URL gets stripped | Use `~/.git-credentials` file instead |
| GitHub Pages 404 | Pages not enabled or wrong branch | Enable via API; wait 2-3 min for deployment |
| Version regex mismatch | Wrong segment count | Test against actual version string first |
