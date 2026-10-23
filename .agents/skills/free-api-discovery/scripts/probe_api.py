#!/usr/bin/env python3
"""
probe_api.py — read-only liveness/pricing-probe for a candidate free API.

Answers, for one endpoint:
  * Does it respond?  What status, latency, content-type?
  * Does it require auth?  (401 / 403 / WWW-Authenticate / ?api_key= in the URL)
  * Does it expose rate-limit headers?  (X-RateLimit-*, RateLimit-*, Retry-After)
  * Is CORS enabled?  (Access-Control-Allow-Origin)
  * Does the body contain a deprecation / error notice despite HTTP 200?
  * What did the provider say about limits?  (headers + a small body preview)

Stdlib only.  Performs a single GET (falling back to HEAD).  Never mutates anything.

Usage:
    python3 probe_api.py "https://api.example.com/v1/thing?x=1"
    python3 probe_api.py --json "https://api.example.com/v1/thing"
    python3 probe_api.py --timeout 15 "https://api.example.com/v1/thing"

Exit codes:
    0  endpoint responded (any status) - inspect the report
    1  usage / argument error
    2  network failure (DNS, TLS, timeout)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request

USER_AGENT = (
    "EternalzBot-ApiProbe/1.0 (+https://github.com/WaquarShaikh5555/Eternalz; "
    "contact via repo issues)"
)

RATE_LIMIT_HEADERS = (
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-used",
    "x-ratelimit-resource",
    "ratelimit-limit",
    "ratelimit-remaining",
    "ratelimit-reset",
    "retry-after",
    "x-rate-limit-limit",
    "x-rate-limit-remaining",
)

# Body markers that mean "this looks like it worked, but it didn't".
SOFT_FAILURE_PATTERNS = [
    (r'"success"\s*:\s*false', 'body contains success:false (soft failure / deprecation)'),
    (r'"error"\s*:\s*["\']?(?:deprecated|deprecation)', 'body indicates deprecation'),
    (r'\bdeprecat(?:ed|ion)\b', 'body mentions deprecation'),
    (r'"data"\s*:\s*null\s*,', 'body has data:null'),
    (r'\bquotaFinished\b', 'body indicates quota exhausted'),
    (r'\brate.?limit(?:ed)?\b', 'body indicates rate limiting'),
    (r'"error"\s*:\s*"[^"]+"', 'body contains an error field'),
]


def soft_failure_markers(body_text: str) -> list[str]:
    hits = []
    lowered = body_text[:4000].lower()
    for pattern, label in SOFT_FAILURE_PATTERNS:
        if re.search(pattern, lowered, re.IGNORECASE):
            hits.append(label)
    return hits


def probe(url: str, timeout: float) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
        },
        method="GET",
    )

    started = time.monotonic()
    status = None
    headers: dict[str, str] = {}
    body_text = ""
    error: str | None = None
    http_error = None

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            headers = {k.lower(): v for k, v in response.headers.items()}
            body_text = response.read(8192).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:  # 4xx / 5xx still carry useful headers
        http_error = exc
        status = exc.code
        headers = {k.lower(): v for k, v in exc.headers.items()}
        try:
            body_text = exc.read(8192).decode("utf-8", errors="replace")
        except Exception:  # pragma: no cover - best effort
            body_text = ""
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

    duration_ms = round((time.monotonic() - started) * 1000, 1)

    rate_limits = {h: headers[h] for h in RATE_LIMIT_HEADERS if h in headers}

    auth_required = None
    if status in (401, 403):
        auth_required = True
    elif status == 200:
        auth_required = False
    if "www-authenticate" in headers:
        auth_required = True

    cors = headers.get("access-control-allow-origin")

    key_in_url = bool(re.search(r"[?&](api_?key|apikey|key|access_?token|token|appid)=", url, re.I))

    return {
        "url": url,
        "status": status,
        "duration_ms": duration_ms,
        "error": error,
        "content_type": headers.get("content-type"),
        "server": headers.get("server"),
        "auth_required": auth_required,
        "auth_signal": headers.get("www-authenticate"),
        "cors_allow_origin": cors,
        "cors_note": "n/a (server-side call ignores CORS)" if cors is None else cors,
        "rate_limit_headers": rate_limits,
        "secret_in_url": key_in_url,
        "soft_failures": soft_failure_markers(body_text),
        "body_preview": body_text[:600].strip(),
        "body_bytes_sampled": len(body_text.encode("utf-8")),
    }


def render(report: dict) -> str:
    lines: list[str] = []
    add = lines.append

    add(f"URL            : {report['url']}")
    if report["error"]:
        add(f"RESULT         : NETWORK FAILURE -> {report['error']}")
        add("                Check DNS/TLS/host reachability from this machine.")
        return "\n".join(lines)

    add(f"STATUS         : {report['status']}  ({report['duration_ms']} ms)")
    add(f"Content-Type   : {report['content_type']}")
    add(f"Auth required  : {report['auth_required']}"
        + (f"   (WWW-Authenticate: {report['auth_signal']})" if report["auth_signal"] else ""))
    add(f"CORS           : {report['cors_note']}")
    if report["secret_in_url"]:
        add("SECRET IN URL  : !! query string looks like it carries a key - "
            "prefer a header, and never paste this URL into a log or a Discord message")

    if report["rate_limit_headers"]:
        add("Rate limits    :")
        for key, value in report["rate_limit_headers"].items():
            add(f"  {key}: {value}")
    else:
        add("Rate limits    : (no rate-limit headers exposed)")

    if report["soft_failures"]:
        add("SOFT FAILURE   : !! HTTP status looks OK but the body signals a problem:")
        for marker in report["soft_failures"]:
            add(f"  - {marker}")
    else:
        add("Soft failure   : none detected in the first 4 kB of the body")

    if report["body_preview"]:
        add("Body preview   :")
        for row in report["body_preview"].splitlines()[:12]:
            add(f"  {row[:160]}")

    add("")
    add("Next steps:")
    add("  1. Confirm pricing, quota and licence on the provider's own pricing + terms pages.")
    add("  2. Record the evidence row (references/verification-checklist.md).")
    add("  3. Integrate with a timeout, bounded retries, caching and a fallback.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe a candidate free API endpoint.")
    parser.add_argument("url", help="Absolute URL to probe")
    parser.add_argument("--timeout", type=float, default=10.0, help="Timeout in seconds (default 10)")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of a text report")
    args = parser.parse_args()

    if not args.url.lower().startswith(("http://", "https://")):
        print("error: URL must start with http:// or https://", file=sys.stderr)
        return 1

    report = probe(args.url, args.timeout)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(render(report))

    if report["error"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
