# Contributing to UGC Studio

Thanks for your interest. This is a small, opinionated project — the bar for accepting changes is "does it make the demo path better, or does it remove sharp edges for the next contributor?"

## Local setup

```bash
git clone https://github.com/doramirdor/ugc-studio.git
cd ugc-studio
npm install
npm run dev
```

Two ports come up:
- Vite UI on `:5173`
- Express API on `:8787`

`http://localhost:5173` is the canvas. The HealthBanner at the top tells you exactly what you need to install or set in env to unlock features. **Stub mode works without any keys** — `/api/posthog` returns canned journeys and `/api/script` falls back to a hardcoded template. So you can develop UI changes without touching HeyGen, PostHog, or Claude.

## Verifying changes

```bash
npm run typecheck    # tsc --noEmit
npm run build        # tsc && vite build
```

There is intentionally no test suite yet. If you're adding logic that benefits from tests (e.g., the merge pipeline filter math, the input-order reconciliation), feel free to introduce one — Vitest is the right choice and we'll add it on first PR that needs it.

For changes that touch the UI, **start the dev server and exercise the feature in a browser.** Type-checking proves the code compiles, not that it does the right thing.

## Working with the recorder

The browser-recording branch (`beat.kind === 'page'`) shells out to `record.mjs` in [posthog-demo-recorder](https://github.com/heygen-com/skills). If you don't have that repo checked out, page beats won't render — but avatar beats and the merge/asset features all work without it. `RECORDER_DIR` env var overrides the path.

## What we're looking for

- **Bug fixes** to the rendering pipeline, especially the recorder integration. The Playwright→ffmpeg race in `record.mjs` is upstream but we mitigate here with auto-retry; better fixes welcome.
- **New merge modes** in [`/api/merge`](server/server.mjs) — the three-pass pipeline (concat → image overlay → audio) is extensible. Picture-in-picture, time-windowed overlays, audio gain, etc. are all natural additions.
- **Better script grounding** — the LLM currently gets a markdown product pack via `PRODUCT_PACK_PATH`. Better extraction from real PostHog session data (page copy, button text, dwell heuristics) would meaningfully improve script quality.
- **Eval harness** for script generation — see the original AI design notes for the recommended lint → judge → human loop.

## What we're not looking for

- Refactors that move code around without changing behavior. The codebase has a deliberate flat shape; restructuring without a concrete user benefit will get pushed back.
- Adding heavy dependencies. The current set (React, xyflow, framer-motion, zustand, express) is the bar — adding things like state-management libraries, UI kits, or test frameworks needs a strong rationale.
- Backend logic written in TypeScript. The server is intentionally one `.mjs` file for portability; keep it that way unless there's a reason.

## Pull requests

- Keep PRs small and single-purpose. A 200-line PR with one clear change is easier to review than a 50-line PR that touches three concerns.
- Update [CLAUDE.md](CLAUDE.md) when you change architectural shape — that file is the primary onboarding doc for both humans and agents.
- Update the [README](README.md) feature list when you add a user-visible capability.
- Run `npm run build` before pushing.
- The maintainer reviews when they can — be patient.

## Reporting bugs / requesting features

Use the GitHub issue templates. For bugs, please include the output of `curl http://localhost:8787/api/health` and the **full** stderr from any failed render — the dev server tees subprocess output, so it's already in your terminal.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
