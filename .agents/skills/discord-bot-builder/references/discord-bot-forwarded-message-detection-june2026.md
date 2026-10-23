# Discord Forwarded/Crossposted Message Detection

## Problem

Discord forwarded/crossposted messages have **empty `message.content`**. The actual content is in `message.message_snapshots`. The bot's `handle_got_message` and `handle_csez_message` only check `message.content`, so forwarded messages are silently ignored.

## Solution: `get_message_content()` Helper

Add this function to bot.py and use it in both channel handlers:

```python
def get_message_content(message):
    """Get message content, falling back to snapshots for crossposted/forwarded messages."""
    content = message.content
    if content:
        return content
    # Discord crossposted/forwarded messages put content in snapshots
    if hasattr(message, 'message_snapshots') and message.message_snapshots:
        for snapshot in message.message_snapshots:
            # MessageSnapshot has .content directly (NOT .message.content)
            if hasattr(snapshot, 'content') and snapshot.content:
                return snapshot.content
            # Some versions wrap in .message
            if hasattr(snapshot, 'message') and snapshot.message and snapshot.message.content:
                return snapshot.message.content
    # Also check message.reference as last resort
    if hasattr(message, 'reference') and message.reference:
        if hasattr(message.reference, 'resolved') and message.reference.resolved:
            resolved = message.reference.resolved
            if resolved.content:
                return resolved.content
    return content  # return original (may be empty)
```

## Usage in Handlers

Replace `content = message.content` with `content = get_message_content(message)` in both `handle_got_message` and `handle_csez_message`.

## Key Pitfalls

1. **`MessageSnapshot.content` is direct** — NOT `snapshot.message.content`. The snapshot IS the message.
2. **Check `snapshot.embeds` too** — build numbers may be in embed descriptions/fields, not in text content.
3. **Empty content after all fallbacks** — if still empty, the forward may have no text (image-only, etc.). Handle gracefully.

## Hotfix Number Mismatch

When a forward arrives for Hotfix N but `last_got_message.txt` still has content from Hotfix N-1:
- Extract hotfix number from the NEW message's `##` header, NOT from stale saved content
- Always verify the hotfix number in the saved message matches the build being inserted
