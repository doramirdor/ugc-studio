---
description: Capture the screenshots referenced from the project README into docs/screenshots/.
---

You are helping the maintainer capture project screenshots for the README.

## What to capture

The README references five PNGs under `docs/screenshots/`:

1. **`hero-canvas.png`** — Full canvas with a populated graph (Source → Script → ~6 Scenes → Outputs → Concat). Scenes mostly collapsed. Target viewport 1600×900.
2. **`scene-expanded.png`** — One scene node expanded, showing avatar/voice/narration/caption fields. Target viewport ~600×800.
3. **`merge-node.png`** — A Merge node with at least one video input plus an image overlay configured. Position/size sliders visible. Target ~600×800.
4. **`health-banner.png`** — The advisory banner at the top of the canvas, ideally with mixed severity (one `✗` and one `○`).
5. **`palette.png`** — The top-right palette panel, just the panel (220×280 ish).

## How to do it

You don't have direct screen access — capturing pixels is the user's job. Your job is:

1. **Help them stage the canvas.** Walk them through what state to put each screenshot in. For `hero-canvas.png`, that's a full pipeline. For `scene-expanded.png`, expand one scene by clicking its chevron. Etc.

2. **Suggest the right tool.** On macOS:
   - `Cmd-Shift-4` then space → click the window or node — captures that single element with shadow
   - `Cmd-Shift-5` then drag → capture a region
   - macOS Sequoia and later includes a "Capture window without shadow" option in the screenshot toolbar
   - Save into `docs/screenshots/` with the exact filename above

3. **Verify after.** Run `ls -la docs/screenshots/*.png` and confirm each expected file exists at a reasonable size (50KB–500KB for typical UI shots; multi-MB suggests they need optimization).

4. **Optimize.** Suggest running through `pngquant` if installed:
   ```bash
   pngquant --quality=70-90 --skip-if-larger --ext=.png --force docs/screenshots/*.png
   ```
   This cuts size 50–80% with no visible difference. If pngquant isn't installed, mention it but don't auto-install.

5. **Verify the README renders.** After PNGs land, the user can preview locally with any markdown renderer (VS Code's built-in works), or push to GitHub and check the rendered README. You don't need to "validate" further — broken image links would just show alt text.

Don't try to take screenshots yourself unless you have actual computer-use or browser-automation access — guess work doesn't help here. If those tools are available and the user wants you to drive, ask first before grabbing their screen.
