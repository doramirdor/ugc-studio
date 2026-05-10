---
description: Boot the dev server (Vite + Express) in the background, verify health, hand off the URL.
---

Start the UGC Studio dev environment.

## Procedure

1. Check if it's already running. `lsof -i :5173 -P -n 2>/dev/null` and `lsof -i :8787 -P -n 2>/dev/null`. If both are up, just hit `/api/health`, summarize, and tell the user to refresh http://localhost:5173. Don't double-launch.

2. If neither is running:
   - Run `npm run dev` in the **background** via the Bash tool's `run_in_background: true`. The output goes to a shell log; you'll be notified on exit.
   - Wait 3–5 seconds for both servers to come up. Don't poll in a tight loop — Vite + Express need a moment.

3. Probe `/api/health` and report the same compact summary as `/doctor`. Lead with what's working.

4. Hand off:
   - UI: http://localhost:5173
   - API: http://localhost:8787
   - Logs: tail with `BashOutput` on the background shell id you got back from step 2.

5. **Do not kill the background process at the end** — the user wants it running. Just leave it.

If the user wants to stop it later, they can `lsof -i :5173` to find the PID and `kill` it, or just `Ctrl-C` in their terminal if `npm run dev` was started directly.
