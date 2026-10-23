# Discord Crosspost/Forwarded Message Handling (June 2026)

## Problem

When a user forwards or crossposts a message from one Discord channel to another, the forwarded message often has **empty `message.content`**. The actual content is nested in `message.message_snapshots`.

## Message Structure

Normal message:
```python
message.content  # "Hello world"
```

Crossposted/forwarded message:
```python
message.content  # "" (empty!)
message.message_snapshots  # [MessageSnapshot(...)]
# MessageSnapshot has .content directly (NOT .message.content in discord.py 2.7.1)
# Also check .embeds on the snapshot for build numbers
```

## Solution: `get_message_content()` Helper

```python
def get_message_content(message):
    """Get message content, falling back to snapshots for crossposted/forwarded messages."""
    content = message.content
    if content:
        return content
    
    # Discord crossposted/forwarded messages put content in snapshots
    if hasattr(message, 'message_snapshots') and message.message_snapshots:
        for snapshot in message.message_snapshots:
            # discord.py 2.7.1: MessageSnapshot has .content directly
            if hasattr(snapshot, 'content') and snapshot.content:
                return snapshot.content
            # Some versions: snapshot.message.content
            if hasattr(snapshot, 'message') and snapshot.message and snapshot.message.content:
                return snapshot.message.content
    
    # Check embeds on the original message
    for embed in message.embeds:
        if embed.description:
            parts = []
            if embed.title: parts.append(embed.title)
            if embed.description: parts.append(embed.description)
            return '\n'.join(parts)
    
    # Check embeds in snapshots too
    if hasattr(message, 'message_snapshots') and message.message_snapshots:
        for snapshot in message.message_snapshots:
            snap_embeds = getattr(snapshot, 'embeds', None) or []
            for embed in snap_embeds:
                if embed.description:
                    parts = []
                    if embed.title: parts.append(embed.title)
                    if embed.description: parts.append(embed.description)
                    for field in getattr(embed, 'fields', []) or []:
                        if field.value: parts.append(field.value)
                        if field.name: parts.append(field.name)
                    return '\n'.join(parts)
    
    return ""
```

## Usage in Bot Handlers

Replace `content = message.content` with `content = get_message_content(message)` in ALL channel handlers:

```python
async def handle_got_message(message):
    global got_state, hourly_scrape_time
    content = get_message_content(message)  # NOT message.content
    log("GOT: New message in #got_updates: %s" % content[:80])
    # ... rest of handler
```

## Key Pitfalls

1. **MessageSnapshot.content vs MessageSnapshot.message.content**: In discord.py 2.7.1, `MessageSnapshot` has `.content` directly. In some versions it's nested under `.message.content`. Check both.

2. **Snapshot embeds**: Build numbers may be in snapshot embeds, not in the text content. Always check `snapshot.embeds`.

3. **Empty snapshots**: `message.message_snapshots` can be an empty list `[]`. Check `if message.message_snapshots:` (falsy for empty list).

4. **Debug logging**: Add detailed logging to see what the message structure looks like.

## Testing

To test, forward a message from another channel to the monitored channel. The bot should:
1. Log "Empty content, checking snapshots..."
2. Extract content from the snapshot
3. Process the message normally

If the bot logs "All content sources empty", the forward type may be different (e.g., a reply reference instead of a crosspost). Check `message.reference.resolved.content` as a last resort.
