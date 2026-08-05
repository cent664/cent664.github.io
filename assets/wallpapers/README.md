# Wallpapers

Drop full-size photos here (`.jpg`, `.jpeg`, `.png`, or `.webp`), then optimize before publishing:

```bash
python optimize_wallpapers.py
```

That script:

- resizes the longest side to ~1920px
- converts to WebP
- deletes the full-size sources after a successful write
- rewrites `manifest.json`

Only the optimized `.webp` files should be committed/pushed. Keep originals out of git.

`theme.js` embeds the same list as `DEFAULT_WALLPAPERS` (fallback if the manifest fails to load)—update that list when the set changes, or re-run the optimizer and sync both.

Tips:
- Landscape or portrait both work; a light scrim keeps text readable
- Prefer varied lighting across the set
- If you rotate a photo in Photos/Preview, run the optimizer afterward — it bakes EXIF orientation into the WebP pixels so the rotation sticks
