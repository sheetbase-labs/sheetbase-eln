#!/usr/bin/env python3
"""Extract the visible text of each design-canvas screen into screen-text/.

The .dc.html files are the source of truth. The text files exist so agents and
reviewers can grep, diff and read a screen's content without the design-canvas
runtime. Regenerate after replacing the canvas snapshot:

    python3 docs/knowledge/design/ui-system-v3/tools/extract_screen_text.py

The shared shell (top bar, main navigation, menus, notifications and toasts)
is stripped because it is identical on every desktop screen; see Main.dc.html
for it in full.
"""

import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CANVAS = ROOT / "canvas"
OUT = ROOT / "screen-text"


def extract(source: str) -> str:
    s = source.split("<!--overlays-->")[0]
    s = re.sub(r"<script.*?</script>", "", s, flags=re.S)
    s = re.sub(r"<helmet>.*?</helmet>", "", s, flags=re.S)
    s = re.sub(r'<nav class="nav" aria-label="Main">.*?</nav>', "", s, flags=re.S)
    s = re.sub(r'<header class="topbar">.*?</header>', "", s, flags=re.S)
    s = re.sub(r'<a class="skip"[^>]*>.*?</a>', "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<(br|/div|/tr|/li|/h\d|/p|/section|/dt|/dd)[^>]*>", "\n", s)
    s = re.sub(r"<(td|th)[^>]*>", " | ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    lines = (re.sub(r"[ \t]+", " ", line).strip() for line in s.split("\n"))
    return "\n".join(line for line in lines if line) + "\n"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.txt"):
        old.unlink()
    for path in sorted(CANVAS.glob("*.dc.html")):
        name = path.name.removesuffix(".dc.html")
        (OUT / f"{name}.txt").write_text(extract(path.read_text()))


if __name__ == "__main__":
    main()
