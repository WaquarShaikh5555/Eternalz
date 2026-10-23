# GitHub Portfolio Site Creation — Worked Pattern

## Session: May 30, 2026

Created DonZzzilla/portfolio — cyberpunk single-page portfolio with WebGL shaders, particle systems, interactive elements.

## What Was Done

1. Created repo via POST /user/repos from execute_code + urllib
2. Built site as single index.html (zero deps, vanilla JS + Canvas)
3. Pushed via execute_code subprocess (token-embedded URL)
4. Enabled Pages via POST /repos/OWNER/REPO/pages

## Token in Git Remote URL

GitHub rejects user:token@github.com from terminal tool shell, but it works via execute_code subprocess.run(). Different escaping.

WORKS (from execute_code):
  subprocess.run(["git", "remote", "set-url", "origin", f"https://{user_token}@github.com/{user}/{repo}.git"])
  subprocess.run(["git", "push", "-u", "origin", "main"])

FAILS (from terminal tool):
  git remote set-url origin https://user:token@github.com/...
  -> "Invalid username or password"

## Pages Enable

data = json.dumps({"source": {"branch": "main", "path": "/"}}).encode()
POST https://api.github.com/repos/OWNER/REPO/pages
-> result["html_url"] = "https://owner.github.io/repo/"
-> status: None or "building" (check back in 1-2 min)

## Site Architecture (Single-File)

Hero: Canvas particle system (120 particles, mouse attraction, connection lines, hex grid wave shader)
About: CSS 3D rotating hologram rings with pulse animation
Projects: 6 cards with 3D perspective tilt on mousemove (vanilla JS)
Skills: Animated sine wave canvas background, counter animations with easeOutCubic
Contact: Glow-border buttons with hover effects
Easter egg: Konami code triggers hue-rotate filter

All animations: requestAnimationFrame. Zero frameworks.

## Files Created

portfolio/index.html (full site, ~31KB)
portfolio/README.md
portfolio/.gitignore
portfolio/.github/workflows/pages.yml
