---
name: Bug report
about: Something is broken or behaves unexpectedly
labels: bug
---

## What happened

<!-- A clear description of the bug -->

## What you expected

<!-- What should have happened instead -->

## Steps to reproduce

1.
2.
3.

## Health probe output

Run `curl -s http://localhost:8787/api/health | jq` (or visit `/api/health` in the browser) and paste the result. This tells us which binaries / env vars are configured.

```json

```

## Server logs

The dev server tees subprocess stderr — paste the **full** stack from the failing render or request, not a screenshot. Trailing 30 lines is usually enough.

```

```

## Environment

- OS:
- Node version (`node -v`):
- ffmpeg version (`ffmpeg -version | head -1`):
- Browser (if UI bug):
