---
name: free-api-discovery
description: >-
  Discover, verify, evaluate, integrate, and maintain genuinely free APIs for Discord bots
  and backends. Use when a feature needs external data (weather, country/timezone, currency,
  games, GitHub, datasets, space, dictionary/translation, news/RSS, AI models, crypto,
  images) and the "free" tier, quota, key requirement, or licence must be confirmed before
  coding. Also use when an integrated API starts failing, gets rate-limited, changes
  pricing, or needs a replacement. Triggers: "free API", "public API", "no API key",
  "rate limit", "quota", "API directory", "awesome APIs", "find an alternative to an API",
  "is this API still free", "API pricing".
license: MIT
compatibility: Requires outbound HTTPS to candidate API hosts and the provider's own documentation site. Python 3.9+ standard library only for the bundled probe script.
metadata:
  author: arena-agent
  version: "1.0.0"
  created: "2026-10-23"
  catalog_verified: "2026-10-23"
---

# Free API Discovery & Integration

Find APIs that are **actually free**, prove it from the provider's own documentation,
then integrate them so they cannot take the bot down.

## Non-negotiable rules

Violating any of these invalidates the work. They exist because free-tier APIs
change without notice and a bot that assumes wrong quotas fails in production.

1. **Never call a limited free tier "free".** A 500 req/month tier is a *free tier*,
   not an unlimited free API. Label every API as one of:
   `free-unlimited` / `free-keyless-quota` / `free-tier-key-required` / `trial-only` / `paid`.
2. **Never assume unlimited requests.** Every integration must have a documented quota
   assumption and a budget that fits inside it.
3. **Never assume commercial use is allowed.** Several flagship free APIs are
   non-commercial only. Check the terms page, not just the pricing page.
4. **Never recommend a paid API as free.** If the free tier requires a credit card,
   say so.
5. **Never claim "no limits" without a source.** "No published rate limit" is the
   correct phrase when the provider publishes none — it is not "unlimited".
6. **Prefer keyless APIs when practical**, but a key is better than an unstable
   keyless endpoint. A key is fine as long as it lives in the secret store.
7. **Never scrape a website when an official API exists.** Scraping breaks on
   layout change and may breach the site's terms.
8. **Never bypass access controls** (auth walls, rate limits, paywalls, bot detection).
9. **Never expose a secret.** Keys go in the secret store / `.env` (git-ignored),
   never in source, never in logs, never in a Discord message.
10. **Never ship an API dependency that has no fallback.** If the API can vanish,
    the feature must degrade gracefully rather than throw.

## Workflow

### Step 1 — Frame the need precisely

Write down before searching:

- **Exact data required** (e.g. "lat/lon → current temp + 3-day forecast", not "weather").
- **Fields, units, and update frequency** the feature actually needs.
- **Call volume** = users × calls per user per period. This is the number that
  decides feasibility; a 10,000/day API is fine for 20 guilds and useless for 5,000.
- **Latency budget** and whether a cached/stale answer is acceptable.
- **Licence constraints**: is this bot monetised, or used by a business?
  Non-commercial-only APIs are disqualified for commercial bots.
- **Key tolerance**: keyless preferred, key acceptable, credentialed app only as a last resort.

### Step 2 — Discover candidates

Search order (most authoritative first):

1. **The provider's own docs and pricing page** — the only source of truth.
2. **Curated directories** (see `references/api-catalog.md` → "Directory sources"):
   - `public-apis/public-apis` — largest catalogue, community-maintained.
   - `marcelscruz/public-apis` — maintained fork with extra fields (HTTPS, CORS, auth).
   - `mnfst/awesome-free-llm-apis` — permanently-free LLM endpoints with quotas.
   - `open-free-llm-api/awesome-freellm-apis` — 134+ free LLM providers.
   - `apis.io` — per-provider rate-limit evidence pages.
3. **Provider status pages** for uptime/SLA signals.

Treat every directory entry as a *lead*, never as a fact. Directories go stale.

> Note: `AnandChowdhary/awesome-free-apis` and `lyqht/awesome-free-apis` are **gone**
> (both return HTTP 404 as of 2026-10-23). Do not cite them. Use the directories above.

### Step 3 — Verify pricing, quota, key, and licence

For each candidate, open the provider's own **pricing** and **terms/licence** pages and
fill in the evidence table. See `references/verification-checklist.md` for the field list
and the exact wording to capture. Record the **date** you checked and the **URL**.

The single most important check: **is the free tier non-commercial only?**

### Step 4 — Verify quotas, auth, and rate-limit behaviour

- Does the limit count requests, calls, credits, or weighted units? (Open-Meteo counts
  a multi-variable/multi-location request as *several* calls.)
- Is the limit per minute, hour, day, month, or a rolling window?
- Is it per IP, per key, per account, or per endpoint?
- What is returned when exceeded — `429`, `403`, a `200` with an error body, or a silent
  throttle?
- Are quota and rate limit two different systems? (GitHub: primary hourly quota +
  secondary abuse heuristics. CoinGecko keyless: a separate, much smaller per-IP pool.)

### Step 5 — Review docs, reliability, and integration constraints

- Is there a documented API reference with request/response examples?
- Is HTTPS enforced? Is **CORS** enabled (matters if a dashboard calls it from a browser —
  and matters *not* if the bot calls it server-side, which is the normal case)?
- Does the provider require a **contactable `User-Agent`**? Wikimedia, mcsrvstat.us,
  and OpenStreetMap do; omitting it gets you `403`.
- Is the data self-hostable? (Open-Meteo, Frankfurter, Open Trivia are open source —
  self-hosting removes quota risk entirely.)
- Operational status page, historical uptime, and a changelog.

### Step 6 — Integrate defensively

Apply `references/integration-patterns.md` — mandatory: timeout on every request,
bounded retries with exponential backoff and jitter, respect `Retry-After` and
`X-RateLimit-*`, cache aggressively, degrade gracefully, and never let a third-party
outage break a command.

### Step 7 — Monitor, re-verify, and prepare fallbacks

- Record the verification date in the code comment and in a tracking table.
- Re-verify pricing/terms on a **quarterly** cadence and whenever an API starts
  erroring (a sudden `401`/`402`/`403` often means the tier changed).
- Implement the **fallback chain** decided in Step 3 (primary → secondary → cached last-known-good → "unavailable").
- Use `scripts/probe_api.py` to check auth requirement, CORS, and rate-limit headers live.

## Evidence table (use this for every API you adopt)

Record one row per API. Copy this into the PR description or the service's README.

| Field | Meaning |
|---|---|
| API | Provider name |
| Endpoint | Base URL + the exact path used |
| Purpose | Which bot feature uses it |
| Tier | `free-unlimited` / `free-keyless-quota` / `free-tier-key-required` / `trial-only` / `paid` |
| Key required | yes / no (+ where the key is stored) |
| Quota | Exact published numbers, or "none published" |
| Rate limit | Per-minute/hour/day/month, and what the scope is (IP/key/account) |
| Over-limit behaviour | `429` / `403` / `200`+error body / throttle |
| Commercial use | allowed / non-commercial only / unknown → **link the terms page** |
| Attribution | Required text/link, if any |
| CORS | yes / no / n-a (server-side) |
| User-Agent required | yes / no |
| Self-hostable | yes (link) / no |
| Fallback | Secondary API or cached-value behaviour |
| Verified on | Date + URL of the pricing/terms page |
| Re-verify by | Date |

## Failure modes seen in the wild

- **`200 OK` that means "no".** REST Countries' legacy `restcountries.com/v3.1`
  endpoints now return HTTP 200 with `{"success":false,"data":null}` and a deprecation
  notice. A client that only checks the status code silently stores garbage.
  **Always validate the body shape, not just the status.**
- **A free tier that quietly became key-required.** `exchangerate.host` used to be
  keyless; it is now an APILayer product whose free plan is 100 requests/month with a
  key. Old tutorials are still online.
- **A keyless tier that is explicitly not for production.** CoinGecko's keyless API
  shares an IP-based pool of roughly 10–30 calls/min and is documented as unsuitable
  for scheduled polling. Use the free Demo key (10,000/month) instead.
- **"Unlimited" that is really a fair-use cap.** Many free APIs publish no number but
  enforce one anyway. Assume a low ceiling and cache accordingly.
- **A quota counted in the wrong unit.** Exchange-rate and translation APIs often
  count *words* or *characters*, not requests.
- **A required `User-Agent` that looks like a bug.** Missing UA → `403`, which reads
  as "forbidden" rather than "you forgot a header".
- **Attribution silently required.** Open-Meteo (CC-BY 4.0), CoinGecko Demo, and
  ExchangeRate-API all require attribution. Missing it is a licence violation.

## Bundled references

- `references/api-catalog.md` — verified free-API catalogue by bot-feature domain, with
  quotas, auth, licence, and known alternatives, plus the maintained directory list.
- `references/verification-checklist.md` — the step-by-step pricing/licence verification
  procedure and the wording to capture as evidence.
- `references/integration-patterns.md` — production integration code: timeout, retry with
  backoff, `Retry-After`/`X-RateLimit` handling, caching, circuit breaking, fallbacks,
  and secret hygiene.
- `scripts/probe_api.py` — live probe: detects auth requirement, CORS, rate-limit headers,
  and returns status/body summary for an endpoint. Read-only; safe to run.
