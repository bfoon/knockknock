#!/usr/bin/env python3
"""
fix_basemaps.py — retire the hardcoded CARTO tile URLs in Kura's templates.

CARTO began watermarking unauthenticated raster tiles ("API KEY REQUIRED")
in late August 2026. Kura has that URL written into several templates; this
script points them all at {% kura_basemap %} instead, so the provider lives
in settings.py from now on.

Run it from your project root:

    python fix_basemaps.py path/to/kura/templates/kura

It is idempotent — running it twice changes nothing the second time — and
it writes a .bak beside every file it touches. Nothing is edited unless a
CARTO URL is actually present.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

CARTO = re.compile(
    r'L\.tileLayer\(\s*"https://\{s\}\.basemaps\.cartocdn\.com/[^"]*"\s*,\s*'
    r'\{[^}]*\}\s*\)\.addTo\(\s*(?P<map>[A-Za-z_$][\w$]*)\s*\)',
    re.DOTALL,
)
# builder.html spreads the same call across several lines with a trailing
# comma before the closing brace; handled by the same pattern once newlines
# are allowed, but the multi-line form uses a different quote layout.
CARTO_MULTILINE = re.compile(
    r'L\.tileLayer\(\s*\n?\s*"https://\{s\}\.basemaps\.cartocdn\.com/[^"]*",'
    r'(?:[^;]*?)\)\.addTo\(\s*(?P<map>[A-Za-z_$][\w$]*)\s*\)',
    re.DOTALL,
)


def patch_text(text: str) -> tuple[str, int]:
    changes = 0

    def sub(match):
        nonlocal changes
        changes += 1
        return f'KURA_BASEMAP.addTo({match.group("map")})'

    text = CARTO.sub(sub, text)
    text = CARTO_MULTILINE.sub(sub, text)

    if changes and "kura_maps" not in text:
        # Add the load tag to whichever {% load %} line comes first, or
        # insert one at the very top if the template has none.
        load = re.search(r"\{%\s*load\s+([^%]*?)%\}", text)
        if load:
            existing = load.group(1).strip()
            text = (text[:load.start()]
                    + "{% load " + existing + " kura_maps %}"
                    + text[load.end():])
        else:
            text = "{% load kura_maps %}" + text

    if changes and "{% kura_basemap %}" not in text:
        # Directly after the Leaflet script tag, so L is defined.
        leaflet = re.search(r'<script src="[^"]*leaflet[^"]*\.js"></script>', text)
        if leaflet:
            text = (text[:leaflet.end()] + "\n{% kura_basemap %}"
                    + text[leaflet.end():])
        else:
            print("    ! could not find the Leaflet <script> tag — add "
                  "{% kura_basemap %} to the head by hand")
    return text, changes


def main(paths):
    if not paths:
        print(__doc__)
        return 1

    total = 0
    for root in paths:
        root = Path(root)
        files = [root] if root.is_file() else sorted(root.rglob("*.html"))
        for path in files:
            text = path.read_text(encoding="utf-8")
            if "cartocdn.com" not in text:
                continue
            patched, n = patch_text(text)
            if not n:
                print(f"  – {path}: CARTO URL present but not in a shape I "
                      f"recognise; edit by hand")
                continue
            shutil.copy2(path, path.with_suffix(path.suffix + ".bak"))
            path.write_text(patched, encoding="utf-8")
            print(f"  ✓ {path}: {n} tile layer(s) rewired")
            total += n

    print(f"\n{total} tile layer(s) now read from settings.")
    print("Remaining references to check by hand:")
    for root in paths:
        root = Path(root)
        files = [root] if root.is_file() else sorted(root.rglob("*.html"))
        for path in files:
            if "cartocdn.com" in path.read_text(encoding="utf-8"):
                print(f"  ! {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
