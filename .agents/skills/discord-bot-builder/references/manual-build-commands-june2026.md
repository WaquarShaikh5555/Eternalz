# Manual Build Commands: `!got` and `!csez` (June 2026)

## Purpose

Allow the owner to manually trigger a full update flow by DM, bypassing the scraper entirely. When the scraper is slow or broken, just grab the build number from wherever and DM it.

## Commands

```
!got 0.13.0.8860.63000     → Full GoT update (Discord, RSS, GitHub, wiki)
!csez 1.6.10.0              → Full CSEZ update (Discord, wiki, RSS, GitHub)
!g 0.13.0.8860.63000        → Short alias for !got
!c 1.6.10.0                 → Short alias for !csez
```

## What `!got <build>` Does

1. Validates build format (digits and dots, any number of segments)
2. Checks if already known (skip if same)
3. Saves as new known build
4. Posts update announcement to `#got_updates`
5. Writes RSS feed
6. Pushes to GitHub
7. Syncs changelog
8. Writes wiki task for Template:Gameversion
9. Confirms back to owner in DM

## What `!csez <build>` Does

1. Validates build format
2. Checks if already known
3. Saves as new known build
4. Posts update announcement to `#csez_updates`
5. Direct wiki update (Template:Version)
6. Writes wiki task (backup)
7. Writes RSS feed
8. Syncs changelog to GitHub
9. Confirms back to owner in DM

## Implementation Pattern

Place these FIRST in the on_dm handler, before !scan, !status, etc. Use `if/return` dispatch — never `elif` chains for command routing.

```python
import re as _re

if lower.startswith(("!got ", "!g ")):
    parts = raw.split(None, 1)
    if len(parts) < 2:
        await message.channel.send("Usage: `!got <build>` — e.g. `!got 0.13.0.8860.63000`")
        return
    build = parts[1].strip().lstrip("vV")
    if not _re.match(r'^\d+(?:\.\d+)+$', build):
        await message.channel.send("Invalid build format. Expected digits and dots.")
        return
    await manual_got_update(message, build)
    return

if lower.startswith(("!csez ", "!c ")):
    parts = raw.split(None, 1)
    if len(parts) < 2:
        await message.channel.send("Usage: `!csez <build>` — e.g. `!csez 1.6.10.0`")
        return
    build = parts[1].strip().lstrip("vV")
    if not _re.match(r'^\d+(?:\.\d+)+$', build):
        await message.channel.send("Invalid build format. Expected digits and dots.")
        return
    await manual_csez_update(message, build)
    return
```

## Key Design Decisions

- **`if/return` not `elif`** — each command is independent, safe to patch
- **`raw.split(None, 1)`** — splits only on first whitespace, preserves build as-is
- **Strip `v`/`V` prefix** — so `!got v0.13.0.8860.63000` also works
- **Flexible regex `^\d+(?:\.\d+)+$`** — accepts any number of dot-separated digit groups (GoT has 5 segments, CSEZ has 4)
- **`lower.startswith(...)` with tuple** — cleaner than multiple `or` conditions
- **Place FIRST in handler** — before `!scan`, `!status`, etc.

## Regex Pitfall

The rigid regex `^\d+\.\d+\.\d+\.\d+$` (exactly 4 segments) rejects GoT builds with 5 segments like `0.13.0.8860.63000`. Use `^\d+(?:\.\d+)+$` instead.

## Wiki Template Format

Both `manual_got_update` and `manual_csez_update` must write the FULL template wikitext, not just the version link. The wiki templates should contain:

```
[[Changelog|VERSION]]

<noinclude>
This is a simple template to change the game version displayed on the main page.
</noinclude>

[[Category:Templates]]
```

**GoT** (`Template:Gameversion`): `[[Changelog|0.13.0.8860.63000]]`
**CSEZ** (`Template:Version`): `[[Changelog|v1.6.9.0]]`

The `<noinclude>` block and `[[Category:Templates]]` category must be preserved on every update. Writing only the version link strips the documentation and removes the template from the Templates category.

## Session Context (June 3, 2026)

Added `!got` and `!csez` commands to Zzzilla bot. First attempt used `elif lower.startswith("!got ")` buried in a long elif chain — never matched because prior patches had created duplicate elif blocks. Fixed by rewriting entire `on_dm` function with `if/return` dispatch. The flexible regex was also needed because GoT builds have 5 dot-separated segments, not 4.

Also discovered that the wiki templates had lost their `<noinclude>` documentation blocks and `[[Category:Templates]]` categories — the bot was only writing `[[Changelog|VERSION]]`. Updated both the wiki pages and the bot's manual update functions to preserve the full template format.
