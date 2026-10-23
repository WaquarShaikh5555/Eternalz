# Bot Command Reference — June 2026

Current DM commands for the Zzzilla Island Discord bot (got-patch-bot).

## Command List

| Command | Description |
|---------|-------------|
| `!got <build>` | Manual GoT update |
| `!got <build> \| <notes>` | Same with patch notes |
| `!csez <build>` | Manual CSEZ update |
| `!csez <build> \| <notes>` | Same with patch notes |
| `!scan [N]` | Scan last N messages |
| `!status` | Bot health |
| `!pi` | Raspberry Pi 5 status |
| `!build` | Current builds |
| `!work` | Live commute: Hawthorne to DTLA |
| `!home` | Live commute: DTLA to Hawthorne |
| `!redditday` | Top Reddit posts today |
| `!redditweek` | Top Reddit posts this week |
| `!news` | Local news headlines |
| `!weather` | Weather report |
| `!gas [zipcode]` | Gas stations by zip (default: 90250). Uses Google Places API. |
| `!help` | Show all commands |

## !gas Command Details

Uses Google Places API with key stored in `.google_key` file.

**price_level values**: 1=$, 2=$$, 3=$$$, 4=$$$$ (relative to area, NOT exact dollars).
Not all stations have price_level — shows "?" when unavailable.

**No free API provides station-level real-time dollar amounts.** Google Places is the best free option. GasBuddy is Cloudflare-blocked. OSM has no price data. EIA only has regional weekly averages. AAA shows state averages only.

For actual dollar amounts, users must tap the Google Maps link for each station.

## Key Pitfalls
- **write_file truncates API keys** — use terminal `echo` or Python `open().write()`
- **f-string nested quotes SyntaxError** — extract to variable first: `time_str = now.strftime(...)` then `f"...{time_str}..."`
- **Reddit 403** — must use browser-like User-Agent
- **OSRM no transit mode** — transit times are hardcoded based on known schedules
- **Selenium on ARM64 Pi** — Chrome for Testing doesn't build Linux ARM64 ChromeDrivers (only x86_64 and mac-arm64). Can't use Selenium browser automation on this Pi.
- **Google Maps JS API in browser** — can be loaded dynamically via script injection, but Places Service only returns `price_level`, not actual dollars
- **Google Places API key** — store in `.google_key` file, read via `open().strip()`. Key works for Geocoding, Places Nearby Search, and Places Details APIs.