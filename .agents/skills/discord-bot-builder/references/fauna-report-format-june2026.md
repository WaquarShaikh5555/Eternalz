# Fauna Report Format (June 2026)

## User Preference
Don gets TWO deliverables from the daily fauna cron — they serve different purposes:

### Email (detailed)
- Sent to donzzzilla@gmail.com via himalaya
- 3 animals: one spider, one snake, one creepy-crawly
- Each animal: common name, Latin name, 3 facts, BOA/GoT tactical connection
- Fun tone — field guide meets military briefing

**Himalaya send method (verified June 2026):**
```bash
# Step 1: Compose email to temp file (include From/To/Subject headers)
cat > /tmp/fauna_email.txt << 'EOF'
From: you@gmail.com
To: donzzzilla@gmail.com
Subject: BOA Fauna Intel Report
Content-Type: text/plain; charset=utf-8

Email body here...
EOF

# Step 2: Pipe via stdin (NEVER pass as argument — that panics)
cat /tmp/fauna_email.txt | himalaya message send --
```
The `--` after `send` is required. Passing the message as a command-line argument causes an index-out-of-bounds panic. Piping via stdin works correctly.

### Discord (lean)
- Just common name + YouTube search link per animal
- NO detailed facts (Don already gets the email)
- Format per animal: emoji + **Common Name** + YouTube search URL
- All 3 animals in one short message

## No Repeats Rule
Track previously shared animals in `/home/donzzz/.hermes/fauna_history.json`.
Each run MUST pick 3 animals NOT already in the list. All 3 must be new.
After posting, append the 3 new names to the file.

## History File
Path: `/home/donzzz/.hermes/fauna_history.json`
Format: `{"animals": ["common name lowercase", ...], "dates": [{"animal": "name", "date": "YYYY-MM-DD"}, ...], "last_updated": "YYYY-MM-DD"}`
Seeded with 7 animals from runs before June 7 2026.

## Discord Posting
Channel: 1511481703724486719 (#fauna-recon)
Use Python `requests` or `curl` via subprocess. Read token from `~/.hermes/hermes-agent/.discord_bot_token`.
(Write token to temp file first since write_file strips secrets.)
