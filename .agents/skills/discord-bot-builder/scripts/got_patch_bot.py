#!/usr/bin/env python3
"""
GoT Patch Monitor Bot
- Watches #patches on GoT Discord for new patch notes
- Scrapes Meta store for current build/version number
- Posts formatted update to #got_updates on Zzzilla Island
"""

import discord
import asyncio
import re
import json
import os
from datetime import datetime

# Config
TOKEN_PATH="/hom...PATH = "/home/donzzz/.hermes/got_patch_state.json"
PATCHES_CHANNEL_ID = 1154491115261669407
GOT_UPDATES_CHANNEL_ID = 1511246958868693012
META_STORE_URL = "https://www.meta.com/en-gb/experiences/ghosts-of-tabor/7614022262006379/"

with open(TOKEN_PATH) as f:
    TOKEN=f.read().strip()

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

def load_state():
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"last_patch_id": None, "last_build": None, "last_check": None}

def save_state(state):
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)

async def get_meta_build_number():
    import urllib.request
    try:
        req = urllib.request.Request(META_STORE_URL, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        for p in [r'"version"\s*:\s*"([^"]+)"', r'"softwareVersion"\s*:\s*"([^"]+)"',
                  r'Version\s*([\d]+\.[\d]+\.[\d]+\.[\d]+)', r'Build\s*([\d]+\.[\d]+\.[\d]+\.[\d]+)']:
            m = re.search(p, html)
            if m: return m.group(1)
        ld = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
        if ld:
            try:
                data = json.loads(ld.group(1))
                if isinstance(data, dict):
                    return data.get("softwareVersion") or data.get("version")
            except: pass
    except Exception as e:
        print(f"Scrape error: {e}")
    return None

def format_patch_embed(message, build_number):
    embed = discord.Embed(
        title="Ghosts of Tabor - Patch Update",
        url=message.jump_url, color=0x00ff00, timestamp=message.created_at
    )
    content = message.content[:3997] + "..." if len(message.content) > 4000 else message.content
    embed.description = content
    if build_number:
        embed.add_field(name="Build", value=f"`{build_number}`", inline=True)
    embed.add_field(name="Source", value=f"[GoT Discord #patches]({message.jump_url})", inline=True)
    if message.attachments:
        imgs = [a.url for a in message.attachments if a.content_type and a.content_type.startswith("image/")]
        if imgs:
            embed.set_image(url=imgs[0])
    embed.set_footer(text="GoT Patch Monitor - OWL")
    return embed

async def check_recent_patches():
    patches_ch = client.get_channel(PATCHES_CHANNEL_ID)
    got_ch = client.get_channel(GOT_UPDATES_CHANNEL_ID)
    if not patches_ch or not got_ch:
        print(f"Channels not accessible yet - will retry on next cycle")
        return
    state = load_state()
    try:
        messages = []
        async for msg in patches_ch.history(limit=10):
            if not msg.author.bot:
                messages.append(msg)
        messages.reverse()
        for msg in messages:
            if str(msg.id) == state.get("last_patch_id"):
                continue
            build = await get_meta_build_number()
            embed = format_patch_embed(msg, build)
            try:
                await got_ch.send(embed=embed)
            except Exception as e:
                print(f"Error: {e}")
            state["last_patch_id"] = str(msg.id)
            state["last_build"] = build
            state["last_check"] = datetime.now().isoformat()
            save_state(state)
    except Exception as e:
        print(f"Error: {e}")

@client.event
async def on_ready():
    print(f"Bot ready: {client.user.name}")
    for guild in client.guilds:
        print(f"  {guild.name}")
    await check_recent_patches()

@client.event
async def on_message(message):
    if message.channel.id != PATCHES_CHANNEL_ID or message.author.bot:
        return
    if not message.content and not message.attachments:
        return
    state = load_state()
    if str(message.id) == state.get("last_patch_id"):
        return
    build = await get_meta_build_number()
    embed = format_patch_embed(message, build)
    got_ch = client.get_channel(GOT_UPDATES_CHANNEL_ID)
    if got_ch:
        try:
            await got_ch.send(embed=embed)
        except Exception as e:
            print(f"Error: {e}")
    state["last_patch_id"] = str(message.id)
    state["last_build"] = build
    state["last_check"] = datetime.now().isoformat()
    save_state(state)

if __name__ == "__main__":
    print("Starting GoT Patch Monitor Bot...")
    client.run(TOKEN)
