# Screenshots

This folder holds the imagery referenced from the project README. Files are not auto-generated — drop PNGs here that match the names below.

## Expected files

| File | What it should show | Suggested viewport |
|---|---|---|
| `hero-canvas.png` | Full canvas with a populated graph: Source → Script → 6 Scenes → 6 Outputs → Concat. Nodes mostly collapsed for readability. | 1600×900 |
| `scene-expanded.png` | One scene node expanded — avatar/voice picker visible, narration field, caption, render button. | 600×800 |
| `merge-node.png` | A Merge node with two video inputs, one image overlay (bottom-right), and one audio. Position/size sliders visible. | 600×800 |
| `health-banner.png` | Top-of-canvas advisory banner, ideally with one `✗` and one `○` to demonstrate severity tiers. | 1600×120 |
| `palette.png` | Top-right palette with the four draggable items. | 220×280 |

## How to capture

1. Run `npm run dev`, open http://localhost:5173.
2. Set up the canvas state you want to capture (use Reset for a clean start).
3. Use the OS screenshot tool — on macOS, `Cmd-Shift-4` then space to grab a single window/element, or `Cmd-Shift-5` for a region.
4. Crop to the bounds described above, save as PNG into this folder with the matching filename.
5. Optimize before committing (e.g. `pngquant --quality=70-90 *.png` or run them through TinyPNG).

If you're using Claude Code, the project ships a `/screenshot` slash command that scripts most of this for you — see [`.claude/commands/screenshot.md`](../../.claude/commands/screenshot.md).
