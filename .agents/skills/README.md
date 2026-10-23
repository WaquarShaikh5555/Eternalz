# Agent Skills — Eternalz Discord Bot Engineering Environment

This directory is the **canonical skill set** for this repository, installed at
`<repo>/.agents/skills/` (the cross-client Agent Skills convention, discoverable by
Claude Code, Codex, Cursor, Gemini CLI, Antigravity, OpenCode and the VS Code family).

Each subdirectory is a self-contained skill:

```
<skill-name>/
├── SKILL.md          # required: YAML frontmatter (name, description) + instructions
├── references/       # optional: long-form docs loaded on demand
├── scripts/          # optional: executable helpers
└── assets/           # optional: templates
```

The `name:` in each `SKILL.md` frontmatter **matches** its directory name, as required by
the [Agent Skills specification](https://agentskills.io/specification).

> Only `SKILL.md` frontmatter is loaded up front (~100 tokens per skill). The body and
> the `references/` files load only when a task actually needs them — which is why this
> set can be this large without bloating every session.

---

## Automatic skill selection

`.agents/meta/select_skills.py` maps a feature request to the right skills so the
selection step is repeatable rather than improvised. It is read-only and stdlib-only.

```bash
# Curated feature mode — deterministic, 86 feature keys
python3 .agents/meta/select_skills.py --feature "ticket system" --feature "economy"

# Free-text mode — keyword match over every skill's name + description
python3 .agents/meta/select_skills.py "weather command using a free api, with pytest tests"

# List every feature key and the skills it maps to
python3 .agents/meta/select_skills.py --list-features
```

Feature keys are grouped by the same categories as below (`moderation`, `automod`,
`warnings bans timeouts`, `ticket system`, `leveling xp`, `economy`, `giveaways`,
`polls`, `reminders`, `scheduled tasks`, `music`, `ai chatbot`, `minecraft`,
`bot statistics`, `free api`, `weather`, `currency exchange`, `country timezone`,
`github stats`, `news rss`, `translation dictionary`, `space astronomy`,
`crypto market`, `image utilities`, `database`, `migrations`, `caching`,
`background jobs`, `rest api`, `authentication`, `dashboard`, `discord oauth`,
`session management`, `secrets`, `input validation`, `dependency vulnerabilities`,
`command abuse`, `least privilege`, `unit tests`, `integration tests`, `api integration
testing`, `linting typecheck`, `logging debugging`, `docker`, `ci cd`, `azure`, `vps`,
`monitoring health checks`, `backups`, `hosting`, `planning`, …).

Aliases are accepted, so `--feature warn`, `--feature oauth2`, `--feature ci/cd`,
`--feature xp` all resolve.

Every feature key was verified to reference only skills that are actually installed.

The sibling file `.agents/meta/aas-install-manifest.json` records the 45 skills
installed by the AAS CLI and the release commit it verified.


---

## Provenance

| Source repository | Installed into | Count | License / notes |
|---|---|---|---|
| `sickn33/agentic-awesome-skills` (`skills/`) | same directory names | 45 | MIT. Installed with the official CLI (`agentic-awesome-skills@19.15.0 --path .agents/skills --skills <ids>`), release commit `eb48286810fecf33147076e0201c2397b51dd8ff` verified by the installer. |
| `anthropics/skills` | `claude-api`, `skill-creator`, `webapp-testing`, `mcp-builder` | 4 | Anthropic terms (bundled `LICENSE.txt`). Authoritative. |
| `vercel-labs/agent-skills` | `vercel-react-best-practices`, `vercel-composition-patterns`, `deploy-to-vercel`, `vercel-cli-with-tokens`, `web-design-guidelines` | 5 | MIT. Renamed to their frontmatter `name:` (spec: name must equal directory). |
| `DonZzzilla/kalshi-explorer` (`skills/user-skills/`) | `discord-bot-builder`, `systematic-debugging`, `node-inspect-debugger`, `requesting-code-review`, `plan`, `blogwatcher`, `maps`, `github-repo-management`, `webhook-subscriptions`, `minecraft-modpack-server` | 10 | Per-skill MIT. |
| **Created for this repository** | `free-api-discovery`, `discord-bot-features`, `discord-oauth-dashboard` | 3 | MIT. See “Created skills” below. |
| | **Total** | **67** | |

Skipped on purpose (documented in the task brief and by inspection):

- `partme-ai/full-stack-skills` — contains only four `openspec-*` skills that are thin
  wrappers around the `openspec` CLI (`compatibility: Requires openspec CLI`). The
  published npm package `openspec@0.0.0` is an empty placeholder and no real CLI was
  locatable, so these skills would be inert. Its `agents/fullstack-engineer.md` role
  prompt is not a skill.
- `kalshi-explorer` `software-development/test-driven-development` — near-duplicate of
  the installed `tdd` (Matt Pocock), which has the extra `tests.md`, `mocking.md` and
  `refactoring.md` references. Reused rather than duplicated.
- `kalshi-explorer` `software-development/hermes-s6-container-supervision` — specific to
  the author's Hermes Docker image, not applicable here.
- `discord-automation`'s Rube-MCP-only workflows cannot execute without the Composio
  MCP connection — but its Discord REST reference tables (permission bitfields,
  snowflakes, pagination, rate limits, pitfalls) remain valuable, so it was kept.

---

## Category coverage

### A. Discord bot engineering

| Skill | Covers |
|---|---|
| `discord-bot-architect` | **Core.** Discord.js v14 + Pycord, gateway intents, slash commands, components (buttons/selects/modals), rate limiting, sharding, command registration, error handling |
| `discord-automation` | Discord REST API reference: permission bitfields, snowflake IDs, pagination, webhook + reaction operations, MCP-driven automation |
| `discord-bot-builder` | discord.py patterns, raw REST via curl, DM dispatch, systemd deployment on a small VPS, RSS serving, dashboard patterns |

### B. Advanced bot features

| Skill | Covers |
|---|---|
| `discord-bot-features` | **Created.** Moderation + automod, warnings/bans/timeouts/audit logs, welcome + verification + reaction roles + autoroles, tickets, XP/leveling/leaderboards/economy, custom commands + per-guild config, giveaways/polls/reminders/scheduled tasks, music, AI assistants, Minecraft integration, statistics & analytics |
| `minecraft-bukkit-pro` | Bukkit/Spigot/Paper plugin development |
| `minecraft-modpack-server` | Hosting modded Minecraft servers |
| `llm-application-dev-ai-assistant` | Conversational AI assistant architecture: context management, integration boundaries, validation |
| `claude-api` | **Authoritative.** Claude model ids, pricing, streaming, tool use, caching, token counting — the reference for the AI-assistant feature |

### C. Free API discovery and integration (high priority)

| Skill | Covers |
|---|---|
| `free-api-discovery` | **Created (mandatory gap).** Discovery → pricing/quota/licence verification → documentation review → resilient integration → monitoring & fallbacks. Ships a verified API catalogue across all 13 requested domains, a verification checklist, production integration patterns, and a live `probe_api.py` |
| `api-integration-architect` | Contract design, error boundaries, retry strategy, observability for third-party APIs |
| `api-rate-limit-handler` | Bounded, idempotency-aware throttling, backoff, 429/5xx handling |
| `upstash-ratelimit` | Distributed sliding-window/fixed-window/token-bucket rate limiting over Redis |
| `maps` | **Free, no-key, keyless-friendly.** Nominatim / Overpass / OSRM / TimeAPI.io geocoding, POIs, routing, timezones (Python stdlib only) |
| `blogwatcher` | RSS/Atom feed monitoring for news features |
| `github-repo-management` | GitHub REST/GraphQL operations for the repo-statistics feature |
| `alpha-vantage` | Market/financial data (free tier documented in the skill) |

### D. Backend and databases

| Skill | Covers |
|---|---|
| `postgres-best-practices` | PostgreSQL schema design, indexing, query performance (Supabase-derived, authoritative) |
| `database-migrations-sql-migrations` | Zero-downtime SQL migrations for PostgreSQL/MySQL/SQL Server |
| `prisma-expert` | Prisma schema design, migrations, relations (PostgreSQL/MySQL/SQLite) |
| `drizzle-orm-expert` | Drizzle ORM: type-safe schema, relational queries, Drizzle Kit migrations |
| `redis` | Redis caching, persistence, Sentinel, queues, rate limiting |
| `bullmq-specialist` | Redis-backed background jobs: retries, backoff, DLQs, concurrency, graceful shutdown |
| `mongodb` | MongoDB administration (this repo already uses Mongoose), replica sets, backups |
| `api-endpoint-builder` | Production REST endpoints: validation, error handling, auth, docs |
| `auth-implementation-patterns` | Token/session/resource-authorisation patterns |
| `cron-doctor` | Validates cron expressions before they ship (silent death-traps) |
| `webhook-subscriptions` | Event-driven webhook subscriptions |

### E. Dashboards and web integrations

| Skill | Covers |
|---|---|
| `discord-oauth-dashboard` | **Created (gap).** OAuth2 authorize/token/user flows, `state` CSRF, scopes vs permissions vs intents, least-privilege invite URLs, secure sessions, dashboard REST API, live bot statistics, role/permission management, CSP/CSRF/rate limiting |
| `vercel-react-best-practices` | React/Next performance for the dashboard frontend |
| `vercel-composition-patterns` | Scalable React composition for the dashboard UI |
| `web-design-guidelines` | UI review against the Web Interface Guidelines |
| `deploy-to-vercel` / `vercel-cli-with-tokens` | Hosting the dashboard + bot on Vercel |
| `webapp-testing` | Playwright-based verification of the dashboard |

### F. Security

| Skill | Covers |
|---|---|
| `varlock` | Secure-by-default environment variable / secret handling — secrets never in context, logs, diffs |
| `api-security-best-practices` | Secure API design: authn/authz, validation, rate limiting, error handling |
| `backend-security-coder` | Secure backend coding: input validation, injection defence, secrets |
| `dependency-scanning` | Snyk / Dependabot / OWASP Dependency-Check |
| `vulnerability-scanner` | OWASP 2025, supply-chain security, attack-surface mapping (OWASP A01–A05) |
| `audit-logging` | Centralised audit logging and retention (backs the mod-log feature) |
| `gha-security-review` | Finds exploitable vulnerabilities in GitHub Actions workflows |
| `container-hardening` | Secure images, non-root users, runtime hardening |
| `frontend-security-coder` / `mcp-server-security` | XSS/output sanitisation for the dashboard, MCP hardening |

### G. Testing and code quality

| Skill | Covers |
|---|---|
| `jest-skill` | Jest unit + integration tests, mocking, snapshots — the natural fit for this discord.js repo |
| `pytest-skill` | pytest suites for discord.py work |
| `tdd` | TDD discipline: RED–GREEN–REFACTOR, behaviour-focused tests, mocking guidelines |
| `api-testing-observability-api-mock` | Realistic API mocks + integration testing |
| `lint-and-validate` | Run configured lint/type checks and distinguish failures from "did not run" |
| `node-inspect-debugger` | Node.js debugging via `--inspect` + Chrome DevTools Protocol |
| `systematic-debugging` | 4-phase root-cause debugging |
| `verification-before-completion` | Verify work before claiming it is done |
| `requesting-code-review` | Pre-commit security + quality review |
| `bug-hunter` / `debugging-strategies` | Systematic bug finding |

### H. Deployment and production operations

| Skill | Covers |
|---|---|
| `docker-expert` / `docker-compose` | Image optimisation, multi-container orchestration |
| `github-actions` / `github-actions-advanced` / `github-actions-templates` | CI/CD: build, test, deploy, reusable workflows, matrices |
| `systemd-services` | systemd units + timers: process supervision, auto-restart, resource limits |
| `vps-server-management` | Cautious SSH/ops workflow for a VPS host |
| `deployment-engineer` | Modern CI/CD, GitOps, deployment strategies |
| `azd-deployment` | Azure Container Apps with `azd` (the requested Azure path) |
| `backup-recovery` / `database-backups` | Backup strategy, retention, **restore testing** |
| `observability-and-instrumentation` | Logging, metrics, tracing, health checks |
| `plan` / `writing-plans` / `brainstorming` | Requirements → actionable plan before code |

---

## Created skills — why they exist

Three gaps had **no upstream skill** after inspecting all six source repositories
(2,743 AAS skills + Anthropic + Vercel + kalshi + full-stack-skills):

1. **`free-api-discovery`** — explicitly required by the brief. No skill in any source
   repo covered *free-API discovery and pricing verification*. Built with:
   - a 13-domain **verified** API catalogue (quotas, auth, commercial-use licence,
     attribution, CORS, User-Agent requirement, fallbacks, re-verification schedule),
   - a pricing/licence **verification checklist** with a reusable evidence table,
   - production **integration patterns** (timeout, jittered retry, `Retry-After`/
     `X-RateLimit`, TTL + stale cache, circuit breaker, fallback chain, schema
     validation, quota meter, secret hygiene),
   - `scripts/probe_api.py` — a read-only live probe that reports auth requirement,
     CORS, rate-limit headers and **soft failures** (HTTP 200 with an error body).

2. **`discord-bot-features`** — AAS/kalshi cover Discord *plumbing*, not the advanced
   feature families (automod, warnings/bans/timeouts/audit, welcome/verification/
   reaction roles/autoroles, tickets, XP/leaderboards/economy, giveaways/polls/
   reminders, music, AI, Minecraft, analytics). Filled with a consistent architecture:
   guild-scoped data → config resolution → three-way permission gate → 3-second
   interaction budget → persist-then-audit → user feedback.

3. **`discord-oauth-dashboard`** — no source repo covered Discord OAuth2 (scopes,
   `state`, token exchange/refresh, session handling) or the dashboard surface
   (config panels, live stats, role management). Built with the scope-vs-permission-
   vs-intent distinction, least-privilege invite URL generation, server-side sessions,
   and a whitelisted, CSRF-protected dashboard API.

---

## Prerequisites and caveats

| Item | Status |
|---|---|
| Skill format | All 67 pass the Agent Skills spec: `name` == directory name, valid charset, `description` present and ≤1024 chars. Verified with `skill-creator/scripts/quick_validate.py` (requires PyYAML — install into a venv; the system Python is PEP-668 managed). |
| `discord-automation` | Its *action* workflows need Composio's Rube MCP connected. Its Discord REST reference tables work without it. |
| `blogwatcher` | Needs the `blogwatcher-cli` binary (Go / Docker / release tarball). Install instructions are in the skill. |
| `maps` | Pure Python stdlib — works as-is. Its live calls need outbound access to OSM/OSRM/TimeAPI.io. |
| `skill-creator` | PyYAML required for its scripts. |
| `mcp-builder` | Only needed if you build an MCP server; the bundled `scripts/requirements.txt` is **not** installed. |
| Upstream scripts | No third-party script was executed during installation. Executable files present: `deploy-to-vercel/resources/*.sh`, `github-repo-management/scripts/gh-env.sh`, `skill-creator/scripts/*.py`, `webapp-testing/scripts/with_server.py`, `vulnerability-scanner/scripts/security_scan.py`, `free-api-discovery/scripts/probe_api.py` (the last one **was** run, read-only, against `api.github.com`). |
| Non-standard frontmatter | Upstream `discord-bot-architect`, `maps`, `blogwatcher` and others carry extra top-level keys (`risk`, `source`, `date_added`, `author`, `platforms`, `version`). Left untouched for upstream fidelity; `name` + `description` are present and correct in all of them. `claude-api` has a 1,068-char description (upstream Anthropic file), above the 1,024-char guideline — left as published. |
| Oversized SKILL.md | `claude-api` (105 KB) and `discord-bot-builder` (78 KB) load a lot of context when activated. Upstream files, left intact deliberately. |
| Sandbox network | Outbound HTTPS is restricted to `github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`. Third-party APIs were **verified against their published documentation via web research**, not by live calls from the sandbox. |
