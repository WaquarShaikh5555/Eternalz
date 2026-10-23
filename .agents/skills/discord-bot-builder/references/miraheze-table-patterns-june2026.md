# Miraheze Wiki Table Patterns — June 2026

## FilterTable Template Pattern

Miraheze wikis support `{{FilterTable}}` gadget for interactive column filters. Used on Ammo, Quests pages.

### Template Structure

```
{{FilterTable
|table=ft-unique-id
|1=
{{FilterTable/row|reset=true}}
{{FilterTable/row|column=N|label=ColName:|all=true|mode=exact|1=Opt1|2=Opt2}}
{{FilterTable/row|column=N|label=ColName2:|all=true|mode=contains|1=Opt1}}
{{FilterTable/row|search=true|label=Search:}}
<div>Showing <span class="filter-counter"></span> of <span class="filter-counter-total"></span> items.</div>
}}
```

### Table Markup

- `id` must match `|table=` param
- `class="sortable mw-collapsible fandom-table floatheader"`
- Header widths via `! style="width:Xpx"| ColName`

### Filter Modes

- `mode=exact` — dropdown with exact match (for categorical: Trader, Phase, Type)
- `mode=contains` — text contains (for free-text: Location)
- `mode=is greater than` — numeric comparison (for stats)

### Row Coloring (Ammo Page Style)

Full row coloring — every cell in a row gets the same background color. Phase column gets a **distinct** color from the row color to remain readable.

### Divider Rows

Black divider rows between groups (9 empty colored cells for 9-column table).

### Working Color Scheme (CSEZ Quests)

**Trader colors** (full row): ARK=#385c79 blue, NTG=#2e5c30 green, TRUPIK'S=#903e90 purple, Regiment=#824b39 brown, Boulder Forge=#782c11 dark red

**Phase colors** (distinct): Early=#3d7a3d forest green, Mid=#8a8a1e olive, Late=#b8860b dark goldenrod

### Common Pitfalls

1. **U+FFFD garbled characters** — Bulk find-replace on wikitext can insert Unicode replacement chars that break table structure. Rebuild from scratch instead of patching.
2. **Missing columns** — Every row must have exactly the same number of cells as the header.
3. **FilterTable JS** — Works for real users but may not execute in headless browsers.

## Bulk Page Creation from Table Data

When creating many wiki pages (e.g., 41 quest pages): parse source table via API, extract cells, handle garbled chars by rebuilding, create via login→CSRF→edit loop with `createonly=True`.

## Direct Wiki Update (Bot Pattern)

Bots can update wiki pages directly via Miraheze API instead of writing task files for cron jobs. This eliminates the 10-minute delay. See bot.py `update_csez_wiki_version()` function for implementation.

## Session Pitfalls (June 3, 2026)

| Pitfall | Cause | Fix |
|---------|-------|-----|
| Build not extractable from Discord msg | CSEZ forwarded notes may not contain recognizable version pattern | Try multiple regex patterns: bold headers, Version:/Build:/Patch: labels, vX.X.X.X with word boundary, standalone X.X.X.X on own line; also check embed **title, author.name, footer.text, url** — not just description and fields |
| Wiki template not updated after bot detects build | Bot only writes task file, cron job applies it (10-min delay) | Add **direct wiki update** function that calls Miraheze API from the bot handler. Use login→CSRF→edit pattern. Still write task file as fallback. |
| Miraheze table broken after bulk edit | U+FFFD replacement chars inserted by find-replace break table structure | **Rebuild table from scratch** instead of patching. Parse data from API, generate clean wikitext, paste as single edit. |
| FilterTable filters render but don't work in headless browser | Headless browser doesn't execute FilterTable gadget JS | FilterTable works for real users. Headless browser testing won't show filtering — verify wikitext structure matches Ammo page pattern instead. |
| Bot self-triggers on own test messages | Bot sends test message to channel, own `on_message` picks it up | Bot correctly ignores own messages via `if message.author.bot: return`. Send test messages from a different account, or test by calling handler function directly. |