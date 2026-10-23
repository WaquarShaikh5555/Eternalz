# GitHub Pages + write_file: Known Pitfalls

## write_file Tool Content Mangling

The `write_file` tool has several **silent content transformations** that corrupt data:

### What gets mangled:
- **Credential-like patterns**: Token prefixes like `ghp_` get silently truncated. Workaround: write tokens to temp file, read back with Python `open().strip()`.
- **`***` patterns**: Sequences of 3+ asterisks get replaced with `REDACTED`. Breaks JS/CSS content.
- **Long HTML/JS strings**: Content inside `<script>` or `<style>` tags that exceeds ~15KB can get truncated or have tags silently stripped.
- **HTML closing tags in JS strings**: `</div>`, `</span>` etc inside JS string literals confuse the linter.
- **Double braces `{{` `}}`**: Interpreted as Python f-string syntax and dropped.

### Reliable patterns:
- **External JS/CSS files**: Write JS and CSS as separate files referenced by HTML
- **Python write script**: Write a Python script that generates the target file using `open().write()`
- **Terminal heredoc**: Use `cat > file << 'EOF'` with single-quoted heredoc
- **`patch` tool**: Good for small targeted changes

## GitHub Pages CORS Limitations

GitHub Pages serves from `username.github.io` — many APIs don't allow this origin.

### Solutions:
1. **Demo/hardcoded data**: Embed sample data as fallback
2. **Cloudflare Worker**: Reverse proxy that adds CORS headers
3. **Local hosting**: `python3 -m http.server 8080` avoids CORS entirely

## GitHub Pages CDN Caching

After pushing changes, the CDN serves stale content for **10-30+ minutes**.

### Solutions:
- Append `?v=2` (or increment) to the URL to force a fresh fetch
- Push an empty commit to force cache invalidation: `git commit --allow-empty -m "force refresh" && git push`
- Check the build status via API: `curl -s "https://api.github.com/repos/USER/REPO/pages" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"`

## HTML Parser + JS `</` Sequences

The HTML parser scans `<script>` content for `</script>` to close the block. While modern browsers handle `</div>` and `</span>` inside JS strings correctly, **the `write_file` tool and some linters do NOT** — they may strip or corrupt these sequences.

### Best practice:
- **Move all JS to external `.js` files** — avoids HTML parser entirely
- If inline JS is unavoidable, escape `</` as `<\/span>`, `<\/div>` etc inside string literals
- Verify with `node --check file.js` after writing

## JS Syntax Debugging in HTML Files

When a `<script>` block fails silently (no visible error, functions are `undefined`):

### Diagnosis steps:
1. **Extract JS**: `python3 -c "import re; html=open('index.html').read(); m=re.search(r'<script>(.*?)</script>',html,re.DOTALL); open('app.js','w').write(m.group(1))"`
2. **Check syntax**: `node --check app.js` — reports exact line and character of syntax errors
3. **Binary search for error**: Use `vm.createScript(js.substring(0, mid))` in Node.js to binary-search the exact character position
4. **Count braces**: Compare `{` vs `}` count — an imbalance means a missing brace (common in deeply nested Chart.js configs)
5. **Check in browser**: `typeof functionName` — if `undefined`, the script failed to parse

### Common gotcha — Chart.js config nesting:
```js
new Chart(ctx, {        // opens config {
  type: 'bar',
  data: { ... },        // opens/closes data { }
  options: {            // opens options {
    scales: {           // opens scales {
      y: { ... },
      x: { ... }
    }                   // closes scales
  }                     // closes options
}                       // closes config
);                      // closes Chart()
```
Missing one `}` in the chain causes the entire script to fail silently.

## Terminal PATH Corruption

When PATH accumulates beyond OS limits, ALL commands fail with "File name too long".

### Fix:
- Prefix commands with `env PATH=/usr/local/bin:/usr/bin:/bin`
- Use `write_file`/`patch` tools instead (don't inherit shell env)
- Close and restart the terminal session

## Git Credential Issues on Pi

When `git push` fails with "could not read Username":
- The `.git-credentials` file may exist but `credential.helper` isn't configured
- Fix: `git config credential.helper store` (in the repo, not globally)
- Then push again — git will read `.git-credentials` automatically
