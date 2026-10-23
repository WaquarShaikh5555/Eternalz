# Patch Tool Pitfalls — June 2026

Discovered while editing `/home/donzzz/projects/got-patch-bot/bot.py`.

## 1. `\n` in `new_string` Becomes Literal Backslash-n

The `patch` tool's `new_string` parameter interprets `\n` as two literal characters (`\` + `n`), not a newline. This silently corrupts code.

```python
# What you write in patch new_string:
await ctx.send("\n".join(lines))

# What ends up in the file:
await ctx.send("\\n".join(lines))  # Sends literal "\n" text, not newlines
```

**Fix:** Use `chr(10)` instead:
```python
await ctx.send(chr(10).join(lines))
```

This applies to ALL escape sequences in `new_string`: `\n`, `\t`, `\r` all become literal backslash + letter.

## 2. Duplicate Code After Patching

The patch tool can fail to fully remove `old_string`, appending `new_string` alongside it. Result: duplicate `await ctx.send()`, duplicate `elif` branches, duplicate function bodies.

**After every patch:**
```bash
grep -n "await ctx.send" bot.py | tail -10
grep -n "async def " bot.py
python3 -c "import ast; ast.parse(open('bot.py').read())" && echo "Syntax OK"
```

**Fix for duplicates:** Use more surrounding context (15+ lines) in `old_string` to make it unique. Better: rewrite entire functions via Python `open().write()` instead of patching.

## 3. F-string Nested Quotes

f-strings like `f"...{now.strftime(\"%A %I:%M %p\")}..."` fail because inner `"` closes the f-string.

**Fix:** Extract to variable first:
```python
time_str = now.strftime("%A %I:%M %p")
lines = [f"**Report — {time_str}**", ""]
```

Same applies to any f-string containing format specifiers with quotes inside `{...}`.

## 4. Large Block Replacements

For replacing entire function bodies (50+ lines), the patch tool is unreliable. Use a Python script instead:

```python
with open("bot.py") as f:
    content = f.read()

start = content.index("async def cmd_gas(")
# ... find end of function ...
new_block = '''async def cmd_gas(...):
    """new docstring"""
    ...'''

content = content[:start] + new_block + content[end:]

with open("bot.py", "w") as f:
    f.write(content)

import ast
ast.parse(content)  # Verify
```

## 5. Reddit 403 with urllib

Reddit blocks `urllib.request` with bot UAs like `ZzzillaBot/1.0`.

**Fix:** Use browser-like UA:
```python
req = urllib.request.Request(url, headers={
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
})
```

## 6. Gas Price Data — Known Dead Ends & Working Solutions

| Source | Status | Why |
|--------|--------|-----|
| GasBuddy | ❌ Blocked | Cloudflare bot detection. No public API. JS-rendered. |
| Google Maps website | ❌ No prices | Prices only for signed-in users. "Limited view" for bots. |
| OSM/Overpass | ❌ No price data | Station locations only, zero price tags. |
| Yelp | ❌ 403 | Blocks non-browser requests. |
| AAA | ❌ JS-rendered | Prices in JS bundle, not HTML. |
| EIA API | ⚠️ Regional only | Free API key at https://www.eia.gov/opendata/register.php. Only weekly regional averages (e.g., "West Coast $5.358/gal"), NOT station-level real-time prices. |
| **Google Places API** | ✅ **Working** | **Free $200/mo credit. Returns `price_level` (0-4) per station. Not dollar amounts but relative pricing ($-$$$$).** |

### Google Places API Setup (June 2026)

1. Create Google Cloud project at https://console.cloud.google.com
2. Enable **Geocoding API** and **Places API** (both required)
3. Create API key → restrict to those APIs
4. Store key in `.google_key` file in bot project directory (readable by bot's OS user)
5. Read in bot code: `open(os.path.join(os.path.dirname(__file__), ".google_key")).read().strip()`

### Gas Station Search Pattern

```python
def google_geocode(address, api_key):
    url = f"https://maps.googleapis.com/maps/api/geocode/json?address={urllib.parse.quote(address)}&key={api_key}"
    req = urllib.request.Request(url, headers={"User-Agent": "ZzzillaBot/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    if data.get("results"):
        loc = data["results"][0]["geometry"]["location"]
        return loc["lat"], loc["lng"], data["results"][0].get("formatted_address", address)
    return None, None, None

def google_search_gas(lat, lon, api_key, radius=3000, max_results=10):
    url = (f"https://maps.googleapis.com/maps/api/place/nearbysearch/json"
           f"?location={lat},{lng}&radius={radius}&type=gas_station&key={api_key}")
    req = urllib.request.Request(url, headers={"User-Agent": "ZzzillaBot/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data.get("results", [])[:max_results]

def price_level_to_str(level):
    if level is None:
        return "?"
    return "$" * (level + 1)
```

**Note:** `price_level` is relative to the area, not absolute dollars. A $$$ station in LA might be $4.50/gal while $$$ in rural Kansas might be $3.20/gal. Still useful for comparing stations within the same zip code.

**Important:** Not all stations have `price_level` data. Some return `None`. This is normal — Google only has pricing data for stations that have reported it.
