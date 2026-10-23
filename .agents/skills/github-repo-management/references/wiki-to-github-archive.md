# Wiki-to-GitHub Archive — Process Notes

## Why Archive a Wiki to GitHub?

- **Disaster recovery**: If the Miraheze wiki goes down, content is preserved
- **Offline access**: Users can clone and read locally
- **Version control**: Track changes to wiki content over time
- **Community PRs**: Users can submit improvements via GitHub PRs

## Proven Workflow (BOA Wiki, May 2026)

1. **Scrape via API** using `execute_code` + `requests`
2. **Convert wikitext to Markdown** (headers, links, bold/italic, strip categories/HTML)
3. **Organize into directories** by content type
4. **Add per-page headers** with source URL and page ID
5. **Include README, index, Discord guide, hosting guide**
6. **Push to GitHub** using credential helper (NOT token-in-URL)

## Gotchas

- `write_file` corrupts `***` (markdown parsing) — never write raw PATs through it
- Token-in-URL fails on modern GitHub — use credential.helper store
- Miraheze redirect pages have < 100 chars — detect during conversion
- Pagination: `continue.apfrom` (title string) for `list=allpages`
