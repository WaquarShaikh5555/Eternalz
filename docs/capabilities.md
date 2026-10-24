# What the AI administrator can and cannot do

This is the honest capability list. It is generated from the same tool
allowlist the bot uses, so it cannot drift from the implementation.

## How to read this

The bot can do **anything that maps onto the tools below**, including
combinations of them in one request. Anything not on this list is **not
implemented**, and the model is instructed to say so instead of improvising.

## Read / inspect (always automatic)

| Capability | Tool |
| --- | --- |
| Server overview (name, owner, member count, features, the bot's own permissions) | `inspect_guild` |
| List every channel and category with its type, parent, position, topic, slowmode and permission overwrites | `list_channels` |
| List every role with its position, colour, member count and decoded permissions | `list_roles` |
| The permission overwrites of one channel | `get_channel_overwrites` |
| The decoded permissions of one role | `get_role_permissions` |
| The roles held by one member | `get_member_roles` |
| A complete server snapshot in one call | `get_server_snapshot` |

## Channels and categories

| Capability | Tool | Confirmation |
| --- | --- | --- |
| Create a category | `create_category` | automatic |
| Create a text / voice / stage / announcement / forum channel | `create_channel` | automatic |
| Create a **private** channel for specific members | `create_channel` with `private:true` | one confirmation |
| Rename a channel or a category | `rename_channel` | automatic |
| Set or clear a channel topic | `set_channel_topic` | automatic |
| Set slowmode (0 = off, up to 6 hours) | `set_channel_slowmode` | automatic |
| Move a channel into / out of a category, or change its position | `move_channel` | automatic |
| Delete a channel or a category | `delete_channel` | one confirmation |
| Create or change a permission overwrite on an existing channel | `set_permission_overwrite` | one confirmation |
| Remove a permission overwrite | `delete_permission_overwrite` | one confirmation |

**Not implemented:** channel NSFW flag, channel user limit / bitrate,
threads, pinned messages, voice region, stage instances, forum post tags.

## Roles

| Capability | Tool | Confirmation |
| --- | --- | --- |
| Create a role (name, colour, hoist, mentionable, permissions) | `create_role` | automatic |
| Create a role with a privileged permission | `create_role` | one confirmation |
| Create a role with `Administrator` | `create_role` | **two** confirmations |
| Rename / recolour / hoist / make mentionable an existing role | `edit_role` | automatic |
| Change the permission set of an existing role | `edit_role` | one confirmation (two if it grants Administrator) |
| Delete a role | `delete_role` | one confirmation |
| Give a member a **non-privileged** role | `assign_role` | automatic |
| Remove a **non-privileged** role from a member | `remove_role` | automatic (two confirmations for 3+ members at once) |

**Deliberately restricted:** the AI can never assign or remove a role that
carries a privileged permission (`Administrator`, `ManageGuild`, `ManageRoles`,
`ManageChannels`, `BanMembers`, `KickMembers`, …). Those have to be managed by
a human. Managed roles (bot roles, integration roles, `@everyone`) cannot be
edited or deleted.

**Not implemented:** role icons, role ordering / drag-and-drop, role
subscriptions, role mention permissions for other roles.

## Moderation

| Capability | Tool | Confirmation |
| --- | --- | --- |
| Timeout (mute) a member for 1 minute – 28 days | `timeout_member` | one confirmation |
| Kick a member | `kick_member` | one confirmation |
| Ban a member (optionally deleting 0–7 days of messages) | `ban_member` | one confirmation |
| Unban a user | `unban_member` | automatic |
| Bulk delete 1–100 recent messages in a channel | `delete_messages` | one confirmation |

**Not implemented:** timeout removal (clearing a timeout), warning systems,
message pinning, automod rule editing, prune by role.

## Community and messaging

| Capability | Tool | Confirmation |
| --- | --- | --- |
| Post an announcement / formatted embed in a channel | `send_announcement` | automatic |
| Configure the welcome message for new members | `set_welcome_channel` | automatic |
| Configure the role automatically given to new members | `set_onboarding_role` | automatic |
| Create a private support / ticket channel with staff access | `create_ticket_channel` | one confirmation |
| Publish the server rules | `set_server_rules` | automatic |

**Not implemented:** Discord "Server Guide" / onboarding screens, rules
screening, community / discovery toggles, scheduled events, stage events,
custom invite links.

## Not implemented at all (server level)

Server rename, server icon / banner, server verification level, AFK channel,
system messages channel, server locale, server boosts, emojis, stickers,
webhooks, integrations, widgets, audit-log reading, vanity URLs.

## Safety limits that are never lifted

* One target guild by default; other guilds require explicit `AI_MULTI_GUILD=true`.
* Access requires the owner, static `AI_ADMIN_USER_IDS` / `AI_ADMIN_ROLE_IDS`
  rules, or a current-guild grant issued by the application owner with
  `/add-admin`. Grants never carry over or permit adding more administrators.
* No arbitrary code execution, no invented API operations.
* A role the bot does not outrank can never be touched, and neither can a
  member with a role at or above the bot's highest role.
* The server owner can never be moderated by the bot.
* Plans expire, and only the requester can confirm them.
* Three or more destructive actions in one plan need **two** confirmations.
