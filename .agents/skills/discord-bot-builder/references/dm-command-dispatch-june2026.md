# DM Command Dispatch Pattern (June 2026)

## The Problem: `elif` Chain Fragility

When adding new DM commands to a discord.py bot, a long `elif` chain is fragile:

```python
# BAD — fragile elif chain
if lower in ("!status", "status"):
    ...
elif lower in ("!scan", "scan"):
    ...
elif lower.startswith("!got "):  # This might never match!
    ...
elif lower in ("!build", "build"):
    ...
```

**Why it breaks:**
- Multiple `str.replace()` patches create duplicate `elif` blocks
- An earlier `elif` with a matching condition intercepts the flow
- After 3+ patches, old code remains alongside new code

## The Fix: `if/return` Dispatch Pattern

```python
# GOOD — each command is independent
if lower.startswith(("!got ", "!g ")):
    # handle
    return
if lower.startswith(("!csez ", "!c ")):
    # handle
    return
if lower in ("!scan", "scan"):
    # handle
    return
if lower in ("!status", "status"):
    # handle
    return
# ... natural language handlers last
# ... fallback at end
```

**Why it works:** Each command is independent — no chain dependency. Safe to patch.

## Safe Patching Strategy

```python
# 1. Find function boundaries
start = content.find("async def on_dm(message):")
end = content.find("async def on_message", start)

# 2. Replace entire block
new_content = content[:start] + new_func + content[end:]

# 3. Write via terminal Python
# python3 -c "with open('bot.py','w') as f: f.write(content)"

# 4. Verify syntax
# python3 -c "import py_compile; py_compile.compile('bot.py', doraise=True)"
```

**Avoid:** Multiple `str.replace()` calls on the same file.

## Session Context (June 3, 2026)

Don's bot had `!got` and `!csez` handlers added via `str.replace()` but they never matched. Root cause: duplicate `elif` from prior patches. Fixed by rewriting entire `on_dm` function. The commands bypass the scraper — full update flow (Discord, RSS, GitHub, wiki) runs immediately.
