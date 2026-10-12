#!/usr/bin/env python3
"""
apply_flags.py -- Build-time feature flag processor for TXReader.

Reads the ENABLE_BOOKSTORE environment variable and copies all source files
to the dist/ directory. If the flag is disabled, strips any content wrapped
between BOOKSTORE:START and BOOKSTORE:END marker comments from HTML and JS files.

Marker formats supported:
  HTML: <!-- BOOKSTORE:START --> ... <!-- BOOKSTORE:END -->
  JS:   // BOOKSTORE:START ... // BOOKSTORE:END
"""

import os
import re
import shutil
from pathlib import Path

# -- Config -------------------------------------------------------------------

ROOT = Path(__file__).parent.parent
DIST = ROOT / "dist"

# Files/dirs to copy into dist (relative to ROOT).
INCLUDE = [
    "index.html",
    "app.js",
    "styles.css",
    "sw.js",
    "manifest.webmanifest",
    "icons",
    "js",
]

# Files where feature-flag stripping should run (relative to dist after copy).
FLAG_FILES = [
    "index.html",
    "app.js",
]

# Regex patterns that match a full flagged block (DOTALL so . matches newlines).
PATTERNS = [
    # HTML comments: <!-- BOOKSTORE:START --> ... <!-- BOOKSTORE:END -->
    re.compile(
        r"[ \t]*<!--\s*BOOKSTORE:START\s*-->.*?<!--\s*BOOKSTORE:END\s*-->\n?",
        re.DOTALL,
    ),
    # JS line comments: // BOOKSTORE:START ... // BOOKSTORE:END
    re.compile(
        r"[ \t]*//\s*BOOKSTORE:START\s*\n.*?//\s*BOOKSTORE:END\s*\n?",
        re.DOTALL,
    ),
]

# -- Helpers ------------------------------------------------------------------

def strip_bookstore_blocks(text):
    """Remove every BOOKSTORE-flagged block from text."""
    for pattern in PATTERNS:
        text = pattern.sub("", text)
    return text


def copy_sources():
    """Copy all included source files/dirs into dist/."""
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    for entry in INCLUDE:
        src = ROOT / entry
        dst = DIST / entry
        if not src.exists():
            print("  [skip] {} (not found)".format(entry))
            continue
        if src.is_dir():
            shutil.copytree(src, dst)
            print("  [dir]  {}/".format(entry))
        else:
            shutil.copy2(src, dst)
            print("  [file] {}".format(entry))


def apply_flags(enable):
    """If disabled, strip all BOOKSTORE blocks from flagged files in dist/."""
    if enable:
        print("  ENABLE_BOOKSTORE=true => keeping all bookstore code.")
        return

    print("  ENABLE_BOOKSTORE=false => stripping bookstore blocks...")
    for rel in FLAG_FILES:
        path = DIST / rel
        if not path.exists():
            print("  [skip] {} (not in dist)".format(rel))
            continue
        original = path.read_text(encoding="utf-8")
        stripped = strip_bookstore_blocks(original)
        path.write_text(stripped, encoding="utf-8")

        removed = original.count("BOOKSTORE:START")
        print("  [strip] {} -- removed {} block(s)".format(rel, removed))

    # Also remove the js/bookstore.js file entirely when disabled.
    bookstore_js = DIST / "js" / "bookstore.js"
    if bookstore_js.exists():
        bookstore_js.unlink()
        # Remove js/ dir if now empty.
        js_dir = DIST / "js"
        if js_dir.exists() and not any(js_dir.iterdir()):
            js_dir.rmdir()
        print("  [del]  js/bookstore.js")


# -- Main ---------------------------------------------------------------------

def main():
    raw = os.environ.get("ENABLE_BOOKSTORE", "false").strip().lower()
    enable = raw == "true"

    print("\n=== apply_flags.py ===")
    print("  ENABLE_BOOKSTORE = '{}' => {}".format(raw, "ENABLED" if enable else "DISABLED"))

    print("\n[1] Copying source files to dist/...")
    copy_sources()

    print("\n[2] Applying feature flags...")
    apply_flags(enable)

    print("\nDone. Output is in dist/\n")


if __name__ == "__main__":
    main()
