# Ghostsoftabor Archive — June 2026

## What was done

1. **Scraped ghostsoftabor.org** (Google Sites) using `wget --mirror` → 14 files, ~2.2MB
2. **Created private GitHub repo** `DonZzzilla/ghostsoftabor` via API
3. **Pushed all content** — site pages, BOA pages, calculators, timestamp generator
4. **Generated 2025 BOA page** from community Google Sheets data

## Google Sheets Source

- **2025 data:** Sheet ID `1cPX9TVgK0koqMS3UCl09Uo1tKbSdhCQ-fKfMOfKw7CU` (public sharing link)
  - 65 active players, 699 total tickets, 461 prize tickets
  - 11 months of data (Jan-Nov; December empty/zero)
- **2026 data:** Not yet available — need separate sheet link from user

## Column Mapping (2025 sheet)

| Column Index | Content |
|---|---|
| 0 | Empty for data rows; labels for special rows ("Total Tickets Ran In Month", "Top BOA/BOAS") |
| 1 | Player name + Discord ID (format: `Name - 1234567890`) |
| 2-13 | Monthly ticket counts (Jan-Dec) |
| 15 | Year Total |
| 17 | Prize Total |

**Key pitfall:** Column 0 is NOT the player name. Column 1 is. Always print first few rows to verify.

## 2025 Year Top 5

1. Motionless — 71 tickets
2. Vydrac — 50 tickets
3. Jekyll — 49 tickets
4. GB21 — 44 tickets
5. AlixVR — 34 tickets

## Next Steps (when 2026 data available)

1. Get Google Sheets link for 2026 BOA data
2. Export CSV: `https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid=0`
3. Verify column layout matches 2025 sheet before parsing
4. Generate `boa/2026.html` using same template pattern
5. Update `boa/index.html` to include 2026
6. Commit and push
