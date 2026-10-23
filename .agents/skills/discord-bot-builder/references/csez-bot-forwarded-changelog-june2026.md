# CSEZ Bot: Forwarded Message Detection & Changelog Update

## Forwarded Message Detection (June 2026)

When users forward patch notes from another Discord channel, the content often arrives as a **Discord embed** rather than plain text. The bot's `on_message` handler must check ALL embed properties:

```python
forwarded = content
for embed in message.embeds:
    if embed.title:
        forwarded += "\n" + embed.title
    if embed.description:
        forwarded += "\n" + embed.description
    if embed.author and embed.author.name:
        forwarded += "\n" + embed.author.name
    if embed.footer and embed.footer.text:
        forwarded += "\n" + embed.footer.text
    if embed.url:
        forwarded += "\n" + embed.url
    for field in embed.fields:
        forwarded += "\n" + str(field.value)
        if field.name:
            forwarded += "\n" + str(field.name)
```

**Why this matters:** Forwarded messages often have empty `content` and all the actual text in embed descriptions/titles/fields. Only checking `embed.description` and `embed.field.value` misses build numbers in titles, footers, and field names.

## Build Extraction Regex (CSEZ)

CSEZ build numbers are 4-segment: `1.6.9.0`. Use these patterns in priority order:

```python
def extract_csez_build(text):
    if not text: return None
    m = re.search(r"\*\*[Vv]?\s*(\d+\.\d+\.\d+\.\d+)\s*\*\*", text)
    if m: return m.group(1)
    m = re.search(r"(?:[Vv]ersion|[Bb]uild|[Pp]atch)\s*[:\-]?\s*v?(\d+\.\d+\.\d+\.\d+)", text)
    if m: return m.group(1)
    m = re.search(r"\bv(\d+\.\d+\.\d+\.\d+)\b", text)
    if m: return m.group(1)
    m = re.search(r"(?:^|\n)\s*(\d+\.\d+\.\d+\.\d+)\s*(?:\n|$)", text)
    if m: return m.group(1)
    m = re.search(r"(?<!\d\.)(\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,4})(?!\.\d)", text)
    if m: return m.group(1)
    return None
```

## CSEZ Changelog Page Update

The CSEZ wiki Changelog page uses this format:

```
== Alpha ==

=== 2026-06-03 (1.6.9.0) ===

* Fixed an issue where reconnection was abnormal
* Fixed a bullet duplication issue

=== 2026-06-01 (1.6.8.0) ===

* Backend server improvements
```

**Insertion logic:**
1. Find `== Alpha ==` header
2. Find the first `=== YYYY-MM-DD (VERSION) ===` after it
3. Insert new entry BEFORE the first existing entry

**Patch note extraction from forwarded content:**
- Skip version headers (`**v1.6.9.0**`, `Version: 1.6.9.0`)
- Skip lines starting with `#` containing "patch"
- Remove existing bullet markers
- Format remaining lines as `* line`

## CSEZ Auto-Update Parser

CSEZ patch notes are simpler than GoT — no emoji sections, just a flat list:

```python
def parse_csez_patch_notes(text, build):
    """Parse CSEZ Discord patch notes into wiki wikitext format.
    Clean format without emojis — differentiates from GoT."""
    import re
    from datetime import datetime
    lines = text.split('\n')
    date_str = datetime.now().strftime("%Y-%m-%d")
    wiki_lines = []
    wiki_lines.append("=== %s (%s) ===" % (date_str, build))
    wiki_lines.append("")
    for line in lines:
        line = line.strip()
        if not line: continue
        # Skip header line (e.g. "# Patch Note v.1.6.9.0")
        if line.startswith('# ') and ('patch' in line.lower() or 'note' in line.lower() or 'v.' in line.lower()):
            continue
        if line.startswith('- ') or line.startswith('* '):
            bullet = line[2:].strip()
            wiki_lines.append("* %s" % bullet)
            continue
        if line and not line.startswith('#'):
            wiki_lines.append("* %s" % line)
    wiki_lines.append("")
    return "\n".join(wiki_lines)

def update_csez_changelog(build, patch_notes_wikitext):
    """Insert a new patch notes entry at the top of the CSEZ Changelog page."""
    try:
        s = requests.Session()
        s.headers.update({"User-Agent": "CSEZWikiBot/1.0 (ZeroSkills)"})
        base = "https://csez.miraheze.org/w/api.php"
        r = s.get(base, params={"action":"query","meta":"tokens","type":"login","format":"json"}, timeout=10)
        tok = r.json()["query"]["tokens"]["logintoken"]
        r = s.post(base, data={"action":"login","lgname":"ZeroSkills","lgpassword":"ForkedT2000","lgtoken":tok,"format":"json"}, timeout=10)
        if r.json()["login"]["result"] != "Success":
            log("CSEZ changelog: login failed"); return False
        r = s.get(base, params={"action":"query","meta":"tokens","format":"json"}, timeout=10)
        csrf = r.json()["query"]["tokens"]["csrftoken"]
        r = s.get(base, params={"action":"parse","page":"Changelog","prop":"wikitext","format":"json"}, timeout=10)
        current = r.json()["parse"]["wikitext"]["*"]
        # Insert after "== Alpha ==" header, before first === date ===
        alpha_pos = current.find("== Alpha ==")
        if alpha_pos >= 0:
            after_alpha = current[alpha_pos:]
            first_entry = re.search(r'\n===\s+\d{4}-\d{2}-\d{2}', after_alpha)
            if first_entry:
                insert_pos = alpha_pos + first_entry.start()
                new_content = current[:insert_pos] + "\n" + patch_notes_wikitext + current[insert_pos:]
            else:
                new_content = current + "\n" + patch_notes_wikitext
        else:
            new_content = current + "\n" + patch_notes_wikitext
        r = s.post(base, data={
            "action":"edit","title":"Changelog","text":new_content,
            "summary":"Add %s patch notes"%build,"bot":"true","token":csrf,"format":"json"
        }, timeout=15)
        result = r.json().get("edit",{}).get("result")
        if result == "Success":
            log("CSEZ changelog: added %s entry"%build); return True
        else:
            log("CSEZ changelog edit failed: %s"%str(r.json())[:200]); return False
    except Exception as e:
        log("CSEZ changelog error: %s"%e); return False
```

## Auto-Update in handle_csez_message

The `handle_csez_message` function should call the changelog updater after updating the template:

```python
# In handle_csez_message, after updating Template:Version:
try:
    patch_wiki = parse_csez_patch_notes(forwarded, build)
    if patch_wiki:
        update_csez_changelog(build, patch_wiki)
except Exception as e:
    log("CSEZ changelog error: %s" % e)
```

## Direct Wiki Update from Bot

Don't rely solely on the cron job queue for wiki updates. The bot should update the wiki directly via API for instant results. Still write the task file as a cron fallback.

## U+FFFD Garbled Character Issue

When wiki edits produce U+FFFD replacement characters (encoding issues during link insertion), table cells merge or break. Rows end up with 7-8 cells instead of 9. **Prevention:** Verify wikitext after edits. Check for `\uffffd`. Rebuild entire table from scratch if found.

## Full CSEZ Update Flow

1. Message in `#csez_updates` → extract build from content + all embed parts
2. Compare with `last_known_build`
3. If new: save state → post Discord message → update Template:Version → append to Changelog → write task file → write RSS → sync GitHub
