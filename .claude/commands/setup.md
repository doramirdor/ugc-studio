---
description: Guided onboarding — installs deps, sets up env, verifies the install end-to-end.
argument-hint: [--minimal | --skip-recorder]
---

You are the setup pilot for **UGC Studio**. A new contributor has just cloned this repo. Your job is to get them from `git clone` to a working `npm run dev` in under 10 minutes — without surprising them, without making them read a 200-line README, and without breaking anything that's already working.

## How to behave

- **Be efficient.** Run the probes, summarize, propose the next concrete action. Don't dump pages of explanation up front.
- **Ask before installing.** Anything that uses `brew install`, `git clone` outside the repo, or writes to a path under `~/` needs explicit confirmation.
- **Honour "skip".** Most pieces are optional. The user can run with stub-mode-only and add real keys later.
- **Use TodoWrite to track progress.** Six checks → six items → mark each `completed` or `skipped` as you go.
- **Don't repeat work.** If `node_modules/` exists, don't re-`npm install`. If `ffmpeg -version` works, don't suggest brew.

## Procedure

### 1. Sanity-check the project

Confirm we're in the right place: `package.json` should have `"name": "ugc-studio"`. If not, the user opened the wrong directory.

### 2. Node + project deps

- Run `node -v`. Require ≥ 20 (the `.nvmrc` says 22). If older, suggest `nvm install $(cat .nvmrc) && nvm use $(cat .nvmrc)`.
- If `node_modules/` is missing, run `npm install`.
- Run `npm run typecheck` (≈ 2s). If it fails, stop and surface the error — something's wrong with the clone.

### 3. Probe required binaries

Required (renders fail without these):
- `ffmpeg -version | head -1`
- `ffprobe -version | head -1`

Strongly recommended (LLM script generation):
- `claude --version` (uses Claude Code subscription, no API key needed)

For each missing required tool:
1. Tell the user what it's for in one sentence
2. Show the brew command (`brew install ffmpeg`)
3. **Ask** before running it

Optional binaries (probe quietly, only mention if missing AND the user is doing the full setup):
- `python3 --version` — needed for live PostHog query; without it, `/api/posthog` runs in stub mode (which is fine for demos)
- `heygen --version` — needed for avatar renders. Install with `curl -fsSL https://static.heygen.ai/cli/install.sh | bash` then `echo "$HEYGEN_API_KEY" | heygen auth login`. **Don't run that curl-pipe-bash without confirmation.**

### 4. Caption support: the drawtext gotcha

Run `ffmpeg -hide_banner -filters | grep -q drawtext`. If it fails, captions won't burn into renders. The fix:

```
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype
```

Tell the user, **ask** if they want to do it now, and honour skip — renders work without captions, the HealthBanner will keep nagging until they fix it.

### 5. Recorder repo (page-beat renders only)

If the user passed `--skip-recorder`, skip this section entirely.

The page-beat render path shells out to `record.mjs` in a sibling repo. Default expected location: `~/Documents/code/Nadir/getnadir.dev/marketing/demo-recorder`.

Check `[ -f "$HOME/Documents/code/Nadir/getnadir.dev/marketing/demo-recorder/scripts/record.mjs" ]`. If missing:

1. Explain that without the recorder, **avatar beats still work**, but page beats (browser screen-recordings) won't.
2. Offer two options:
   - **(a)** clone the recorder somewhere — ask where, default to `~/Documents/code/posthog-demo-recorder`, and tell them to set `RECORDER_DIR=<that path>` in their shell rc
   - **(b)** skip and run avatar-only

For now this is the only repo — you can clone with `git clone https://github.com/heygen-com/skills <path>`. Confirm with the user that this is the right URL before running.

### 6. Environment variables

The dev server reads env vars from the *user's shell* (and from the recorder's `.env`). For OSS users, the simplest path is:

- **Stub mode (no keys needed):** UI works, `/api/posthog` returns canned journeys, `/api/script` falls back to the hardcoded template. Just run `npm run dev`.
- **Subscription LLM scripts:** `claude` CLI authenticated via Claude Code (which the user is presumably using right now). No env var needed.
- **Avatar renders:** needs `HEYGEN_API_KEY` and `HEYGEN_VOICE_ID`. Tell the user to grab one at https://app.heygen.com/api-key and set it in `~/.zshrc` (or wherever).

If the recorder is set up, it has its own `.env` for `DEMO_BASE_URL` (the URL of the product to record). That's a separate concern — point them at the recorder repo's README.

### 7. Verify

Boot the server in the background and probe health:

```bash
node server/server.mjs > /tmp/ugc-server.log 2>&1 &
PID=$!
sleep 2
curl -s http://localhost:8787/api/health
kill $PID 2>/dev/null
```

Parse the JSON, then **report cleanly**:

```
Required:
  ✓ ffmpeg
  ✓ ffprobe
Optional (your render path narrows without these):
  ✗ heygen     — avatar renders disabled (skip if testing canvas only)
  ○ HEYGEN_API_KEY — set if you want avatars
Captions:
  ✗ ffmpeg drawtext — captions skipped, install homebrew-ffmpeg/ffmpeg if you need them
Script generation:
  → llm-cli (via Claude Code subscription)
```

Use ✓ for working, ✗ for required-missing, ○ for optional-missing. Be terse.

### 8. Hand off

Tell the user how to start the dev server: `npm run dev`. The UI is at http://localhost:5173. The HealthBanner at the top will repeat any advisories. Done.

If they want to keep tweaking, mention `/doctor` (re-run the health probe) and `/install-ffmpeg` (for the drawtext fix).
