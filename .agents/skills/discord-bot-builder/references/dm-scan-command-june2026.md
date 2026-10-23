# DM Scan Command Pattern (June 2026)

## !scan Command

The `!scan [N]` DM command lets the user manually trigger a scan of both update channels for new builds/patch notes. Useful when the bot might have missed something or the user wants an immediate check.

### Implementation

```python
elif lower in ("!scan", "scan", "!check", "check"):
    limit = 20
    for part in content.split():
        if part.isdigit():
            limit = min(int(part), 100)
            break
    await message.channel.send("Scanning last %d messages..." % limit)
    await scan_channels(message, limit=limit)
```

### scan_channels Function

Key behaviors:
1. **CSEZ scan**: Fetches channel history, extracts build numbers from message content + all embed parts (title, description, author.name, footer.text, url, field.value, field.name), compares to last known build
2. **GoT scan**: Fetches channel history, looks for messages containing patch/hotfix/update/version/build/deploy keywords
3. **Auto-trigger**: If GoT triggers found and scraper is idle, auto-activates phase 1
4. **Report**: Sends formatted summary back to DM, splitting at 1900 chars if needed

### GoT Auto-Trigger Logic

```python
if recent_triggers and not scraping:
    got_state["phase"] = 1
    got_state["phase_start_time"] = time.time()
    got_state["phase_checks"] = 0
    got_state["scraping_active"] = True
    got_state["cooldown_until"] = None
    hourly_scrape_time = 0
    save_state(got_state, GOT_STATE_FILE)
```

### Important: Avoid Re-Triggering on Old Messages

The `!scan` command should NOT re-trigger the scraper for messages that were already processed. The bot's `handle_got_message` already sets `last_seen_id` on startup. For the scan command, either:
- Skip messages with ID <= last_seen_id
- Or accept that a manual scan is intentional and always check

Current implementation: scans all N messages and reports findings. Auto-trigger only fires if `scraping_active == False`.

### Channel IDs

```python
GOT_CHANNEL_ID  = 1511246958868693012   # #got_updates
CSEZ_CHANNEL_ID = 1511247103043702834   # #csez_updates
```

### Testing

1. DM `!scan` — should scan last 20 messages in both channels
2. DM `!scan 50` — should scan last 50 messages
3. If new CSEZ build found: reports build number + timestamp + preview
4. If new GoT trigger found: reports trigger count + previews + auto-activates scraper
5. If nothing found: reports "no new builds" / "no triggers" with last human message timestamp
