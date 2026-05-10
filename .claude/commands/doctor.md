---
description: Diagnose what's wrong — runs the same probes as the HealthBanner, reports cleanly, makes no changes.
---

You are running a **read-only** diagnostic against UGC Studio. Don't install anything, don't write any files. Just check the state of the world and report.

## What to check

1. Is the dev server running? `lsof -i :8787 -P -n 2>/dev/null` and `lsof -i :5173 -P -n 2>/dev/null`. If it is, hit `curl -s http://localhost:8787/api/health` for the authoritative answer. If not, do the probes locally.

2. Required binaries on PATH:
   - `ffmpeg -version`
   - `ffprobe -version`

3. ffmpeg drawtext filter: `ffmpeg -hide_banner -filters | grep -q drawtext` — required for burned-in captions. If missing, the fix is `brew tap homebrew-ffmpeg/ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype`.

4. LLM path:
   - `claude --version` (subscription LLM)
   - `echo "${ANTHROPIC_API_KEY:-unset}"` — direct API key
   - At least one is needed for grounded scripts; without either, `/api/script` falls back to a template.

5. HeyGen render path:
   - `heygen --version` (CLI installed)
   - `echo "${HEYGEN_API_KEY:-unset}"` (authed)
   - Both are needed for avatar renders.

6. PostHog path:
   - `python3 --version`
   - `echo "${POSTHOG_PROJECT_API_KEY:-unset}"`
   - Without these, `/api/posthog` runs in stub mode (canned journeys).

7. Recorder repo:
   - Default at `$HOME/Documents/code/Nadir/getnadir.dev/marketing/demo-recorder/scripts/record.mjs` (or wherever `RECORDER_DIR` points).
   - Without it, page-beat renders fail; avatar-only still works.

## How to report

Group findings by severity:

```
Required (renders break without these)
  ✓ ffmpeg     8.1
  ✓ ffprobe    8.1

Recommended (LLM script generation)
  ✓ claude CLI authenticated via subscription

Optional (full feature set)
  ✗ HEYGEN_API_KEY not set     → avatar beats won't render
  ○ ffmpeg drawtext missing    → captions skipped (fix: brew tap homebrew-ffmpeg/ffmpeg)
  ○ POSTHOG_PROJECT_API_KEY    → /api/posthog runs in stub mode
  ✗ RECORDER_DIR not found     → page beats won't render

Action
  Run /install-ffmpeg to enable captions, or /setup if you want a guided walkthrough.
```

Use ✓ working, ✗ broken, ○ degraded. Lead with what's required. End with one concrete next action — don't dump every possible fix.

If everything is green, say so in one line and don't pad it out.
