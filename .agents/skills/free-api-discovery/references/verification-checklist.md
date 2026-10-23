# Pricing, Quota & Licence Verification Checklist

Work through this **per API**, before writing integration code. Capture evidence as you
go — the point is to be able to defend the claim later.

---

## 0. Capture the provider identity

| Field | Where to get it |
|---|---|
| Provider name | Provider's own site |
| Canonical API base URL | Provider's API reference page |
| Official documentation URL | Provider's docs |
| Official pricing URL | Provider's pricing page |
| Official terms / licence URL | Provider's terms page |
| Status page | Provider's status page |
| Source repository (if open source) | Provider's GitHub org |
| Date checked | Today |
| Who checked | You |

> Rule: **the provider's own pages are the only acceptable evidence.** A blog post,
> an "awesome list", a Stack Overflow answer, or an AI-generated summary is a *lead*.
> Two independent secondary sources agreeing still is not a primary source.

---

## 1. Is it free? (tier classification)

Read the pricing page and classify into exactly one:

- [ ] `free-unlimited` — no published cap; **note that fair use may still apply**
- [ ] `free-keyless-quota` — no key, but a published request/credit quota
- [ ] `free-tier-key-required` — a free tier exists, but you must register for a free key
- [ ] `trial-only` — time-limited credits or a time-boxed trial → **not durable, do not build on it**
- [ ] `paid` — reject it for this task

Questions that must all be answered:

- [ ] Does the free tier require a **credit card**? (Record it. Some vendors do this even for "$0".)
- [ ] Is there a **hard cap** on requests/calls/credits? Exact number?
- [ ] What unit is counted — requests, calls, credits, weighted units, words, characters?
- [ ] Is the cap monthly, daily, per-minute, or a rolling window?
- [ ] Does the cap **reset** or is it lifetime?
- [ ] Does hitting the cap **downgrade** (soft-throttle, stale data) or **fail hard**?
- [ ] Is there a separate **rate limit** (short-window) on top of the volume quota?

---

## 2. Is commercial use allowed?

This is the check most often skipped, and the one most likely to cause real legal exposure.

- [ ] Open the **terms / licence** page (not just pricing).
- [ ] Look for: "non-commercial", "personal use only", "free for evaluation", "commercial licence required".
- [ ] If the provider distinguishes "Free" vs "Free for non-commercial use", record **which** one you verified.
- [ ] Does the **data** carry its own licence separate from the API terms?
      (ECB rates, GeoNames, Wikimedia, NASA all do — the data licence can be the binding constraint.)
- [ ] Is **attribution** required? Capture the exact required text and the URL to link.
- [ ] Is **redistribution** of the raw data allowed? Some free terms forbid it even if display is fine.
- [ ] Record the URL of the clause you relied on, not just the page.

**Verdict field:** `allowed` / `non-commercial only` / `unknown → treat as non-commercial until confirmed`.

---

## 3. Authentication requirements

- [ ] Key required? Is a **free** key available without a card?
- [ ] Signup friction: email only, or business verification / approval queue?
- [ ] Scoping: can the key be restricted to read-only? Is there a separate key for write?
- [ ] Where will the key live? (secret store / git-ignored `.env`) — never in source.
- [ ] What happens if the key is revoked or the account is suspended? (Feature should degrade, not crash.)
- [ ] Is a **keyless** path available at all? Sometimes the keyless path has better limits.

---

## 4. Rate-limit & quota behaviour

- [ ] Scope of the limit: per IP / per key / per account / per endpoint?
- [ ] Is there a **separate quota for a keyless vs keyed** path? (CoinGecko: yes, and the
      keyless pool is ~10–30/min vs 100/min + 10,000/mo on the Demo plan.)
- [ ] What does the over-limit response look like?
      `429` + `Retry-After` · `403` · `200` with an error body · silent throttle · HTML error page?
- [ ] Are limit headers exposed (`X-RateLimit-Limit` / `-Remaining` / `-Reset`, `Retry-After`)? Read them at runtime.
- [ ] Does the limit count *your* retries? (Yes on most — retries consume quota.)
- [ ] Does a multi-item request count as one call or many? (Open-Meteo: several.)
- [ ] Any daily reset time, timezone, or rolling window?

---

## 5. Reliability & documentation quality

- [ ] Is there a real API reference with request/response examples (not just a landing page)?
- [ ] Is the response schema stable? (Unversioned endpoints that change shape are a liability.)
- [ ] Is there a **status page** and a public incident history?
- [ ] Is there a **changelog**?
- [ ] Is HTTPS enforced? Any plain-HTTP fallback?
- [ ] **CORS**: enabled? (Only matters if a browser — e.g. a dashboard — calls it directly.
      Server-side bot calls ignore CORS entirely.)
- [ ] Is a **contactable `User-Agent` required**? (Wikimedia, mcsrvstat.us, Nominatim, Reddit.)
- [ ] Is the data **open source / self-hostable**? If yes, that removes quota risk entirely
      and is the strongest long-term answer.
- [ ] Are there bulk dumps or a bulk endpoint? Prefer them over per-item calls.

---

## 6. Integration fit

- [ ] Expected daily volume vs the quota → headroom factor ≥ 3×?
- [ ] Cache TTL chosen from the data's real update frequency (not from your convenience).
- [ ] Timeout value chosen (start at 5–10 s; LLM APIs need 30–60 s).
- [ ] Fallback defined for: rate-limited · down · changed shape · quota exhausted · 402/403.
- [ ] Degradation message is user-appropriate (not a raw stack trace).
- [ ] The feature still makes sense with stale data. If not, it must fail soft.

---

## 7. Evidence record (paste into the PR / service README)

```
API:              <name>
Endpoint:         <base url + path>
Purpose:          <bot feature>
Tier:             <free-unlimited | free-keyless-quota | free-tier-key-required | trial-only | paid>
Key required:     <no | yes — stored in <secret store path>>
Quota:            <exact published numbers, or "none published">
Rate limit:       <per minute/hour/day/month; scope>
Over-limit:       <429 | 403 | 200+error body | throttle>
Commercial use:   <allowed | non-commercial only | unknown>
Attribution:      <required text/link or "none">
CORS:             <yes | no | n/a (server-side)>
User-Agent req:   <yes | no>
Self-hostable:    <yes: <url> | no>
Caching plan:     <ttl + key>
Fallback:         <secondary API | cached last-known-good | graceful error>
Docs:             <url>
Pricing page:     <url>
Terms page:       <url>
Verified on:      <YYYY-MM-DD>
Re-verify by:     <YYYY-MM-DD>
```

---

## 8. Re-verification trigger list

Re-check **immediately** (do not wait for the schedule) if the provider starts returning:

- `401 Unauthorized` on a key that worked → key revoked, plan changed, or key expired.
- `402 Payment Required` → the free tier ended.
- `403 Forbidden` on a previously working keyless endpoint → keyless access revoked
  **or** you dropped a required `User-Agent`. Check the UA first before assuming pricing.
- `429` far earlier than the documented quota → secondary/abuse limit tightened.
- `200` with an empty/odd body → shape change or deprecation notice (see the REST Countries case).

---

## 9. Quick comparison worksheet

Use when choosing between 2–4 candidates for the same feature.

| Criterion | Weight | A | B | C |
|---|---|---|---|---|
| Truly free tier exists | must-have | | | |
| Commercial use allowed | must-have | | | |
| Quota ≥ 3× expected volume | must-have | | | |
| Keyless (preferred) | high | | | |
| Stable documented schema | high | | | |
| Rate-limit headers exposed | medium | | | |
| Self-hostable | medium | | | |
| Status page / uptime | medium | | | |
| CORS (if browser) | medium | | | |
| Response latency | low | | | |
| Data licence permissive | low | | | |

If a "must-have" row is empty for a candidate, it is **out** — regardless of how good the
other rows look.
