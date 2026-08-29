#!/usr/bin/env python3
"""
YouTube uploader for wcrew demo — uses YouTube Data API v3.

Usage:
  pip install google-api-python-client google-auth-oauthlib
  python tools/youtube_upload.py --file docs/wcrew-demo-2m44.mp4 --thumbnail docs/wcrew-thumb.jpg

First run opens a browser for OAuth (requires a Google Cloud project with YouTube Data API enabled).
Credentials are cached to /tmp/youtube_token.json. Subsequent runs reuse it.
If you already have a client_secrets.json, put it at /tmp/client_secrets.json or pass --secrets.
If you don't have OAuth set up, just drag-drop the mp4 into https://studio.youtube.com/ — that's 30s and works fine.
"""
import argparse, os, sys, json, pathlib

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
DEFAULT_TITLE = "wcrew — shift roster co-pilot | WebMCP Challenge Demo (2:44)"
DEFAULT_DESC = """wcrew is an agent-ready shift scheduler where a café manager and a browser agent fix next week’s roster together.

Live demo: https://wcrew.pages.dev
Repo (MIT): https://github.com/PhiBao/wcrew

Why WebMCP?
Independent shops juggle 8 constraints at once — skills, availability, minors’ curfew, 11h rest, 10h/day, 5 consecutive days, lead coverage, overtime 1.5×, preferences, and a $5,200 budget. Without tools an agent guesses through a dense grid. With WebMCP it calls structured tools on your live, authenticated tab — every change is observable, attributable, and undoable.

15 tools on document.modelContext:
Read-only: get_roster, list_staff, list_shifts, check_compliance, get_coverage, get_cost_breakdown, explain_assignment, suggest_swaps
Mutating (actor:agent, undoable, some gated on confirm modal): assign_shift, auto_fill (dry_run honest preview), publish_roster, reset_week, undo/redo, export_roster (CSV/ICS)

Trust contract:
• Same pure engine (evaluateAssignment) for explain & do — never diverge
• Deterministic auto-fill (greedy hardest-shift-first + repair) with 3 strategies
• Injection canary (Inés’s note) wrapped in BEGIN/END UNTRUSTED delimiters
• Origin-Agent-Cluster: ?1 + Permissions-Policy: tools=(self) + navigator fallback

Try it: Chrome 149 → chrome://flags/#enable-webmcp-testing + Model Context Tool Inspector, or ChatGPT in-app browser.

Build: pnpm dev → https://wcrew.pages.dev | pnpm verify (20 tests) | pnpm engine:test

Chapters:
00:00 Intro — wcrew + Sunday-night roster pain
00:10 Eight constraints, human×agent better together
00:29 WebMCP — 15 typed tools, live session, trust contract
00:47 Tour — 39 shifts, 10 staff, board/panels
01:10 Seeded errors, agent calls check_compliance → suggest_swaps → explain_assignment
01:32 auto_fill dry_run → “proposed by agent” preview (honest, same code path)
01:55 Apply re-plans live, one-undo, locked respected
02:05 Publish gates on zero errors + confirm modal, export
02:16 Security & headers
02:31 Outro — live URL + repo

#WebMCP #OpenAI #Chrome #Hackathon
"""

def upload(args):
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        import pickle
    except ImportError:
        print("Missing deps. Run: pip install google-api-python-client google-auth-oauthlib")
        sys.exit(1)

    secrets = args.secrets or "/tmp/client_secrets.json"
    token_path = "/tmp/youtube_token.json"
    if not os.path.exists(secrets):
        print(f"No {secrets} found.")
        print("Create OAuth client at https://console.cloud.google.com/apis/credentials → Create Credentials → OAuth client ID → Desktop, download JSON to /tmp/client_secrets.json")
        print("Or just manually upload via https://studio.youtube.com/ — drag docs/wcrew-demo-2m44.mp4, paste title/desc below, set Public, publish.")
        print("\n--- TITLE ---\n" + (args.title or DEFAULT_TITLE))
        print("\n--- DESCRIPTION ---\n" + (args.description or DEFAULT_DESC))
        print(f"\nTags: {args.tags}")
        sys.exit(0)

    creds = None
    if os.path.exists(token_path):
        import google.oauth2.credentials
        with open(token_path) as f:
            data = json.load(f)
            creds = google.oauth2.credentials.Credentials.from_authorized_user_info(data, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(secrets, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    youtube = build("youtube", "v3", credentials=creds)
    body = {
        "snippet": {
            "title": args.title or DEFAULT_TITLE,
            "description": args.description or DEFAULT_DESC,
            "tags": (args.tags or "WebMCP,AI agent,Chrome,OpenAI,hackathon,shift scheduler,roster").split(","),
            "categoryId": "28" # Science & Technology
        },
        "status": {"privacyStatus": args.privacy, "selfDeclaredMadeForKids": False}
    }
    media = MediaFileUpload(args.file, chunksize=-1, resumable=True)
    req = youtube.videos().insert(part=','.join(body.keys()), body=body, media_body=media)
    print(f"Uploading {args.file} ...")
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
        if status: print(f"  {int(status.progress()*100)}%")
    vid = resp["id"]
    url = f"https://www.youtube.com/watch?v={vid}"
    print(f"Done: {url}")
    if args.thumbnail and os.path.exists(args.thumbnail):
        youtube.thumbnails().set(videoId=vid, media_body=MediaFileUpload(args.thumbnail)).execute()
        print(f"Thumbnail set: {args.thumbnail}")
    # captions
    srt = args.captions
    if srt and os.path.exists(srt):
        youtube.captions().insert(
            part="snippet",
            body={"snippet": {"videoId": vid, "language": "en", "name": "English", "isDraft": False}},
            media_body=MediaFileUpload(srt)
        ).execute()
        print(f"Captions uploaded: {srt}")
    # write url for convenience
    pathlib.Path("/tmp/youtube_url.txt").write_text(url)
    print(f"Saved URL to /tmp/youtube_url.txt and needs to be added to README Demo section.")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--file", default="docs/wcrew-demo-2m44.mp4")
    p.add_argument("--thumbnail", default="docs/wcrew-thumb.jpg")
    p.add_argument("--captions", default="/tmp/wcrew-video/out/combined.srt")
    p.add_argument("--secrets", default=None)
    p.add_argument("--title", default=None)
    p.add_argument("--description", default=None)
    p.add_argument("--tags", default=None)
    p.add_argument("--privacy", default="public", choices=["public","unlisted","private"])
    args = p.parse_args()
    upload(args)
