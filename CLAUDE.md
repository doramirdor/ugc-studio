# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — runs Vite (UI on :5173) and the Express server (`server/server.mjs` on :8787) concurrently with `--watch`. Vite proxies `/api/*` and `/videos/*` to the server.
- `npm run server` — Express only. `RECORDER_DIR=/path` overrides the recorder location; `PORT=9000` changes the server port.
- `npm run build` — `tsc && vite build`. There is no test runner and no linter configured.
- `npm run preview` — serves the built `dist/`.

## Onboarding via slash commands

Project-level slash commands live in `.claude/commands/`. They're the official "how a new contributor gets set up" path — prefer them over walking the user through manual steps:

- `/setup` — guided full install (binaries, env, recorder repo, verify via `/api/health`)
- `/doctor` — read-only diagnostic; mirrors the HealthBanner's checks
- `/dev` — boot the dev servers and confirm they're up
- `/install-ffmpeg` — fix the drawtext-missing gotcha (Homebrew default ships without libfreetype)

**When a new user joins, point them at `/setup` rather than describing the install in chat.** When you see a HealthBanner advisory in screenshots, suggest the matching slash command (`/install-ffmpeg` for drawtext, `/doctor` for everything else).

## External dependencies

The Express server shells out to tools that must exist on the host: `ffmpeg`, `ffprobe`, `python3`, and (for avatar scenes) the `heygen` CLI. It also assumes the [posthog-demo-recorder](https://github.com/heygen-com/skills) repo is checked out at `~/Documents/code/Nadir/getnadir.dev/marketing/demo-recorder` (override with `RECORDER_DIR`). All scene/final MP4s are written to `$RECORDER_DIR/videos/` and served from there. `GET /api/health` actively probes each binary + the recorder dir + relevant env vars; the UI's `HealthBanner` polls it on load and surfaces missing pieces.

If `POSTHOG_PROJECT_API_KEY` is unset, `/api/posthog` returns a stubbed journey list.

`/api/script` picks one of three paths in this order: (1) `ANTHROPIC_API_KEY` → direct API call to Claude Sonnet 4.6 with `submit_script` tool to enforce the JSON shape; (2) `claude` CLI on PATH → shell out to `claude -p --max-turns 1 --disallowedTools '*'` running in `os.tmpdir()` (so it doesn't pick up local CLAUDE.md/hooks/MCP), which uses the user's Claude Code subscription auth; (3) neither → hardcoded 6-beat template. Both LLM paths share the same prompt (`buildScriptPrompt`) and re-validate every beat through `sanitizeBeat` before returning. Disable the CLI path with `UGC_USE_CLAUDE_CLI=false`. Override grounding with `PRODUCT_PACK_PATH`. Response includes `mode: 'llm-api' | 'llm-cli' | 'template'` so the UI can badge it.

## Architecture

The app is a node-graph editor for a render pipeline: PostHog sessions → script → per-scene render → concat to final MP4. Two pieces:

**Frontend (`src/`)** — React 18 + Vite + TypeScript, using `@xyflow/react` for the canvas, Framer Motion for status pulses, and Zustand (with `persist` middleware, key `ugc-graph`) for the graph. Entry: `src/main.tsx` → `App.tsx` → `flow/GraphCanvas.tsx`.

**Backend (`server/server.mjs`)** — single Express file. Endpoints: `/api/posthog`, `/api/script`, `/api/render-scene`, `/api/concat`, `/api/health`. Each shells out via `spawn` with `cwd: RECORDER_DIR` and streams stdout/stderr.

### Graph growth model (important)

The canvas does **not** start with all nodes. It starts with one `sourceNode` and grows as each node's action succeeds:

1. `SourceNode.pull()` succeeds → spawns `scriptNode` + edge `source → script`.
2. `ScriptNode.generate()` succeeds → spawns one `sceneNode` per beat, plus a single `concatNode`, with edges `script → scene-*` and `scene-* → concat`. Re-running replaces existing scene/concat nodes (filter by `id.startsWith('scene-')`).
3. Each `SceneNode` runs independently; `ConcatNode` collects their `videoUrl`s and calls `/api/concat`.

`GraphCanvas` watches `nodes.length` and re-runs `fitView` so the camera follows the leaf as the tree grows rightward. Layout is computed from sibling count and the parent's `y` (see `spawnSceneNodes` in [src/flow/nodes/ScriptNode.tsx](src/flow/nodes/ScriptNode.tsx)). All node mutations must use the **functional** form of `setNodes`/`setEdges` — closures hold stale arrays because `patchNode` runs first.

### Store contract

`src/store.ts` defines per-node-type data shapes (`SourceData`, `ScriptData`, `SceneData`, `ConcatData`) all sharing a `status: 'idle' | 'running' | 'done' | 'error'` field that drives the border color and pulse in `_base.tsx`. The store persists `nodes` + `edges` to localStorage; `onRehydrateStorage` flips any persisted `running` status back to `idle` so a reload mid-render doesn't leave a node spinning forever. Bump `version` in the persist config when changing node-data shapes.

### Render-scene branches

`/api/render-scene` has two code paths keyed by `beat.kind`:

- **`avatar`** — pipes JSON to `heygen video create -d - --wait`, downloads the returned URL, then ffmpeg-crops landscape output to vertical 1080×1920.
- **`page`** — writes a one-beat script JSON, runs `node --env-file=.env scripts/record.mjs --script ... --no-narrate` inside `RECORDER_DIR`, then optionally muxes a HeyGen voice clip onto the silent recording (audio padded with `apad=whole_dur=...` to match video length).

Both branches normalize to 1080×1920 / 30fps / yuv420p / aac 48kHz so `/api/concat` can use a plain `concat` filter without re-encoding mismatches.

### Manual canvas: palette, asset uploads, merges

The canvas is no longer just the linear scene pipeline. Users drag from the [Palette](src/flow/Palette.tsx) (top-right ReactFlow panel) to spawn `assetNode` (image/audio/video) and `mergeNode` instances anywhere on the canvas. Drop coords convert to flow space via `screenToFlowPosition`. Manual edge connections (drag handle-to-handle) are wired through `onConnect` in [GraphCanvas](src/flow/GraphCanvas.tsx).

`POST /api/upload-asset?kind=image|audio|video&name=foo.mp4` accepts a raw binary body via `express.raw()`, hashes the bytes (sha256, 16-char prefix), saves under `VIDEO_DIR/_asset-<kind>-<hash>.<ext>`, and returns a `/videos/<file>` URL the existing static handler serves. Identical uploads dedupe to the same file.

`POST /api/merge` runs a three-pass pipeline based on which inputs are present: concat (multi-video), image overlay (positioned/scaled per `imagePosition` ∈ tl/tr/bl/br/center and `imageScale` ∈ [0.05, 1.0]), audio replace or mix. Each pass writes an intermediate file in VIDEO_DIR; intermediates are cleaned on success and on failure. **All paths flow through `resolveInVideoDir()` for sandboxing** — copy that helper if you add another endpoint that takes a `/videos/*` URL.

The MergeNode reorders inputs via HTML5 drag-and-drop on the list items inside the node. xyflow's node-drag is suppressed via the `nodrag` className on the list and on each form control, so dragging an input row doesn't move the merge node itself. The order is persisted on `MergeData.inputOrder` and reconciled with the live edge set on every render (saved order kept for surviving ids; new edges append).

### Save / Load + persist versioning

The header's Save button exports `{version, exportedAt, nodes, edges}` as a downloadable JSON. Load parses, does a minimal shape check (arrays present), confirms with the user if the file's version is newer than `PROJECT_FORMAT_VERSION` in [App.tsx](src/App.tsx), then replaces state. The same store is also auto-persisted to `localStorage` under the `ugc-graph` key with a `version` field — that's a separate concern from the user-facing project format. **When you change `Node.data` shapes, bump the persist version in [src/store.ts](src/store.ts) and add a migrate branch.** Currently at v4 (history: v1 init, v2 added optional ScriptData/SceneData fields, v3 split output into its own node and stripped legacy scene→concat edges, v4 added MergeData controls — no-op).

### URL ↔ path convention

The server returns scene/final videos as `/videos/<basename>` URLs. `/api/concat` reverses this by stripping the `/videos/` prefix and joining against `VIDEO_DIR` — when adding new endpoints that accept video references, follow the same convention so URLs stay portable across host/port changes. `/api/concat` also asserts that the resolved path's `dirname` equals `VIDEO_DIR`, so traversal-style scene URLs are rejected before ffmpeg sees them.

### HeyGen library proxy

`/api/heygen/avatars` and `/api/heygen/voices` proxy HeyGen's v2 API on the server side (so `HEYGEN_API_KEY` never reaches the browser) with a 1h in-memory cache. Each slot has an `inflight` promise so concurrent requests coalesce into a single upstream call. If `HEYGEN_API_KEY` is missing the endpoints return 503; the UI's [`HeyGenPicker`](src/flow/HeyGenPicker.tsx) catches that and degrades to a free-text input. On the client, `fetchAvatars()` / `fetchVoices()` in [src/api/client.ts](src/api/client.ts) memoize the promise so 6 simultaneously-mounted Scene nodes share one network call. **If you add a new picker site, reuse `HeyGenPicker` rather than fetching directly** — otherwise you'll lose the dedup.

### Captions and the drawtext gotcha

Caption burn-in uses ffmpeg's `drawtext` filter, which requires libfreetype. Homebrew's default `ffmpeg` formula omits it. The server probes `ffmpeg -filters` at boot and on every `/api/health` call; if `drawtext` is missing, `captionFilter()` returns `null` and renders proceed without captions. Both render branches (`renderAvatarBeat` and `renderPageBeat`) explicitly handle a null filter — never pass an empty `-vf` arg, that would error. The HealthBanner in the UI surfaces the missing filter with the `homebrew-ffmpeg/ffmpeg` tap install command.

### Idempotency cache

Every scene render is keyed by `sha256` over the content-bearing fields of the beat (`kind`, `narration`, `caption`, `page`, `avatarId`, `voiceId` — `title` is excluded since it's UI-only). The hash becomes part of the output filename (`scenes-ugc-<id>-<hash>.mp4`) and the mapping is persisted to `$VIDEO_DIR/.scene-cache.json`. Cache hits short-circuit the whole render pipeline and return `{cached: true}`. **When adding new fields that affect render output, also add them to `hashBeat()` in [server/server.mjs](server/server.mjs) — otherwise the cache will return stale content.**

### Input sanitization boundary

All endpoint inputs flow through `sanitizeBeat` / `sanitizeSince` / `sanitizeJourney` before they're spawned, fetched, or written to disk. `beat.id` must match `^[a-zA-Z0-9_-]{1,32}$` (used in filenames), `beat.page` must match `^/...` with no `..`, `avatarId`/`voiceId` must be hex. **Never bypass these helpers** — `beat.narration` flows into `heygen --text` argv and `beat.page` is consumed by Playwright in `record.mjs`. The /api/concat handler additionally asserts each input path's `dirname` equals `VIDEO_DIR`.
