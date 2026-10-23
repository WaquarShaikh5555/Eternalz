# Reference: Extracting Data from JS-Rendered Google Sheets & OpenRouter Monitoring

## Problem: Google Sheets JS-Rendered Data

Google Sheets URLs like `https://docs.google.com/spreadsheets/d/{id}/edit` return a JavaScript-heavy SPA. The `?output=csv` export returns 401 for private sheets.

## Solution: Parse the Waffle Table from HTML Source

Google Sheets renders its grid as an HTML `<table class="waffle">` in the page source.

```python
import urllib.request, re, html

html_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
req = urllib.request.Request(html_url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=15) as resp:
    page = resp.read().decode("utf-8", errors="replace")

# Find the waffle table
table_match = re.search(r'<table[^>]*class="[^"]*waffle[^"]*"[^>]*>(.*?)</table>', page, re.DOTALL)
if table_match:
    table_html = table_match.group(1)
    rows_raw = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL)
    rows = []
    for row_html in rows_raw:
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row_html, re.DOTALL)
        clean_cells = [html.unescape(re.sub(r'<[^>]+>', '', c).strip()) for c in cells]
        if any(c for c in clean_cells):
            rows.append(clean_cells)
```

## Accessing Specific Tabs via gviz API

```python
import urllib.request, csv, io, urllib.parse

tab_name = "Dashboard2"
encoded = urllib.parse.quote(tab_name)
url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded}"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=10) as resp:
    raw = resp.read().decode("utf-8-sig", errors='replace')
reader = csv.reader(io.StringIO(raw))
rows = list(reader)
```

## OpenRouter Model Availability Check

```python
import urllib.request, json

url = "https://openrouter.ai/api/v1/models"
req = urllib.request.Request(url, headers={
    "Authorization": f"Bearer {api_key}",
    "User-Agent": "HermesAgent/1.0"
})
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read().decode())

for model in data.get("data", []):
    if "owl-alpha" in model.get("id", "").lower():
        pricing = model.get("pricing", {})
        is_free = pricing.get("prompt") == "0" and pricing.get("completion") == "0"
        print(f"Model: {model['id']}, Free: {is_free}")
```

## Hermes config.yaml Protection

`~/.hermes/config.yaml` is a **protected system file** — the agent cannot edit it. User must run:

```bash
cd ~/.hermes && sed -i 's/^fallback_providers: \[\]$/fallback_providers:\n  - provider: openrouter\n    model: nvidia\/nemotron-3-ultra-550b-a55b:free/' config.yaml
```

Then restart: `hermes gateway restart`
