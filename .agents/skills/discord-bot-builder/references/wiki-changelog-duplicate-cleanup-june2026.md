# Wiki Changelog Duplicate Entry Cleanup — June 3, 2026

## Problem

When the bot detects a new build and inserts a changelog entry, it can create duplicates or insert entries with wrong content. This happened on June 3, 2026:

1. User forwarded Hotfix 5 notes → bot saved to `last_got_message.txt`, started Phase 1
2. Scraper found Hotfix 5 build (`0.13.0.8860.63875`) → inserted entry with Hotfix 5 notes ✓
3. User forwarded Hotfix 6 notes → bot overwrote `last_got_message.txt` with Hotfix 6 notes, restarted Phase 1
4. Scraper found Hotfix 6 build (`0.13.0.8862.63913`) → inserted entry BUT `parse_got_patch_notes()` read "Hotfix 5" from the saved text, creating a mismatched entry
5. Result: Page had Hotfix 6 build number with Hotfix 5's patch notes, AND a duplicate Hotfix 5 entry

## Root Cause

- `last_got_message.txt` is a single file overwritten by every forward
- The scraper reads it later when the build is detected, which may be a different hotfix
- `parse_got_patch_notes()` extracts the hotfix number from the saved text, not from the actual build detection context
- Multiple rapid builds (same day) exacerbate the problem

## Detection

After any bot edit to the wiki Changelog page, check for duplicates:

```python
import requests, re

r = requests.get("https://got.miraheze.org/w/api.php",
    params={"action":"parse","page":"Changelog","prop":"wikitext","format":"json"},
    headers={"User-Agent":"ZzzillaBot/1.0"}, timeout=15)
wt = r.json()["parse"]["wikitext"]["*"]

entries = [(m.start(), m.group(1)) for m in re.finditer(r'==\s+([\d.]+)\s+\(\d{4}-\d{2}-\d{2}\)\s+==', wt)]

from collections import Counter
versions = [v for pos, v in entries]
dups = {v: c for v, c in Counter(versions).items() if c > 1}
if dups:
    print(f"DUPLICATES FOUND: {dups}")
```

## Cleanup Procedure

### Step 1: Identify entries

```python
hf5_positions = [pos for pos, ver in entries if '8860.63875' in ver]
hf6_positions = [pos for pos, ver in entries if '8862.63913' in ver]
```

### Step 2: Extract correct block, remove wrong ones

```python
keep_start = hf6_positions[0]
next_entry = entries[entries.index((keep_start, '0.13.0.8862.63913')) + 1][0]
keep_block = wt[keep_start:next_entry]
wt_clean = wt[:keep_start] + wt[next_entry:]
```

### Step 3: Insert at correct position (newest first)

```python
insert_pos = wt_clean.find("== 0.13.0.8860.63875")
wt_new = wt_clean[:insert_pos] + keep_block + "\n" + wt_clean[insert_pos:]
```

### Step 4: Save via wiki API

```python
r = session.post(base, data={
    "action": "edit", "title": "Changelog", "text": wt_new,
    "summary": "Fix duplicate entries",
    "bot": "true", "token": csrf, "format": "json"
}, timeout=15)
```

## Prevention

1. **Save per-hotfix message files**: `last_got_message_Hotfix6.txt` instead of single file
2. **Verify before insert**: Check if build number already exists on page
3. **Post-edit verification**: After every bot edit, fetch page and verify no duplicates

## Position-Based Slicing Pattern

When the wiki page has structural issues, use position-based slicing:

```python
pos1 = wt.find("== 0.13.0.8862.63913 (2026-06-03) ==")
pos2 = wt.find("== 0.13.0.8860.63875 (2026-06-03) ==")
pos3 = wt.find("== 0.13.0.8808.63144 (2026-05-18) ==")
wt_new = wt[:pos1] + wt[pos2:pos3] + wt[pos1:pos2] + wt[pos3:]
```

This avoids regex pitfalls with special characters in version strings.
