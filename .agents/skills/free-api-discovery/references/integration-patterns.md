# Integration Patterns for Free / Third-Party APIs

Reference implementation. Node.js (discord.js) unless stated; the Python equivalent is
identical in shape. Use the `discord-bot-architect` skill for the bot-side plumbing
(interaction deadlines, error handling) and this file for the HTTP side.

---

## 1. The client wrapper

One module per provider. Every outbound HTTP call in the bot goes through it — no
scattered `fetch()` calls.

```js
// src/lib/http.js
const DEFAULT_TIMEOUT_MS = 8000;

export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/**
 * Fetch JSON with a hard timeout.
 * AbortController guarantees we never hang past the deadline.
 */
export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  // Honour an outer signal (e.g. the interaction deadline) too.
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });

    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    if (!res.ok) {
      const err = new HttpError(res.status, body, url);
      err.retryAfter = Number(res.headers.get('retry-after')) || null;
      err.rateLimit = {
        limit: res.headers.get('x-ratelimit-limit'),
        remaining: res.headers.get('x-ratelimit-remaining'),
        reset: res.headers.get('x-ratelimit-reset'),
      };
      throw err;
    }
    return { body, headers: res.headers, status: res.status };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onOuterAbort);
  }
}
```

**Every request needs a `User-Agent`.** For Wikimedia, mcsrvstat.us, Nominatim and
Reddit, a missing or generic UA is a `403`.

```js
const USER_AGENT = 'EternalzBot/1.0 (+https://github.com/WaquarShaikh5555/Eternalz)';
```

---

## 2. Retry with exponential backoff + jitter

Retry only on **transient** failures. Never retry `4xx` other than `429`/`408`.

```js
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function withRetry(fn, { attempts = 3, baseMs = 400, maxMs = 8000, signal } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(signal);
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : null;
      const retryable = status === null ? isNetworkError(err) : RETRYABLE.has(status);
      if (!retryable || i === attempts - 1) throw err;

      // Server-supplied wait wins over our own backoff.
      const waitMs = err.retryAfter
        ? err.retryAfter * 1000
        : Math.min(maxMs, baseMs * 2 ** i) * (0.5 + Math.random()); // full jitter

      await sleep(waitMs, signal);
    }
  }
  throw lastErr;
}

function isNetworkError(err) {
  return err?.name === 'AbortError' ? false : /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err?.message ?? '');
}

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
});
```

**Retry budget:** at most 3 attempts, total added latency ≤ ~5 s. Discord interactions
expire in 3 s — a long retry chain inside a command is a bug, not resilience. Prefer
`deferReply()` + background work for slow providers.

---

## 3. Caching with TTL + stale fallback

Most "free" API features are read-mostly. Cache aggressively.

```js
// src/lib/cache.js
const store = new Map(); // key -> { value, expiresAt, staleUntil, storedAt }

export function cacheGet(key, { allowStale = false } = {}) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() < hit.expiresAt) return hit.value;
  if (allowStale && Date.now() < hit.staleUntil) return hit.value;
  return undefined;
}

export function cacheSet(key, value, { ttlMs, staleMs = 0 }) {
  const now = Date.now();
  store.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + ttlMs + staleMs, storedAt: now });
  return value;
}

/** Single-flight: concurrent misses share one upstream request. */
export async function cached(key, ttlMs, producer, { staleMs = 0 } = {}) {
  const fresh = cacheGet(key);
  if (fresh !== undefined) return fresh;

  if (!store.has(key)) {
    store.set(key, { pending: true, expiresAt: 0, staleUntil: 0 });
    try {
      const value = await producer();
      cacheSet(key, value, { ttlMs, staleMs });
      return value;
    } catch (err) {
      store.delete(key);
      throw err;
    }
  }

  // Another caller is already fetching — wait briefly, then use stale.
  const stale = cacheGet(key, { allowStale: true });
  if (stale !== undefined) return stale;
  await sleep(150);
  return cacheGet(key, { allowStale: true });
}
```

**TTL guidance**

| Data | TTL |
|---|---|
| Weather forecast | 10–30 min |
| Exchange rate (daily source) | 6–12 h |
| Country/capital metadata | 30 days |
| Currency list / supported codes | 7 days |
| Trivia question | 1 h (or per-user, not shared) |
| GitHub repo stats | 15–60 min |
| Minecraft server status | 60 s (upstream caches 5 min) |
| Crypto price | 60 s — **and always show the timestamp** |
| LLM response | keyed by prompt hash, 1 h+ |

---

## 4. Circuit breaker

Stop hammering a provider that is already failing. This is what keeps a dead API from
burning your quota and your command latency.

```js
export class CircuitBreaker {
  constructor({ threshold = 5, cooldownMs = 60_000 } = {}) {
    this.failures = 0;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.openedAt = 0;
  }
  get isOpen() {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.failures = 0;               // half-open: allow one probe
      return false;
    }
    return true;
  }
  recordSuccess() { this.failures = 0; }
  recordFailure() { this.failures++; this.openedAt = Date.now(); }
}
```

When the breaker is open, serve the **stale cached value** or a graceful message —
never a raw error.

---

## 5. Fallback chain

Decide the chain **before** coding, and implement it explicitly.

```js
// Primary → secondary → cached last-known-good → graceful degradation
export async function getForecast(place) {
  const key = `forecast:${place}`;
  const cachedVal = cacheGet(key, { allowStale: true });

  if (openMeteoBreaker.isOpen) {
    if (cachedVal !== undefined) return { ...cachedVal, stale: true };
    throw new ServiceUnavailable('Weather service is temporarily unavailable.');
  }

  try {
    const value = await withRetry(() => fetchOpenMeteo(place));
    openMeteoBreaker.recordSuccess();
    cacheSet(key, value, { ttlMs: 15 * 60_000, staleMs: 6 * 60 * 60_000 });
    return value;
  } catch (err) {
    openMeteoBreaker.recordFailure();
    if (cachedVal !== undefined) return { ...cachedVal, stale: true };
    throw new ServiceUnavailable('Weather service is temporarily unavailable.');
  }
}
```

**User-facing behaviour for degraded data:** say so explicitly. `"Weather data may be
up to 3 hours old (provider outage)"` is honest; silently showing old data is not.

---

## 6. Validate the response body, not just the status

The REST Countries failure mode — `HTTP 200` with `{"success": false}` — is exactly what
schema validation prevents.

```js
export function assertShape(body, checks, label) {
  if (!body || typeof body !== 'object') {
    throw new ApiShapeError(`${label}: expected an object, got ${typeof body}`);
  }
  for (const [path, type] of Object.entries(checks)) {
    const value = path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), body);
    if (typeof value !== type) {
      throw new ApiShapeError(`${label}: expected ${path} to be ${type}, got ${typeof value}`);
    }
  }
  return body;
}

// Usage
assertShape(body, { 'daily.time': 'object' }, 'open-meteo');
```

When a provider adds fields, this still passes. When they remove or rename one, it fails
loudly instead of writing `undefined` into your database.

---

## 7. Quota budgeting

Track your own consumption so you learn about a quota problem *before* the provider
does.

```js
export class QuotaMeter {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.hits = []; }
  record() {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    this.hits.push(now);
  }
  get used() { return this.hits.length; }
  get remaining() { return Math.max(0, this.limit - this.used); }
  get pressure() { return this.remaining / this.limit; } // 0..1
}

// Per provider, sized from the documented quota.
const openMeteo = new QuotaMeter(9_000, 24 * 60 * 60_000); // stay under the 10k/day cap

if (openMeteo.pressure < 0.1) {
  // Serve stale cache only; stop calling upstream.
}
```

---

## 8. Secret hygiene

- Keys live in the secret store / git-ignored `.env`. **Never** in source, config JSON
  committed to git, logs, error messages, Discord messages, or `console.log`.
- Read them through one helper that validates presence at boot:

```js
// src/config.js
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
export const config = {
  botToken: required('BOT_TOKEN'),
  clientId: required('CLIENT_ID'),
  weatherKey: process.env.WEATHER_API_KEY ?? '', // optional → keyless path
};
```

- **A keyless API needs no secret at all.** Prefer it: no secret to leak, no rotation.
- If a key must be sent, send it in a header (`Authorization: Bearer`, `X-API-Key`), not
  in a query string — query strings end up in access logs, proxies and `Referer` headers.
- Never echo a request URL that contains a key. Redact before logging.
- Rotate keys on a schedule and immediately on any suspected exposure.

---

## 9. Rate-limit awareness at the Discord layer

A bot can be the source of its own abuse. Apply both layers.

```js
// Per-user cooldown, in-memory or Redis (Redis if you run >1 instance)
const cooldowns = new Map(); // key -> expiresAt

export function checkCooldown(key, ms) {
  const now = Date.now();
  const until = cooldowns.get(key) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(key, now + ms);
  return 0;
}

// In the command:
const wait = checkCooldown(`weather:${interaction.user.id}`, 15_000);
if (wait > 0) {
  return interaction.reply({ content: `Slow down — try again in ${wait}s.`, ephemeral: true });
}
```

For shared state across instances use Redis (`redis` / `bullmq-specialist` skills cover
setup). Key by `guildId:userId` and by `guildId` separately — a guild-wide ban-list check
and a per-user cooldown are different limits.

---

## 10. Scheduled / background work

Poll on a schedule, not on user demand. Use `cron-doctor` to validate expressions and
the `bullmq-specialist` / `systemd-services` skills for durable scheduling.

- Poll intervals must respect the provider's **daily** quota: 10,000 calls/day ÷ 24 h
  ≈ one call every 8.6 s. Polling 200 guilds every 5 minutes = 57,600 calls/day → over
  budget. Stagger guilds across the window instead of looping them all at once.
- Use a queue with retries and a dead-letter queue for failures.
- Make every scheduled job **idempotent** (it may run twice).

---

## 11. Observability

Log enough to debug a provider failure without leaking secrets.

```js
logger.warn({
  provider: 'open-meteo',
  url: redactKeys(url),
  status: err.status,
  retryAfter: err.retryAfter,
  durationMs: Date.now() - startedAt,
}, 'upstream api failure');
```

Never log: the API key, the full response body if it may contain user content, or
personal data. Log the **provider, status, duration, and retry decision** — that is what
you need at 3 a.m.

---

## 12. Checklist before merging an integration

- [ ] Timeout set on every request
- [ ] Retries bounded (≤3), jittered, and only on transient errors
- [ ] `Retry-After` / `X-RateLimit-*` honoured
- [ ] Cache TTL derived from the data's real update frequency
- [ ] Stale value served when upstream fails; message says data may be stale
- [ ] Fallback chain implemented (or an explicit decision that there is none)
- [ ] Response shape validated, not just the HTTP status
- [ ] Descriptive `User-Agent` sent
- [ ] Key in the secret store only, sent in a header, never logged
- [ ] Quota headroom ≥ 3× expected peak; a meter/tracking in place
- [ ] Attribution shown where required
- [ ] Per-user cooldown / abuse protection applied
- [ ] Provider's terms recorded in the evidence table with a date
- [ ] Feature degrades gracefully when the provider is down
