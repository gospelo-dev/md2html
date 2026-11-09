#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""gospelo-md2html: Markdown + Mermaid -> paginated HTML / PDF / PPTX.

md2html is written in TypeScript and runs on Node.js (scripts/md2html.mjs).
This file is a thin wrapper so that the skill keeps its usual entry point:

    uv run <skill>/scripts/md2html.py <subcommand> ...      (or python3 ...)

It finds node, checks that the npm packages are installed, and runs
scripts/md2html.mjs with the same arguments and exit code. `setup` installs
the npm packages (npm ci) and then chrome-headless-shell.

Subcommands:  setup | import | check | build | restore
Repository: https://github.com/gospelo-dev/md2html (README, quickstart, references).
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
BUNDLE = SKILL_DIR / "scripts" / "md2html.mjs"
MARKER = SKILL_DIR / "node_modules" / "@gospelo" / "mermaid-arch" / "package.json"
MIN_NODE = (22, 12, 0)

EXIT_ERROR = 1


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return EXIT_ERROR


def find_node() -> str | None:
    node = shutil.which("node")
    if node is None:
        return None
    out = subprocess.run([node, "--version"], capture_output=True, text=True, check=False).stdout.strip()
    m = re.match(r"^v(\d+)\.(\d+)\.(\d+)", out)
    if not m or tuple(int(x) for x in m.groups()) < MIN_NODE:
        raise SystemExit(fail(f"Node.js {'.'.join(map(str, MIN_NODE))} or later is required; {node} is {out or 'unknown'}"))
    return node


def setup(node: str, options: list[str]) -> int:
    if options:
        # md2html.mjs explains the options that are gone (setup --elk); stop before npm ci
        return subprocess.run([node, str(BUNDLE), "setup", *options], check=False).returncode
    npm = shutil.which("npm")
    if npm is None:
        return fail("npm not found on PATH; it comes with Node.js")
    print(f"Installing the npm packages in {SKILL_DIR} ...")
    if subprocess.run([npm, "ci", "--omit=dev"], cwd=SKILL_DIR, check=False).returncode != 0:
        return fail("npm ci failed")
    return subprocess.run([node, str(BUNDLE), "setup"], check=False).returncode


def main(argv: list[str]) -> int:
    node = find_node()
    if node is None:
        return fail("node not found on PATH. Install Node.js 22.12 or later (https://nodejs.org/), "
                    "then run: uv run <skill>/scripts/md2html.py setup")
    if not BUNDLE.is_file():
        return fail(f"{BUNDLE} is missing; the skill copy is incomplete")
    if argv[:1] == ["setup"]:
        return setup(node, argv[1:])
    if not MARKER.is_file():
        return fail(f"the npm packages are not installed in {SKILL_DIR}. Run: uv run {Path(__file__)} setup")
    return subprocess.run([node, str(BUNDLE), *argv], check=False).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
