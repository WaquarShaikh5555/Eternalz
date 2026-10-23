# RSS Feed Generation for Discord Bots

Pattern for writing RSS XML feeds from a Discord bot, serving them via HTTP, and pushing to GitHub.

## Use Case

Don's GoT Patch Monitor bot posts build number updates to Discord. He also wanted an RSS feed so he could subscribe from external tools (phone, Feedly, etc.) without joining the Discord. Additionally, the feed is committed to the `DonZzzilla/taborian` GitHub repo for public access and version history.

## Architecture

```
Bot detects change
  → posts to Discord
  → writes RSS item to local XML
  → git push to GitHub (taborian repo, feed/got_updates.xml)
  → served via HTTP (port 8090, systemd)
```

## RSS File Location

```
/home/donzzz/public_html/got_feed.xml
```

Initialized with a seed item so the file is valid RSS from the start.

## Serving

Systemd service at `~/.config/systemd/user/rss-server.service`:

```ini
[Unit]
Description=RSS Feed Server for GoT Updates
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/donzzz/public_html
ExecStart=/usr/bin/python3 -m http.server 8090
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
```

## Port Selection on Don's Pi

| Port | Service |
|------|---------|
| 80, 443 | cloudflared tunnel |
| 5678 | n8n |
| 8086 | InfluxDB |
| 8088 | (reserved/unknown — was in use during setup) |
| 8090 | RSS feed server (chosen) |

Always check `ss -tlnp` before picking a port.

## Access

- **Local:** `http://<pi-ip>:8090/got_feed.xml`
- **Public:** Configure cloudflared tunnel or nginx reverse proxy to point at port 8090.
- **GitHub:** `https://raw.githubusercontent.com/DonZzzilla/taborian/main/feed/got_updates.xml`

## GitHub Integration

The bot pushes the RSS feed to the `DonZzzilla/taborian` repo on every update.

### Prerequisites

1. **Local clone:** `git clone https://<token>@github.com/DonZzzilla/taborian.git /tmp/taborian`
2. **Git credentials:** Stored in `~/.git-credentials` (format: `https://user:token@github.com`)
3. **Git config:** `git config --global credential.helper store` + user.name/email
4. **Repo must exist:** Create via GitHub API or web UI first. Repo can be private.

### Bot Config Constants

```python
GITHUB_REPO = "/tmp/taborian"              # local clone of DonZzzilla/taborian
GITHUB_FEED_PATH = "feed/got_updates.xml"  # path within repo
```

### git_push_rss() Pattern

Call immediately after `write_rss()` in the main update loop:

```python
def git_push_rss():
    import subprocess as _sp
    try:
        # Pull first to avoid conflicts
        _sp.run(["git", "-C", GITHUB_REPO, "pull", "--rebase"],
                capture_output=True, timeout=30)
        # Copy current RSS file to repo
        import shutil as _sh
        dest = os.path.join(GITHUB_REPO, GITHUB_FEED_PATH)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        _sh.copy2(RSS_FILE, dest)
        # Stage
        _sp.run(["git", "-C", GITHUB_REPO, "add", GITHUB_FEED_PATH],
                capture_output=True, timeout=10)
        # Commit
        r = _sp.run(["git", "-C", GITHUB_REPO, "commit", "-m", "Update GoT feed"],
                    capture_output=True, timeout=10)
        if r.returncode == 0:
            # Push
            p = _sp.run(["git", "-C", GITHUB_REPO, "push"],
                        capture_output=True, timeout=30)
            if p.returncode == 0:
                log("GitHub push OK")
            else:
                log("GitHub push failed: %s" % p.stderr.decode()[:100])
        # If commit rc != 0, probably nothing to commit (no changes) — that's OK
    except Exception as e:
        log("git_push_rss error: %s" % e)
```

### Indentation-Safe Patching

When patching the main loop to add `git_push_rss()`:

```python
# In the main update detection block, after format_update:
msg = format_update(build, link, src)
write_rss(build, src, link)      # write local RSS
git_push_rss()                    # push to GitHub
send_message(token, msg)          # post to Discord
```

**Warning:** Multiple replacement passes can corrupt indentation. Always verify with `python3 -c "import ast; ast.parse(open('bot.py').read())"` after patches. If lines have inconsistent indentation, fix by overwriting the entire `if build != previous:` block rather than doing targeted replacements.

## Date Handling

Python 3.7 (Raspberry Pi OS) doesn't have `time.gmtime().timestamp()`. Use:

```python
import calendar, time
now_t = time.gmtime()
date_str = formatdate(calendar.timegm(now_t))  # Python 3.7 compatible
# NOT: formatdate(now_t.timestamp())  — AttributeError on Python 3.7
```
