# Gas Price Data Sources — Research Notes (June 2026)

## Summary

**No free API provides station-level real-time gas prices in dollar amounts.** This was exhaustively tested across all known sources.

## Tested Sources

### Google Places API
- **Provides**: `price_level` field (0-4 scale: Free, $, $$, $$$, $$$$$)
- **Free tier**: $200/month credit
- **Limitations**: Only relative pricing, not actual dollars. Not all stations have price_level data.
- **Endpoints used**: Nearby Search, Place Details, Text Search, Geocoding
- **Verdict**: Best free option available. Shows relative price comparison between stations.

### GasBuddy
- **Provides**: Actual dollar amounts (e.g., "$4.59/gal")
- **Free tier**: None — private API
- **Limitations**: Cloudflare blocks all bot traffic. Website is fully JS-rendered (Handlebars templates). No server-side API endpoints found.
- **Verdict**: Not accessible without paid enterprise API.

### OpenStreetMap / Overpass API
- **Provides**: Station locations, brand names, fuel types (diesel, octane 95, etc.)
- **Free tier**: Fully free
- **Limitations**: Zero price data. No `fuel:price` tags found on any stations tested.
- **Verdict**: Good for station locations, no pricing.

### EIA (Energy Information Administration)
- **Provides**: Regional weekly averages (e.g., "West Coast: $5.358/gal")
- **Free tier**: Free with API key registration at https://www.eia.gov/opendata/register.php
- **Limitations**: Only regional averages, not station-level. Weekly updates, not real-time.
- **Verdict**: Useful for context, not for station-level pricing.

### AAA Fuel Prices
- **Provides**: National and state averages
- **Free tier**: Free (no API key needed)
- **Limitations**: State-level averages only, not station-level.
- **Verdict**: Not useful for station-level pricing.

### Google Maps Website
- **Provides**: Sometimes shows prices in search results for signed-in users
- **Limitations**: No prices shown to unauthenticated users/bots. "Limited view" blocks detail panel content. JavaScript-rendered.
- **Verdict**: Not scrapable for prices.

### Selenium Browser Automation
- **Status**: Cannot run on this Raspberry Pi (ARM64)
- **Reason**: Chrome for Testing doesn't build Linux ARM64 ChromeDrivers. Only x86_64 and mac-arm64 available.
- **Verdict**: Not an option for browser automation on this hardware.

## Recommended Approach

For the `!gas` command:
1. Use Google Places API for station locations + `price_level`
2. Show 1-2 cheapest stations (sorted by price_level) + nearest Costco
3. Include Google Maps links for each station
4. Note that tapping Maps links shows actual current prices on Google Maps
5. Display price_level as $-$$$$ with explanation of the scale

For future `!gasexact` command (if implemented):
- Would require either paid API (GasBuddy enterprise, OPIS) or signed-in Google Maps session
- Browser automation not possible on this Pi hardware
