# YouTube upload — wcrew demo (2:44)

**Video:** `docs/wcrew-demo-2m44.mp4` (7.7 MB, 1920×1080, 2:44, burned subtitles, AAC audio)  
**Thumb:** `docs/wcrew-thumb.jpg` (1280×720)  
**Captions:** `/tmp/wcrew-video/out/combined.srt` (also `combined.vtt`)  
**Live demo:** https://wcrew.pages.dev · **Repo:** https://github.com/PhiBao/wcrew

## Option A — Manual (30 seconds, recommended for hackathon)

1. Open https://studio.youtube.com/ → **Create → Upload videos** → drag `docs/wcrew-demo-2m44.mp4`
2. Title (copy):
```
wcrew — shift roster co-pilot | WebMCP Challenge Demo (2:44)
```
3. Description — paste from `tools/youtube_upload.py` DEFAULT_DESC or below:

```
wcrew is an agent-ready shift scheduler where a café manager and a browser agent fix next week’s roster together.

Live demo: https://wcrew.pages.dev
Repo (MIT): https://github.com/PhiBao/wcrew

Why WebMCP? 8 constraints at once (skills, availability, minors’ curfew, 11h rest, 10h/day, 5 consecutive days, lead coverage, overtime 1.5×, preferences, $5,200 budget). Without tools an agent guesses the grid. With 15 typed tools on document.modelContext it acts inside your live, authenticated tab — every change is observable, attributable, undoable.

Tools: get_roster, list_staff, list_shifts, check_compliance, get_coverage, get_cost_breakdown, explain_assignment, suggest_swaps, assign_shift, auto_fill (dry_run honest), publish_roster, reset_week, undo/redo, export_roster.

Trust: same pure engine for explain & do, deterministic solver (hardest-shift-first + repair), untrusted note delimiters, Origin-Agent-Cluster: ?1 + Permissions-Policy.

Try: Chrome 149 → chrome://flags/#enable-webmcp-testing + Tool Inspector, or ChatGPT in-app browser.
```

4. Thumbnail → Upload thumbnail → pick `docs/wcrew-thumb.jpg`
5. Visibility → **Public** → Publish
6. Copy the `https://www.youtube.com/watch?v=...` URL → paste into `README.md` Demo section and Devpost submission.

## Option B — Automated via API

```bash
pip install google-api-python-client google-auth-oauthlib
# 1. Create OAuth client: https://console.cloud.google.com/apis/credentials → OAuth client ID → Desktop → download JSON → /tmp/client_secrets.json
# 2. Enable YouTube Data API v3 at https://console.cloud.google.com/apis/library/youtube.googleapis.com

python tools/youtube_upload.py --file docs/wcrew-demo-2m44.mp4 --thumbnail docs/wcrew-thumb.jpg --captions /tmp/wcrew-video/out/combined.srt --privacy public
# → prints https://www.youtube.com/watch?v=... and saves to /tmp/youtube_url.txt
```

## Verification

- <3 min ✓ (2:44)
- Public ✓ (set at upload)
- Audio covers what was built + how WebMCP was used ✓ (15 tools, trust contract, dry_run honest, injection canary, headers)
- Clear demo of live app + agent flow + code ✓
- License MIT, repo public, `document.modelContext.registerTool` snippet in `src/webmcp.js` ✓

## After YouTube is live

```bash
# update README
sed -i "s|> Replace with your YouTube link before submission.|> https://www.youtube.com/watch?v=YOUR_ID|" README.md
git add README.md && git commit -m "docs: add demo video" && git push
```

Checklist for Devpost submission:
- [ ] Working live URL: https://wcrew.pages.dev (verify `curl -I` shows Origin-Agent-Cluster + Permissions-Policy)
- [ ] Text description (Why WebMCP, better UX, what was impossible, how implemented)
- [ ] YouTube link (public, <3 min)
- [ ] Public repo URL with MIT LICENSE at top: https://github.com/PhiBao/wcrew
