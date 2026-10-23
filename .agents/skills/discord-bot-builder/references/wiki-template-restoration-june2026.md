# Wiki Template Restoration (June 2026)

## Problem

The `Template:Gameversion` (GoT) and `Template:Version` (CSEZ) wiki pages had been reduced to just:
```
[[Changelog|VERSION]]
```

The `<noinclude>` documentation block and `[[Category:Templates]]` category were lost, likely from earlier bot updates that only wrote the version link.

## Full Template Format

Both templates should contain:

```
[[Changelog|VERSION]]

<noinclude>
This is a simple template to change the game version displayed on the main page.
</noinclude>

[[Category:Templates]]
```

- **GoT**: `[[Changelog|0.13.0.8860.63000]]` (no v-prefix)
- **CSEZ**: `[[Changelog|v1.6.9.0]]` (with v-prefix)

## How to Restore

```python
# Via Miraheze API
import requests

s = requests.Session()
s.headers.update({"User-Agent": "Bot/1.0 (ZeroSkills)"})
base = "https://got.miraheze.org/w/api.php"  # or csez.miraheze.org

# Login
r = s.get(base, params={"action":"query","meta":"tokens","type":"login","format":"json"})
tok = r.json()["query"]["tokens"]["logintoken"]
s.post(base, data={"action":"login","lgname":"ZeroSkills","lgpassword":"ForkedT2000","lgtoken":tok,"format":"json"})

# Get CSRF
r = s.get(base, params={"action":"query","meta":"tokens","format":"json"})
csrf = r.json()["query"]["tokens"]["csrftoken"]

# Edit with full template
tpl = "[[Changelog|{v}]]\n\n<noinclude>\nThis is a simple template to change the game version displayed on the main page.\n</noinclude>\n\n[[Category:Templates]]".format(v=build)

s.post(base, data={
    "action": "edit", "title": "Template:Gameversion",
    "text": tpl, "summary": "Restore template format",
    "bot": "true", "token": csrf, "format": "json"
})
```

## Bot Code Pattern

In the bot's manual update functions, always build the full template:

```python
got_tpl = "[[Changelog|{v}]]\n\n<noinclude>\nThis is a simple template to change the game version displayed on the main page.\n</noinclude>\n\n[[Category:Templates]]".format(v=build)
write_wiki_task(build, "Template:Gameversion", got_tpl)
update_got_wiki_version(build)
```

## Prevention

When updating wiki templates via bot, always:
1. Read the current template content first
2. Preserve any non-version content (comments, noinclude, categories)
3. Only replace the version number portion
4. Write back the complete template
