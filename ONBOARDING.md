# UGC Studio — Onboarding

Visual node-graph editor that turns PostHog sessions into stitched MP4 ads:
PostHog → script → per-scene render (HeyGen avatar or page recording) → concat → final MP4.

This guide gets a teammate from clone to a rendered video locally.

## 1. Prereqs

- **Node ≥ 20** (see `.nvmrc`)
- **ffmpeg + ffprobe** on PATH. For burned-in captions, ffmpeg must include the `drawtext` filter (libfreetype). Homebrew's default formula omits it — use the tap version:
  ```bash
  brew tap homebrew-ffmpeg/ffmpeg
  brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype
  ```
  Without `drawtext`, renders still work but ship without captions and the in-app HealthBanner says so.
- **python3** on PATH (used by recorder helpers).
- **The recorder repo cloned.** Default location: `~/Documents/code/Nadir/getnadir.dev/marketing/demo-recorder`. Override with `RECORDER_DIR=/your/path`.
- **HeyGen CLI** (optional but needed for avatar scenes):
  ```bash
  curl -fsSL https://static.heygen.ai/cli/install.sh | bash
  echo "$HEYGEN_API_KEY" | heygen auth login
  ```

## 2. Install + run

```bash
npm install
npm run dev
```

- UI: http://localhost:5173 (Vite)
- API: http://localhost:8787 (Express, `server/server.mjs`)

Vite proxies `/api/*` and `/videos/*` to the Express server. The HealthBanner at the top of the canvas tells you exactly what's missing (binaries, env vars, recorder dir, drawtext filter).

**Zero-config preview:** with no env vars set, `/api/posthog` returns canned journeys and `/api/script` falls back to a hardcoded 6-beat template, so you can drive the canvas end-to-end without any keys.

## 3. Environment variables

Set what you need; leave the rest unset to use the fallback paths.

| Var | Effect |
|---|---|
| `RECORDER_DIR` | Path to `posthog-demo-recorder` checkout |
| `PORT` | Express port (default `8787`) |
| `ANTHROPIC_API_KEY` | If set, `/api/script` calls Claude Sonnet 4.6 directly |
| `ANTHROPIC_MODEL` | Override the API-path model (default `claude-sonnet-4-6`) |
| `UGC_USE_CLAUDE_CLI` | `false` to disable the `claude` CLI fallback |
| `PRODUCT_PACK_PATH` | Markdown file used as system-prompt grounding for scripts |
| `POSTHOG_PROJECT_API_KEY` | Unset → `/api/posthog` runs in stub mode |
| `HEYGEN_API_KEY` | Required for avatar renders + page-beat narration |
| `HEYGEN_VOICE_ID` | Default voice id (overridable per beat) |
| `UGC_AUTH_TOKEN` | If set, `/api/*` and `/videos/*` require `Authorization: Bearer <token>` |

## 4. How the canvas works

The graph is **not** pre-built — it grows as nodes succeed:

1. `SourceNode.pull()` ✅ → spawns `scriptNode` + edge.
2. `ScriptNode.generate()` ✅ → spawns one `sceneNode` per beat plus a `concatNode`. Re-running replaces scene/concat nodes.
3. Each `SceneNode` runs independently. `ConcatNode` collects scene `videoUrl`s and calls `/api/concat`.

You can also drag from the **Palette** (top-right) to spawn manual `assetNode` (image/audio/video) or `mergeNode` instances and wire them up by hand.

State lives in `src/store.ts` (Zustand + persist, localStorage key `ugc-graph`). Bump the persist version when you change node-data shapes.

## 5. Script generation modes

In preference order:

1. `ANTHROPIC_API_KEY` set → direct API → Claude Sonnet 4.6 with `submit_script` tool-use.
2. `claude` CLI on PATH → `claude -p --max-turns 1 --disallowedTools '*'` (uses your Claude Code subscription, ~10s).
3. Neither → hardcoded 6-beat template.

The Script node badges which mode produced the current script.

## 6. Render branches

`/api/render-scene` keys off `beat.kind`:

- **`avatar`** — pipes JSON to `heygen video create -d - --wait`, downloads, ffmpeg-crops to vertical 1080×1920.
- **`page`** — runs `node --env-file=.env scripts/record.mjs --script ... --no-narrate` inside `RECORDER_DIR`, then optionally muxes a HeyGen voice clip onto the silent recording.

Both normalize to **1080×1920 / 30fps / yuv420p / aac 48kHz** so `/api/concat` can stitch without re-encoding.

## 7. Caching

Scene renders are keyed by `sha256` over content-bearing fields of the beat (kind, narration, caption, page, avatarId, voiceId — `title` excluded). Hash → filename and to `$VIDEO_DIR/.scene-cache.json`. **If you add a new beat field that affects output, also add it to `hashBeat()` in `server/server.mjs` or you'll serve stale renders.**

## 8. Security boundaries (read this before touching the server)

- All endpoint inputs flow through `sanitizeBeat` / `sanitizeSince` / `sanitizeJourney`. `beat.id` must match `^[a-zA-Z0-9_-]{1,32}$`, `beat.page` must start with `/` and have no `..`, `avatarId`/`voiceId` must be hex. **Do not bypass these helpers.** `beat.narration` flows into `heygen --text` argv; `beat.page` is consumed by Playwright.
- All `/videos/*` URLs flow through `resolveInVideoDir()` for sandboxing. `/api/concat` and `/api/merge` both assert resolved paths' `dirname` equals `VIDEO_DIR`. Copy `resolveInVideoDir()` if you add a new endpoint that takes a video URL.

## 9. Useful scripts

```bash
npm run dev        # Vite + Express together (recommended)
npm run server     # Express only
npm run build      # tsc && vite build
npm run typecheck  # tsc --noEmit
npm run preview    # serve dist/
```

There is **no test runner and no linter** configured.

## 10. Where things live

- `src/main.tsx` → `App.tsx` → `flow/GraphCanvas.tsx` — canvas entry
- `src/flow/nodes/*` — per-node UI + run actions
- `src/flow/Palette.tsx` — drag source for manual nodes
- `src/store.ts` — Zustand store + persist + migrations
- `src/api/client.ts` — typed fetchers (memoized for HeyGen library)
- `server/server.mjs` — every endpoint in one file

## 11. First task ideas

- Run `npm run dev`, click through Source → Script → Scene → Concat with no env vars. Watch the HealthBanner advice.
- Set `HEYGEN_API_KEY` + recorder env, render one avatar scene end-to-end.
- Drag an image asset onto the canvas, wire it into a Merge node, and overlay it on a finished scene.

## 12. Read next

- [README.md](README.md) — high-level overview + Phase 1 scope checklist
- [CLAUDE.md](CLAUDE.md) — architectural notes for working with Claude Code in this repo
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow conventions
