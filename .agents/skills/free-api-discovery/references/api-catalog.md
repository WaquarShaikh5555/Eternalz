# Verified Free API Catalog

**Verification date: 2026-10-23.** Every row was checked against the provider's own
pricing/terms documentation on that date. Quotas change — re-verify before relying on a
number that matters, and record the date in your code.

Legend for **Tier**:
- `free-unlimited` — no published cap (fair use may still apply)
- `free-keyless-quota` — no key, published quota
- `free-tier-key-required` — free tier exists but needs a free key
- `trial-only` — time-limited credit, not a durable free tier

---

## 1. Weather & forecasts

| API | Endpoint | Tier | Key | Quota | Commercial | Attribution | Notes |
|---|---|---|---|---|---|---|---|
| **Open-Meteo** | `api.open-meteo.com/v1` | `free-keyless-quota` | No | 600/min · 5,000/hr · 10,000/day · 300,000/mo | **Non-commercial only** | **Required** (CC-BY 4.0) | No uptime guarantee. Covers forecast, archive, air quality, marine, geocoding, elevation. Multi-variable + multi-location requests count as **several** calls. Open source (AGPL) → self-host for unlimited. |
| **Open-Meteo Geocoding** | `api.open-meteo.com/v1/search` | same as above | No | same | same | same | City → lat/lon/elevation/timezone. Use for "weather in <city>" without a geocoder. |
| **Open-Meteo Air Quality** | `api.open-meteo.com/v1/air-quality` | same | No | same | same | same | PM2.5, pollen, UV. |
| **OpenWeather** | `api.openweathermap.org` | `free-tier-key-required` | Yes | 1,000 calls/day on the free tier (current + forecast) | Free tier carries no commercial restriction | Attribution required | A documented alternative when commercial use is required. **Re-read its current terms — the free tier's commercial status has changed before.** |

**Verdict for a bot:** Open-Meteo is the default for community/hobby bots. If the bot
monetises anything, either move to a commercial plan or self-host Open-Meteo.
Cache forecasts per city for 10–30 minutes — a weather command is never worth a live call
per invocation.

**Alternative chain:** Open-Meteo → self-hosted Open-Meteo → cached last-known-good →
"weather unavailable".

---

## 2. Country, region & time-zone information

| API | Endpoint | Tier | Key | Quota | Commercial | Notes |
|---|---|---|---|---|---|---|
| **countries.dev** | `countries.dev/api/v3/...` | `free-unlimited` | No | No rate limit, no signup | Not stated as non-commercial | ISO codes, flags, currencies, languages, calling codes, capitals + 34,000 cities. **Best current keyless replacement for REST Countries.** Data from GeoNames (CC-BY 4.0). |
| **REST Countries (legacy)** | `restcountries.com/v3.1` | ⚠️ **DEPRECATED** | Was no | — | — | **Returns HTTP 200 with `{"success":false}` + a deprecation notice.** Not a working API. Do not build on it. |
| **REST Countries (current)** | `api.restcountries.com` | `free-tier-key-required` | Yes (Bearer) | Free tier 500 requests/month | Paid tiers exist above it | The service relaunched as a keyed, tiered product in 2026. |
| **World Bank Open Data** | `api.worldbank.org/v2` | `free-unlimited` | No | No published hard limit; starts failing ~1,000 req/min per IP | CC-BY 4.0 | 300+ indicators (GDP, population, poverty, literacy) for 200+ countries. `?format=json` is required. |
| **Nominatim (OSM)** | `nominatim.openstreetmap.org` | `free-keyless-quota` | No | 1 req/s absolute; max 1 request per second, bulk use prohibited | ODbL data | **Contactable `User-Agent` is mandatory** or you get `403`. Explicitly disallows heavy/bulk use. |
| **TimeAPI.io** | `timeapi.io/api/TimeZone/...` | `free-keyless-quota` | No | Fair use | — | Time-zone by coordinates or city. |
| **WorldTimeAPI** | `worldtimeapi.org/api/timezone/...` | `free-keyless-quota` | No | Fair use | — | Current time + DST per IANA zone. Availability has been intermittent historically — always cache and fall back to the server's own ICU/`Intl` time-zone support (`Intl.DateTimeFormat` with `timeZone` needs no API at all). |

**Best no-network alternative for time zones:** `Intl.DateTimeFormat` / `zoneinfo` on the
host. If the only requirement is "what time is it in <IANA zone>", an API call is wasteful —
use the platform.

---

## 3. Currency & exchange rates

| API | Endpoint | Tier | Key | Quota | Commercial | Notes |
|---|---|---|---|---|---|---|
| **Frankfurter** | `api.frankfurter.dev` | `free-unlimited` | No | **No quotas**; rate-limited only to prevent abuse | **Yes, commercial OK** | ECB reference rates, updated once per business day (~16:00 CET). v2 spans ~166–201 currencies with history back to 1948. No intraday, no weekend data. Open source → self-hostable via Docker. **Default choice.** |
| **ExchangeRate-API (open access)** | `open.er-api.com` | `free-keyless-quota` | No | Fair use; `429` when exceeded, clears in ~20 min | Allowed with attribution | Once-daily blended rates, ~160+ currencies. **Attribution text + link required; redistribution prohibited.** |
| **exchangerate.host** | `api.exchangerate.host` | ⚠️ **CHANGED** | **Yes (APILayer)** | Free plan 100 requests/month | Paid from $14.99/mo | **No longer keyless.** Frequently cited in old tutorials as free-with-no-key. |
| **Open Exchange Rates** | `openexchangerates.org` | `free-tier-key-required` | Yes | 1,000 requests/month | Paid tiers | Free tier: USD base only, no time-series. |
| **ExchangeRate-API (keyed)** | `v6.exchangerate-api.com` | `free-tier-key-required` | Yes | 1,500 requests/month | Credit card for upgrades | ~161 currencies, daily. |

**Verdict:** Frankfurter for anything that only needs a daily reference rate. It is
keyless, has no quota, and explicitly permits commercial use — the safest default by a
wide margin.

---

## 4. Games, gaming statistics & Minecraft server status

| API | Endpoint | Tier | Key | Quota | Notes |
|---|---|---|---|---|---|
| **mcsrvstat.us** | `api.mcsrvstat.us/3/<host>` | `free-keyless-quota` | No | Fair use; **responses cached 5 minutes** server-side | **A descriptive `User-Agent` is mandatory** — otherwise `403`. `api.mcsrvstat.us/simple/<host>` returns `200`/`404` for an uptime check. Supports Java, Bedrock, SRV records, and `enable-query`. |
| **mcstatus.io** | `api.mcstatus.io/v2/status/java/<host>` | `free-tier-key-required` | Yes (dashboard token) | 5 requests/second per client IP | Full API needs a dashboard token (free). Historical player counts + uptime history only with an account. |
| **Minecraft ServerHub** | `minecraft-serverhub.com/api/...` | `free-keyless-quota` | No | Badge endpoint CDN-cached 2 min | Also serves ready-made **SVG status badges** — useful for Discord embed images. |
| **Open Trivia DB** | `opentdb.com/api.php` | `free-unlimited` | No | No published limit | Trivia questions for `/trivia` commands. No key needed for standard use. |
| **Jikan (MyAnimeList)** | `api.jikan.moe/v4` | `free-keyless-quota` | No | 3 requests/second, 60 requests/minute | Anime/manga metadata. |
| **RAWG** | `api.rawg.io/api/games` | `free-tier-key-required` | Yes | 20,000 requests/day (free key) | Game catalogue, screenshots, ratings. |
| **IGDB (Twitch)** | `api.igdb.com` | `free-tier-key-required` | Yes | ~40 requests/sec with Twitch token | Richer game data; Twitch OAuth required. |
| **Steam Web API** | `api.steampowered.com` | `free-keyless-quota` | No (Steam Web API key optional for some) | 200,000 requests/day per IP | Store, player counts, app details. |
| **Chess.com** | `api.chess.com/pub/player/...` | `free-keyless-quota` | No | ~10 req/s per IP, occasional `429` | Live player stats. Requires a contactable `User-Agent`. |

**Verdict:** For a Minecraft-status command use **mcsrvstat.us** (keyless, User-Agent
only) and cache for ≥60 s — the upstream cache is 5 minutes anyway. For game metadata
use **RAWG** free key or **IGDB**.

---

## 5. GitHub repositories, releases & activity

| API | Endpoint | Tier | Key | Quota |
|---|---|---|---|---|
| **GitHub REST API** | `api.github.com` | `free-unlimited` (anonymous) / `free-tier-key-required` (token) | Optional but strongly recommended | **Unauthenticated: 60 requests/hour per source IP.** Authenticated (PAT / OAuth / GitHub App): **5,000 requests/hour per token.** `GITHUB_TOKEN` inside Actions: **1,000/hour per repository** (15,000 for Enterprise Cloud). Secondary limits: ≤900 points/min for REST, ≤100 concurrent requests. |

**Operational notes**
- The `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset` headers on
  every response are authoritative — read them instead of guessing.
- Secondary (abuse) limits are heuristic: bursts, concurrency, and repeated identical
  requests can trigger a `429` even with quota left. Space requests out, use
  `If-None-Match` conditional requests, and never tight-poll.
- `GET /rate_limit` gives a per-resource overview.
- A `403` with `x-ratelimit-remaining: 0` means quota exhaustion, not a permissions problem.

**Verdict:** Use a fine-grained PAT with read-only scope, stored in the secret store, and
cache aggressively. Anonymous 60/hr is fine for a one-off command but not for a scheduled
job.

---

## 6. Public datasets & trivia

| API | Endpoint | Tier | Key | Quota | Notes |
|---|---|---|---|---|---|
| **Open Library** | `openlibrary.org` | `free-unlimited` | No | Fair use | Book metadata, covers, author pages. Data dumps available. |
| **Wikipedia / Wikimedia REST + Action API** | `en.wikipedia.org/w/api.php`, `api.wikimedia.org` | `free-keyless-quota` | Optional token | Action API **anonymous: 500 requests/hour per IP**; with a personal token **5,000/hour**; OAuth 5,000/hour. REST API soft ceiling ~200 req/s. Wikidata Query Service: 60 s per query, 5 concurrent queries per IP. | **A contactable `User-Agent` is mandatory** — e.g. `MyBot/1.0 (contact: email)`. Generic or missing UA may be blocked without warning. Follow `maxlag` etiquette and exponential backoff on the `ratelimited` error code. Content licences (CC BY-SA / CC0) must be respected when republishing. |
| **Wikidata** | `www.wikidata.org/w/api.php`, `query.wikidata.org` | `free-keyless-quota` | Optional | Same Wikimedia platform limits | Structured facts — perfect for trivia/lookup commands. |
| **Open Trivia DB** | `opentdb.com/api.php` | `free-unlimited` | No | No published limit | Multiple categories & difficulty levels. |
| **Dad Joke API** | `icanhazdadjoke.com` | `free-keyless-quota` | No | Fair use | Header `Accept: application/json` required. |
| **Cat Facts** | `catfact.ninja` | `free-keyless-quota` | No | Fair use | |
| **Dog API** | `dog.ceo/api/breeds/image/random` | `free-keyless-quota` | No | Fair use | |

---

## 7. Space, astronomy & science

| API | Endpoint | Tier | Key | Quota | Notes |
|---|---|---|---|---|---|
| **NASA Open APIs** | `api.nasa.gov/...` | `free-tier-key-required` | Yes (free signup) | **1,000 requests/hour per key** across all NASA APIs. `DEMO_KEY`: **30 requests/hour per IP and 50 requests/day per IP**. | APOD, Mars photos, NEO, Earth, exoplanets. Read `X-RateLimit-Limit` / `X-RateLimit-Remaining` on every response. **`DEMO_KEY` is for exploration only — get a real key before building a feature on it.** |
| **NASA Open Data (S3)** | `data.nasa.gov` / public S3 | `free-unlimited` | No | Fair use | Bulk datasets without touching the rate-limited API. |
| **ISS Location** | `api.wheretheiss.at/v1/satellites/25544` | `free-keyless-quota` | No | Fair use | Live position. |
| **SpaceX API** | `api.spacexdata.com/v4/...` | `free-unlimited` | No | Fair use | Launches, rockets, history. |

---

## 8. Dictionary, translation & language

| API | Endpoint | Tier | Key | Quota | Notes |
|---|---|---|---|---|---|
| **Free Dictionary API** | `api.dictionaryapi.dev/api/v2/entries/en/<word>` | `free-unlimited` | No | No published limit; reports `X-RateLimit-*` headers | Definitions, phonetics, audio, synonyms. Single-maintainer project — **has returned 404/403/522/timeouts intermittently**. Always implement a fallback. |
| **Wiktionary REST** | `en.wiktionary.org/api/rest_v1/page/definition/<word>` | `free-keyless-quota` | No | Wikimedia platform limits | **The reliable fallback for Free Dictionary.** Contactable `User-Agent` required. Definitions only, no pronunciation. |
| **MyMemory Translation** | `api.mymemory.translated.net/get` | `free-keyless-quota` | No (email optional) | **5,000 characters/day per IP** anonymous; **50,000 characters/day** when `de=<email>` is supplied; 150,000/day with a key | Counts **characters**, not requests. `q` is limited to ~500 bytes. Free tier returns `quotaFinished: true` when exhausted. Not for high-volume translation. |
| **LibreTranslate** | `libretranslate.com/translate` | `free-tier-key-required` | Yes (free key) | 50,000 characters/month (free key) | Self-hostable. |

---

## 9. News & RSS feeds

| Source | Endpoint | Tier | Key | Notes |
|---|---|---|---|---|
| **Hacker News (Firebase)** | `hacker-news.firebaseio.com/v0/...` | `free-unlimited` | No | Official public API. No published limit; be polite. |
| **GDELT** | `api.gdeltproject.org/api/v2/doc/doc` | `free-unlimited` | No | Global news index, no key, JSON/CSV. Excellent for `/news` commands. |
| **Reddit (public JSON)** | `reddit.com/r/<sub>/.json` | `free-keyless-quota` | No | Unauthenticated is heavily throttled and requires a descriptive `User-Agent`; use the official OAuth API for anything real. **Respect Reddit's User-Agent policy and rate rules.** |
| **RSS feeds directly** | publisher-provided | `free-unlimited` | Usually no | Only consume feeds the publisher offers publicly. Respect `robots.txt`/ToS; prefer official feeds over scraping. |
| **blogwatcher-cli** | see `blogwatcher` skill | local tool | — | Follows RSS/Atom + OPML locally; optional tool in the installed skill. |

---

## 10. AI models with genuinely free quotas

| Provider | Endpoint | Tier | Key | Notes |
|---|---|---|---|---|
| **Google Gemini API** | `generativelanguage.googleapis.com` | `free-tier-key-required` | Yes | Generous free tier (per-minute and per-day token limits). Rate limits are per-model and per-project. **Verify the current quota in the Google AI Studio console before shipping.** |
| **Groq** | `api.groq.com/openai/v1` | `free-tier-key-required` | Yes | Free developer tier with published requests-per-minute per model. OpenAI-compatible. |
| **OpenRouter** | `openrouter.ai/api/v1` | `free-tier-key-required` | Yes | Several `:free` model variants; free request caps per day. Free models are rate-limited and can be temporarily unavailable — always implement a fallback model. |
| **Hugging Face Inference** | `api-inference.huggingface.co` | `free-tier-key-required` | Yes | Free tier with small monthly credit. |

**Discovery:** `mnfst/awesome-free-llm-apis` (CC0) and
`open-free-llm-api/awesome-freellm-apis` (MIT) both track permanently-free LLM endpoints
with their quotas. They are **leads only** — verify each provider's own pricing page.

**Bot-specific warning:** LLM calls are the most likely source of surprise bills. Hard-cap
the token budget per request, cap per-user usage, cache identical prompts, and always set
an explicit timeout. Never let an LLM failure break the command that triggered it.

---

## 11. Cryptocurrency & market data

| API | Endpoint | Tier | Key | Quota | Notes |
|---|---|---|---|---|---|
| **CoinGecko — keyless public API** | `api.coingecko.com/api/v3/...` | `free-keyless-quota` | No | Shared **IP-based pool, roughly 10–30 calls/min** | Documented as **not suitable for production workloads, scheduled polling, or high-frequency updates.** Prototype only. |
| **CoinGecko — Demo plan** | `api.coingecko.com/api/v3/...` | `free-tier-key-required` | Yes (free) | **10,000 call credits/month, 100 calls/min**, 1 year of daily history | **Attribution required** (also on paid tiers). Use this, not the keyless tier, for a real bot. |
| **Coinpaprika** | `api.coinpaprika.com/v1/...` | `free-keyless-quota` | No | ~1,000 requests/day | Keyless ticker data. |
| **CoinCap** | `api.coincap.io/v2/...` | `free-keyless-quota` | No | Fair use | Lightweight prices. |
| **CoinMarketCap** | `pro-api.coinmarketcap.com` | `free-tier-key-required` | Yes | Basic: 15,000 credits/month, 50 calls/min | Attribution on free tier. |
| **DexScreener** | `api.dexscreener.com` | `free-keyless-quota` | No | ~60 calls/min | DEX pairs, liquidity, price. |

**Market-data warning:** crypto prices move continuously; a cached quote must carry its
timestamp in the embed, and never present a cached price as live.

---

## 12. Image utilities & community features

| API | Endpoint | Tier | Key | Notes |
|---|---|---|---|---|---|
| **Picsum Photos** | `picsum.photos/{id}/{w}/{h}` | `free-unlimited` | No | Deterministic random images by seed — ideal for stable avatar/placeholder art. |
| **DiceBear** | `api.dicebear.com/9.x/{style}/svg?seed=...` | `free-unlimited` | No | Deterministic avatar generation by seed; SVG. |
| **placehold.co** | `placehold.co/{w}x{h}` | `free-unlimited` | No | Placeholder text images. |
| **Robohash** | `robohash.org/{seed}.png` | `free-unlimited` | No | Deterministic identicon avatars. |
| **Unsplash (official)** | `api.unsplash.com` | `free-tier-key-required` | Yes | 50 requests/hour for unauthenticated demo; API access requires a key and a hotlinked-image attribution workflow. **Do not hotlink scraped images.** |
| **Openverse** | `api.openverse.org/v1/images/` | `free-keyless-quota` | Optional | 200+ million CC-licensed images and audio; anonymous rate limits apply, a key raises them. **Always surface the licence and creator.** |

**Legal note:** serving random images is not the same as scraping them. Use providers
whose terms explicitly permit programmatic use, and always credit/attribute.

---

## 13. Discord's own API (for reference)

| Resource | Limit |
|---|---|
| Global rate limit | **50 requests per second** per bot |
| Per-route buckets | 5–120+ per route; every response carries `X-RateLimit-*` headers |
| 429 handling | `Retry-After` header (seconds) — respect it exactly |
| Interaction deadline | **3 seconds** to acknowledge an interaction |
| Command registration | Global commands can take up to 1 hour to propagate; guild commands are near-instant |

See the `discord-bot-architect` skill for the full gateway/limiting model.

---

## Directory sources (maintained)

| Directory | Repo | Stars | Last push (2026-10-23) | License |
|---|---|---|---|---|
| Public APIs | `public-apis/public-apis` | ~491k | 2026-10-21 | MIT |
| Public APIs (maintained fork) | `marcelscruz/public-apis` | ~9.6k | 2026-10-22 | MIT |
| Free LLM APIs | `mnfst/awesome-free-llm-apis` | ~11k | 2026-10-23 | CC0-1.0 |
| Free LLM APIs | `open-free-llm-api/awesome-freellm-apis` | ~4.6k | 2026-10-23 | MIT |
| Free LLM APIs | `amardeeplakshkar/awesome-free-llm-apis` | ~201 | 2026-10-01 | CC0-1.0 |
| Per-provider rate-limit evidence | `apis.io` (web) | — | — | — |

**Dead references (do not cite):** `AnandChowdhary/awesome-free-apis` → HTTP 404.
`lyqht/awesome-free-apis` → HTTP 404.

---

## Re-verification schedule

| API | Re-check pricing/terms | Re-check quota numbers |
|---|---|---|
| Open-Meteo | Every 3 months | Every 3 months |
| Frankfurter | Every 6 months | Every 6 months |
| REST Countries / countries.dev | **Every month** (actively changing) | Every month |
| CoinGecko | Every 3 months | Every 3 months |
| GitHub | Every 6 months | Every 6 months |
| NASA | Every 6 months | Every 6 months |
| MyMemory | Every 3 months | Every 3 months |
| Wikimedia | Every 6 months | Every 6 months |
| mcsrvstat.us / mcstatus.io | Every 3 months | Every 3 months |
| All LLM providers | **Every month** (quotas shift fast) | Every month |

Trigger an out-of-cycle re-check whenever a provider starts returning `401`, `402`, or
`403` — that trio almost always means the tier or key policy changed.
