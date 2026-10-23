# Status Dashboard Pattern (June 2026)

## Template Pattern (NOT f-strings)

Python 3.11 f-strings cannot contain backslashes inside expression parts.

```python
# BAD — SyntaxError
html = f'<td style="color:{sc};font-weight:bold;">{status}'

# GOOD — use string template with .replace()
TEMPLATE = '<td style="color:__COLOR__;font-weight:bold;">__STATUS__'
html = TEMPLATE.replace("__COLOR__", sc).replace("__STATUS__", status)
```

## write_file Silent Failure

The `write_file` Hermes tool silently writes 0 bytes on certain content.
Always verify with `os.path.getsize()` after writing.
Use `execute_code` with Python `open().write()` as workaround.

## systemd User Service for Dashboard

```ini
[Unit]
Description=Status Dashboard
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /path/to/server.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

## Data Sources for Dashboards

| Source | Method |
|--------|--------|
| Service status | `systemctl --user is-active svc` |
| Service uptime | `systemctl --user show svc --property=ActiveEnterTimestamp --value` |
| Cron jobs | `hermes cron list --json` |
| Bot state | Read `bot_state.json`, `last_build.txt` directly |
| Log tails | `read_file(path, lines=N)` |

## Remote Access Options

| Method | Setup | Auth |
|--------|-------|------|
| Cloudflare Tunnel + Access | Add hostname in Zero Trust dashboard → `localhost:PORT` | GitHub OAuth via Cloudflare Access |
| ngrok | `ngrok http PORT` | Basic auth or OAuth via ngrok dashboard |
| Direct IP | Open port on router | HTTP basic auth in server code |

**Recommended:** Cloudflare Tunnel (already running on Don's Pi). Add a public hostname pointing to `http://localhost:9120` in the Cloudflare Zero Trust dashboard. Then add Cloudflare Access policy with GitHub OAuth for login protection.

**For no-auth public access** (dashboard shows only build numbers, no secrets): just expose via Cloudflare Tunnel without Access policy.
