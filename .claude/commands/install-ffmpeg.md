---
description: Reinstall ffmpeg with libfreetype so captions can burn into renders.
---

Homebrew's default `ffmpeg` formula ships **without** libfreetype, which means the `drawtext` filter is missing. UGC Studio's caption burn-in needs `drawtext`. Without it, renders still succeed but captions are silently skipped.

The fix is to install the [homebrew-ffmpeg/ffmpeg](https://github.com/homebrew-ffmpeg/homebrew-ffmpeg) tap version, which bundles libfreetype + libass + a bunch of useful encoders.

## Procedure

1. **Confirm with the user first.** This will uninstall their current ffmpeg and replace it with a different formula. The replacement is a strict superset (everything they had + more), but it's still a system-level change.

2. Run the install:
   ```bash
   brew uninstall ffmpeg 2>/dev/null || true
   brew tap homebrew-ffmpeg/ffmpeg
   brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype
   ```

   The `--with-freetype` flag opts into the libfreetype build option. The install takes 2–5 minutes depending on what's cached.

3. Verify:
   ```bash
   ffmpeg -hide_banner -filters | grep drawtext
   ```
   You should see a line listing `drawtext` as a filter. If that prints anything, you're done.

4. If the dev server is running, the in-process probe is cached — it was set at boot. The user needs to restart the server for the cache to update:
   - Stop `npm run dev` (Ctrl-C)
   - Start it again
   - The boot log should now say `captions: enabled (ffmpeg drawtext OK)`
   - The HealthBanner advisory disappears

5. Tell them to render a scene to confirm — captions should now appear at the bottom third of the video.

If the install fails (network, brew quirks, etc.), don't try to "fix" it by chasing errors. Show the brew output, suggest `brew doctor`, and stop. This is a system-level concern, not something Claude should debug deeply on the user's behalf.
