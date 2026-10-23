# GitHub Pages CDN Cache Busting — June 2026

## Problem
After pushing updates to a GitHub Pages site via the Contents API, the live `github.io` URL continues serving the old version. The `raw.githubusercontent.com` URL shows the correct new content, but the Pages CDN serves stale bytes for 10-30+ minutes.

## Diagnosis
```python
import requests, base64, urllib.request, json

repo_resp = urllib.request.urlopen(
    "https://api.github.com/repos/OWNER/REPO/contents/docs/index.html")
repo_data = json.loads(repo_resp.read().decode())
repo_content = base64.b64decode(repo_data['content']).decode()

live = requests.get("https://OWNER.github.io/REPO/").text

print(f"Repo: {len(repo_content)} bytes (SHA: {repo_data['sha'][:12]})")
print(f"Live: {len(live)} bytes")
print(f"Match: {repo_content == live}")
```

Check response headers: `Age: 200+` means edge-cached; `Cache-Control: max-age=600` means 10-min TTL.

## Fix: Delete + Recreate File
Most reliable cache-busting technique:

```python
# 1. DELETE old file
s, d = api("GET", ".../contents/docs/index.html", token=token)
sha = d['sha']
api("DELETE", ".../contents/docs/index.html",
    {"message": "delete to break CDN cache", "sha": sha, "branch": "main"}, token=token)

time.sleep(5)

# 2. CREATE fresh (no SHA = new file, bypasses CDN cache)
with open("docs/index.html") as f:
    content = f.read()
enc = base64.b64encode(content.encode()).decode()
api("PUT", ".../contents/docs/index.html",
    {"message": "fresh: complete rebuild", "content": enc, "branch": "main"}, token=token)
```

Wait 30-60 seconds for CDN refresh.

## Fix: Reconfigure Pages Source Path
```python
api("POST", ".../pages",
    {"source": {"branch": "main", "path": "/docs"}}, token=token)
# → 201 with status: "building"
```

**Note:** Pages API returns 404 if token lacks Pages admin permissions. Classic tokens with `repo` scope work; fine-grained tokens may not.

## Prevention
- Avoid rapid successive pushes (triggers aggressive CDN caching)
- After critical updates, consider delete+recreate as cache-busting habit
- Monitor `Age` header to confirm cache refresh
- `urllib.request` is more reliable than `requests` for GitHub API with fine-grained PATs
