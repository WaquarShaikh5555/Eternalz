# Converting Manual DM Handlers to @bot.command() Decorators

## When to Convert

If your discord.py bot handles commands via manual string matching in `on_dm()` or `on_message()`, convert to `@bot.command()` decorators when commands don't appear in `!help`, you want auto-generated help text, or you want to add/remove commands without editing a long if/elif chain.

## Conversion Steps

1. **Add owner_only() check:**
```python
def owner_only():
    async def predicate(ctx):
        return int(ctx.author.id) == int(OWNER_UID)
    return commands.check(predicate)
```

2. **Register commands with decorators instead of if/elif:**
```python
@owner_only()
@bot.command(name="status", aliases=["health"])
async def cmd_status(ctx):
    """Bot health + service status"""
    await ctx.send("...")
```

3. **Update on_message to call process_commands FIRST:**
```python
@bot.event
async def on_message(message):
    if message.author.bot:
        return
    await bot.process_commands(message)  # Commands processed first
    # ... fallback chat/channel handlers after ...
```

4. **Update helper functions: message -> ctx**
```python
async def manual_got_update(ctx, build, patch_notes=None):
    await ctx.send("GoT update complete!")  # NOT message.channel.send()
```

## Pitfall: Regex Backslash Doubling in Heredocs

When writing Python source through shell heredocs, regex backslashes double. File ends up with `r'^\\\\d+'` (4 backslashes) instead of `r'^\\d+'` (2 backslashes). Verify with: `python3 -c "import re; print(bool(re.match(r'^\\d+(?:\\.\\d+)+$', '0.13.0.8860.63875')))"`

## Pitfall: @bot.event on Non-Event Functions

`@bot.event` must ONLY be used on event handlers. Never place it before a regular function like `owner_only()` — causes TypeError.

## Verification

1. `py_compile.compile('bot.py', doraise=True)` — syntax OK
2. Exactly 1 `on_message`, 0 `on_dm`
3. `!help` lists all commands
