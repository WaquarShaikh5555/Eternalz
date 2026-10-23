#!/usr/bin/env python3
"""
select_skills.py — map a feature request to the installed skill set.

Two modes:

  1. Feature mode (recommended): a curated feature -> skill mapping. Deterministic and
     covers the whole required feature matrix.

         python3 select_skills.py --feature "moderation"
         python3 select_skills.py --feature "ticket system" --feature "economy"

  2. Free-text mode: keyword matching over every skill's `name` + `description`.
     Useful for requests that do not map cleanly onto a known feature.

         python3 select_skills.py "build me a music bot with a dashboard"

Also prints, for each selected skill, the source repo and the exact path on disk, so the
calling agent can read the SKILL.md before using it.

Stdlib only. Read-only. Never modifies anything.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

SKILLS_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "skills")

# ---------------------------------------------------------------------------
# Curated feature -> skills mapping.
#
# Each entry lists the skill directory names that should be loaded for that feature,
# in load order (most feature-specific first).
# ---------------------------------------------------------------------------

FEATURES: dict[str, list[str]] = {
    # --- A. Discord bot engineering -----------------------------------------
    "core bot": [
        "discord-bot-architect",
        "discord-bot-builder",
        "discord-automation",
        "backend-dev-guidelines" if False else "api-endpoint-builder",
        "varlock",
    ],
    "slash commands": ["discord-bot-architect", "discord-bot-builder"],
    "buttons and modals": ["discord-bot-architect", "discord-bot-builder"],
    "embeds and webhooks": ["discord-bot-architect", "discord-automation"],
    "permissions and intents": ["discord-bot-architect", "discord-automation", "backend-security-coder"],
    "sharding and multi-guild": ["discord-bot-architect", "observability-and-instrumentation"],
    "rate limits": ["discord-bot-architect", "api-rate-limit-handler", "upstash-ratelimit"],
    "interaction errors": ["discord-bot-architect", "systematic-debugging", "verification-before-completion"],

    # --- B. Advanced bot features ------------------------------------------
    "moderation": ["discord-bot-features", "discord-bot-architect", "audit-logging"],
    "automod": ["discord-bot-features", "discord-bot-architect"],
    "warnings bans timeouts": ["discord-bot-features", "audit-logging"],
    "audit log": ["discord-bot-features", "audit-logging"],
    "welcome messages": ["discord-bot-features", "discord-bot-architect"],
    "verification": ["discord-bot-features", "discord-oauth-dashboard", "discord-bot-architect"],
    "reaction roles": ["discord-bot-features", "discord-bot-architect"],
    "autoroles": ["discord-bot-features", "discord-bot-architect"],
    "ticket system": ["discord-bot-features", "discord-bot-architect", "discord-oauth-dashboard"],
    "leveling xp": ["discord-bot-features", "postgres-best-practices", "redis"],
    "leaderboard": ["discord-bot-features", "postgres-best-practices"],
    "economy": ["discord-bot-features", "postgres-best-practices", "redis"],
    "custom commands": ["discord-bot-features", "discord-bot-architect", "api-endpoint-builder"],
    "guild configuration": ["discord-bot-features", "postgres-best-practices", "discord-oauth-dashboard"],
    "giveaways": ["discord-bot-features", "bullmq-specialist", "postgres-best-practices"],
    "polls": ["discord-bot-features", "postgres-best-practices"],
    "reminders": ["discord-bot-features", "bullmq-specialist", "cron-doctor"],
    "scheduled tasks": ["bullmq-specialist", "cron-doctor", "systemd-services"],
    "music": ["discord-bot-features", "discord-bot-architect"],
    "ai chatbot": ["discord-bot-features", "claude-api", "llm-application-dev-ai-assistant"],
    "ai assistant": ["discord-bot-features", "claude-api", "llm-application-dev-ai-assistant"],
    "minecraft": ["discord-bot-features", "free-api-discovery", "minecraft-bukkit-pro", "minecraft-modpack-server"],
    "bot statistics": ["discord-bot-features", "observability-and-instrumentation", "discord-oauth-dashboard"],
    "server management": ["discord-bot-features", "discord-bot-architect"],

    # --- C. Free API discovery ----------------------------------------------
    "free api": ["free-api-discovery", "api-integration-architect", "api-rate-limit-handler"],
    "api discovery": ["free-api-discovery"],
    "weather": ["free-api-discovery", "discord-bot-features"],
    "currency exchange": ["free-api-discovery", "discord-bot-features"],
    "country timezone": ["free-api-discovery", "maps", "discord-bot-features"],
    "github stats": ["free-api-discovery", "github-repo-management", "discord-bot-features"],
    "news rss": ["free-api-discovery", "blogwatcher", "discord-bot-features"],
    "translation dictionary": ["free-api-discovery", "discord-bot-features"],
    "space astronomy": ["free-api-discovery", "discord-bot-features"],
    "crypto market": ["free-api-discovery", "discord-bot-features"],
    "image utilities": ["free-api-discovery", "discord-bot-features"],
    "ai model api": ["free-api-discovery", "claude-api"],

    # --- D. Backend and databases -------------------------------------------
    "database": ["postgres-best-practices", "database-migrations-sql-migrations", "prisma-expert", "drizzle-orm-expert"],
    "migrations": ["database-migrations-sql-migrations", "prisma-expert", "drizzle-orm-expert"],
    "indexing": ["postgres-best-practices"],
    "caching": ["redis", "bullmq-specialist"],
    "background jobs": ["bullmq-specialist", "redis", "cron-doctor"],
    "rest api": ["api-endpoint-builder", "api-integration-architect", "api-security-best-practices"],
    "authentication": ["auth-implementation-patterns", "api-security-best-practices"],
    "authorization": ["auth-implementation-patterns", "backend-security-coder"],

    # --- E. Dashboards ------------------------------------------------------
    "dashboard": ["discord-oauth-dashboard", "vercel-react-best-practices", "web-design-guidelines", "api-endpoint-builder"],
    "discord oauth": ["discord-oauth-dashboard"],
    "web panel": ["discord-oauth-dashboard", "vercel-react-best-practices"],
    "live statistics": ["discord-oauth-dashboard", "observability-and-instrumentation"],
    "role management ui": ["discord-oauth-dashboard", "discord-bot-features"],
    "session management": ["discord-oauth-dashboard", "auth-implementation-patterns"],

    # --- F. Security --------------------------------------------------------
    "secrets": ["varlock", "discord-bot-features"],
    "input validation": ["backend-security-coder", "api-security-best-practices", "zod-validation-expert" if False else "api-endpoint-builder"],
    "dependency vulnerabilities": ["dependency-scanning", "vulnerability-scanner"],
    "command abuse": ["discord-bot-features", "upstash-ratelimit", "api-rate-limit-handler"],
    "least privilege": ["discord-oauth-dashboard", "discord-bot-features", "backend-security-coder"],
    "admin actions": ["discord-bot-features", "audit-logging"],
    "malicious links": ["discord-bot-features", "backend-security-coder"],

    # --- G. Testing and code quality ---------------------------------------
    "unit tests": ["jest-skill", "tdd"],
    "integration tests": ["jest-skill", "api-testing-observability-api-mock", "tdd"],
    "mocking discord": ["jest-skill", "tdd"],
    "api integration testing": ["api-testing-observability-api-mock", "jest-skill"],
    "regression testing": ["tdd", "jest-skill", "verification-before-completion"],
    "linting typecheck": ["lint-and-validate"],
    "logging debugging": ["observability-and-instrumentation", "node-inspect-debugger", "systematic-debugging"],
    "code review": ["requesting-code-review", "verification-before-completion"],

    # --- H. Deployment and operations ---------------------------------------
    "docker": ["docker-expert", "docker-compose", "container-hardening"],
    "ci cd": ["github-actions", "github-actions-advanced", "github-actions-templates"],
    "github actions": ["github-actions", "github-actions-advanced", "gha-security-review"],
    "azure": ["azd-deployment"],
    "vps": ["vps-server-management", "systemd-services"],
    "process supervision": ["systemd-services", "docker-compose"],
    "monitoring health checks": ["observability-and-instrumentation"],
    "backups": ["backup-recovery", "database-backups"],
    "database recovery": ["database-backups", "backup-recovery", "database-migrations-sql-migrations"],
    "hosting": ["deploy-to-vercel", "vercel-cli-with-tokens", "docker-expert"],

    # --- Cross-cutting workflow ---------------------------------------------
    "planning": ["brainstorming", "writing-plans", "plan"],
    "architecture": ["discord-bot-architect", "backend-security-coder", "deployment-engineer"],
    "webapp testing": ["webapp-testing", "jest-skill"],
}

# Synonyms so a natural-language request hits the right feature key.
ALIASES: dict[str, str] = {
    "bot": "core bot",
    "discord": "core bot",
    "commands": "slash commands",
    "slash command": "slash commands",
    "components": "buttons and modals",
    "buttons": "buttons and modals",
    "selects": "buttons and modals",
    "modals": "buttons and modals",
    "permissions": "permissions and intents",
    "intents": "permissions and intents",
    "rate limit": "rate limits",
    "error handling": "interaction errors",
    "automoderation": "automod",
    "auto mod": "automod",
    "warn": "warnings bans timeouts",
    "ban": "warnings bans timeouts",
    "timeout": "warnings bans timeouts",
    "audit logging": "audit log",
    "welcome": "welcome messages",
    "reaction-role": "reaction roles",
    "auto role": "autoroles",
    "ticket": "ticket system",
    "support": "ticket system",
    "level": "leveling xp",
    "xp": "leveling xp",
    "leaderboards": "leaderboard",
    "currency": "economy",
    "coins": "economy",
    "config": "guild configuration",
    "giveaway": "giveaways",
    "poll": "polls",
    "reminder": "reminders",
    "scheduler": "scheduled tasks",
    "cron": "scheduled tasks",
    "jobs": "background jobs",
    "ai": "ai chatbot",
    "chatbot": "ai chatbot",
    "assistant": "ai assistant",
    "llm": "ai chatbot",
    "stats": "bot statistics",
    "analytics": "bot statistics",
    "api": "free api",
    "apis": "free api",
    "public api": "free api",
    "free tier": "free api",
    "weather": "weather",
    "forecast": "weather",
    "exchange rate": "currency exchange",
    "country info": "country timezone",
    "geocoding": "country timezone",
    "time zone": "country timezone",
    "timezone": "country timezone",
    "github": "github stats",
    "rss": "news rss",
    "news": "news rss",
    "translate": "translation dictionary",
    "dictionary": "translation dictionary",
    "nasa": "space astronomy",
    "crypto": "crypto market",
    "images": "image utilities",
    "postgres": "database",
    "postgresql": "database",
    "sqlite": "database",
    "mongo": "database",
    "redis cache": "caching",
    "migration": "migrations",
    "schema": "database",
    "auth": "authentication",
    "oauth": "discord oauth",
    "oauth2": "discord oauth",
    "login": "discord oauth",
    "web dashboard": "dashboard",
    "admin panel": "dashboard",
    "stats page": "live statistics",
    "roles ui": "role management ui",
    "session": "session management",
    "env": "secrets",
    "environment variables": "secrets",
    "api keys": "secrets",
    "validation": "input validation",
    "sanitization": "input validation",
    "xss": "input validation",
    "sql injection": "input validation",
    "vulnerabilities": "dependency vulnerabilities",
    "cve": "dependency vulnerabilities",
    "spam": "command abuse",
    "cooldown": "command abuse",
    "privilege": "least privilege",
    "permissions least": "least privilege",
    "tests": "unit tests",
    "testing": "unit tests",
    "jest": "unit tests",
    "vitest": "unit tests",
    "pytest": "unit tests",
    "mock": "mocking discord",
    "lint": "linting typecheck",
    "eslint": "linting typecheck",
    "typescript": "linting typecheck",
    "debugging": "logging debugging",
    "logging": "logging debugging",
    "observability": "monitoring health checks",
    "container": "docker",
    "containerization": "docker",
    "pipeline": "ci cd",
    "workflow": "ci cd",
    "server": "vps",
    "hosting": "hosting",
    "vercel": "hosting",
    "backup": "backups",
    "restore": "database recovery",
    "plan": "planning",
    "spec": "planning",
}


def skill_records() -> dict[str, dict]:
    """Read every installed skill's name + description."""
    records: dict[str, dict] = {}
    if not os.path.isdir(SKILLS_ROOT):
        return records
    for entry in sorted(os.listdir(SKILLS_ROOT)):
        path = os.path.join(SKILLS_ROOT, entry)
        sk = os.path.join(path, "SKILL.md")
        if not os.path.isfile(sk):
            continue
        text = open(sk, encoding="utf-8", errors="replace").read()
        m = re.match(r"^---\n(.*?)\n---", text, re.S)
        desc = ""
        if m:
            d = re.search(r"(?ms)^description:\s*(?:[>|]\-?\s*\n)?(.*?)(?=\n[a-zA-Z_]+:|\Z)", m.group(1))
            if d:
                desc = " ".join(x.strip(" \"'") for x in d.group(1).strip().splitlines()).strip()
        records[entry] = {
            "name": entry,
            "description": desc,
            "path": os.path.abspath(path),
            "dir": os.path.abspath(path),
        }
    return records


def resolve_feature(key: str) -> str | None:
    k = key.strip().lower()
    if k in FEATURES:
        return k
    if k in ALIASES:
        return ALIASES[k]
    for feat in FEATURES:
        if feat in k or k in feat:
            return feat
    return None


def select_by_feature(keys: list[str]) -> tuple[list[str], list[str]]:
    selected: list[str] = []
    unknown: list[str] = []
    for key in keys:
        feat = resolve_feature(key)
        if feat is None:
            unknown.append(key)
            continue
        for s in FEATURES[feat]:
            if s not in selected:
                selected.append(s)
    return selected, unknown


def select_by_text(text: str) -> list[str]:
    """Keyword match against skill names + descriptions.

    Any Discord-bot request implicitly needs the core engineering skill and the
    advanced-feature playbook, so those are always included.
    """
    words = set(re.findall(r"[a-z0-9+#]+", text.lower()))
    records = skill_records()
    scored: list[tuple[int, str]] = []
    for name, rec in records.items():
        score = 0
        nname = name.lower()
        if nname in words:
            score += 8
        for w in words:
            if len(w) > 3 and w in nname:
                score += 4
        for w in words:
            if len(w) > 4 and w in rec["description"].lower():
                score += 1
        if score:
            scored.append((score, name))
    scored.sort(reverse=True)

    selected: list[str] = []
    for s, n in scored:
        if s >= 6 and n not in selected:
            selected.append(n)
        if len(selected) >= 10:
            break

    # Alias hit -> pull in that curated feature's skills.
    for word in words:
        feat = resolve_feature(word)
        if feat:
            for s in FEATURES[feat]:
                if s in records and s not in selected:
                    selected.append(s)

    # Always-on foundations for a Discord bot request.
    for core in ("discord-bot-architect", "discord-bot-features"):
        if core in records and core not in selected:
            selected.insert(0, core)
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description="Select the right installed skills for a bot feature request.")
    parser.add_argument("--feature", action="append", default=[], help="Feature key (repeatable)")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    parser.add_argument("--list-features", action="store_true", help="List all feature keys and exit")
    parser.add_argument("text", nargs="?", help="Free-text request to match against skill descriptions")
    args = parser.parse_args()

    if args.list_features:
        for feat in sorted(FEATURES):
            print(f"{feat:28s} -> {', '.join(FEATURES[feat])}")
        return 0

    records = skill_records()
    selected: list[str] = []
    unknown: list[str] = []

    if args.feature:
        selected, unknown = select_by_feature(args.feature)
    elif args.text:
        selected = select_by_text(args.text)
    else:
        parser.error("provide --feature KEY (repeatable) or a free-text request")

    if unknown:
        print(f"# unmatched feature key(s): {', '.join(unknown)}\n", file=sys.stderr)

    result = {
        "selected": [
            {
                "name": n,
                "path": records.get(n, {}).get("path"),
                "description": records.get(n, {}).get("description", "")[:220],
                "present": n in records,
            }
            for n in selected
        ],
        "unmatched_features": unknown,
        "total_installed": len(records),
    }

    if args.json:
        print(json.dumps(result, indent=2))
        return 0

    print(f"Selected {len(result['selected'])} skill(s) of {len(records)} installed:\n")
    for s in result["selected"]:
        mark = "OK " if s["present"] else "MISSING"
        print(f"  [{mark}] {s['name']}")
        if s["description"]:
            print(f"        {s['description'][:160]}")
        print(f"        -> {s['path']}")
    missing = [s["name"] for s in result["selected"] if not s["present"]]
    if missing:
        print(f"\nWARNING: not installed: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
