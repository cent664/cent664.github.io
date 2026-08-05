#!/usr/bin/env python3
"""Resize wallpapers (longest side ~1920px), convert to WebP, update manifest.

Drop full-size .jpg/.jpeg/.png/.webp into assets/wallpapers/, then run:

  python optimize_wallpapers.py

Only optimized .webp files remain (sources are removed after a successful write).
manifest.json and theme.js DEFAULT_WALLPAPERS are rewritten from the resulting set.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image

MAX_SIDE = 1920
WEBP_QUALITY = 82
ROOT = Path(__file__).resolve().parent
DIR = ROOT / "assets" / "wallpapers"
THEME_JS = ROOT / "theme.js"
SOURCE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_NAMES = {"manifest.json", "readme.md"}


def is_source(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name.lower() in SKIP_NAMES:
        return False
    if path.name.startswith("_") or path.name.startswith("."):
        return False
    return path.suffix.lower() in SOURCE_EXTS


def needs_reencode(path: Path, img: Image.Image) -> bool:
    if path.suffix.lower() != ".webp":
        return True
    return max(img.size) > MAX_SIDE


def optimize_one(path: Path) -> Path | None:
    with Image.open(path) as img:
        img.load()
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")

        if not needs_reencode(path, img):
            print(f"  keep  {path.name} ({img.size[0]}x{img.size[1]})")
            return path

        w, h = img.size
        scale = MAX_SIDE / max(w, h)
        if scale < 1:
            new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
            img = img.resize(new_size, Image.Resampling.LANCZOS)

        out = path.with_suffix(".webp")
        img.save(out, "WEBP", quality=WEBP_QUALITY, method=6)
        print(f"  write {out.name} ({img.size[0]}x{img.size[1]}) from {path.name}")

    if path.resolve() != out.resolve() and path.exists():
        path.unlink()
        print(f"  delete {path.name}")
    return out


def update_theme_js(names: list[str]) -> None:
    if not THEME_JS.is_file():
        print("  skip theme.js (missing)", file=sys.stderr)
        return
    text = THEME_JS.read_text(encoding="utf-8")
    items = ",\n".join(f"    '{name}'" for name in names)
    replacement = f"var DEFAULT_WALLPAPERS = [\n{items}\n  ];"
    updated, n = re.subn(
        r"var DEFAULT_WALLPAPERS = \[[^\]]*\];",
        replacement,
        text,
        count=1,
        flags=re.DOTALL,
    )
    if n != 1:
        print("  WARN could not update DEFAULT_WALLPAPERS in theme.js", file=sys.stderr)
        return
    THEME_JS.write_text(updated, encoding="utf-8")
    print(f"Updated {THEME_JS.name} DEFAULT_WALLPAPERS ({len(names)})")


def main() -> int:
    if not DIR.is_dir():
        print(f"Missing folder: {DIR}", file=sys.stderr)
        return 1

    sources = sorted(
        (p for p in DIR.iterdir() if is_source(p)),
        key=lambda p: p.name.lower(),
    )
    if not sources:
        print("No wallpaper images found.")
        return 0

    print(f"Optimizing {len(sources)} file(s) in {DIR} …")
    results: list[Path] = []
    for path in sources:
        try:
            out = optimize_one(path)
            if out is not None:
                results.append(out)
        except Exception as exc:  # noqa: BLE001 — report and continue
            print(f"  FAIL  {path.name}: {exc}", file=sys.stderr)

    unique = sorted({p.name for p in results if p.exists()})
    manifest = DIR / "manifest.json"
    manifest.write_text(json.dumps(unique, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {manifest.name} ({len(unique)} wallpapers)")
    for name in unique:
        print(f"  - {name}")
    update_theme_js(unique)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
