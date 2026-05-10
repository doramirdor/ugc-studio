# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-06

Initial public release.

### Added

- Visual node-graph canvas (React Flow) with auto-spawning Source → Script → Scene → Output → Concat pipeline.
- LLM script generation via Claude Code subscription (`claude` CLI) or direct API key, falling back to a hardcoded 6-beat template when neither is configured.
- HeyGen avatar + voice library proxy (`/api/heygen/avatars`, `/api/heygen/voices`) with 1-hour TTL cache and graceful free-text fallback when `HEYGEN_API_KEY` is unset.
- Per-beat content-addressed render cache (SHA-256 of beat content) so re-clicks don't burn HeyGen credits.
- Drag-and-drop palette for image, audio, video, and merge nodes.
- Asset upload endpoint (`POST /api/upload-asset`) accepting raw binary with kind+name in query, hashed filenames, and 100MB cap.
- `POST /api/merge` three-pass pipeline (concat → image overlay → audio replace/mix) with positionable, scalable overlays.
- Drag-to-reorder merge inputs with persisted `inputOrder`.
- Project save/load as portable JSON.
- Real `/api/health` preflight probing every binary, env var, and the `drawtext` ffmpeg filter, surfaced through a dismissible HealthBanner.
- Optional bearer-token auth on every endpoint via `UGC_AUTH_TOKEN`.
- Burned-in captions via ffmpeg `drawtext`, with graceful skip + clear remediation when the filter is unavailable in the host's ffmpeg build.
- Auto-retry on transient recorder failures with live stderr streaming for debuggability.
- Input sanitization on every endpoint that touches `spawn`, `fetch`, or the filesystem.

[Unreleased]: https://github.com/doramirdor/ugc-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/doramirdor/ugc-studio/releases/tag/v0.1.0
