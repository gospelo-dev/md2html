#!/usr/bin/env python3
"""Extract the original Markdown embedded in a document written by gospelo-md2html.

This is the migration tool: it reads every container the tool has ever written
and prints (or writes) the Markdown that was imported, so that a new Gospelo
Document can be generated from it with `md2html.py import`:

    python extract_markdown.py old.html -o original.md
    uv run md2html.py import original.md --page 16x9

Accepted inputs:
  - Gospelo Document, .gospelo.html or .gospelo.json (format "gospelo-document")
  - pre-1 md2html HTML: <script type="text/markdown" id="page-0"> block
  - pre-1 content JSON: {"version": 1, "pages": [{"kind": "source", ...}]}

Standard library only; it does not import the md2html package.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ENVELOPE_RE = re.compile(r'<script type="application/json" id="gospelo-document">\s*(.*?)\s*</script>', re.DOTALL)
LEGACY_MD_RE = re.compile(r'<script type="text/markdown" id="page-0"[^>]*>\n?(.*?)</script>', re.DOTALL)
LEGACY_JSON_RE = re.compile(r'<script type="application/json" id="md2html-content">\s*(.*?)\s*</script>', re.DOTALL)


class ExtractError(Exception):
    pass


def _source_from_pages(obj: dict, where: str) -> str:
    pages = obj.get("pages")
    if not isinstance(pages, list) or not pages:
        raise ExtractError(f"{where}: no pages")
    first = pages[0]
    if not (isinstance(first, dict) and first.get("kind") == "source"):
        raise ExtractError(f"{where}: pages[0] is not a source page; the original Markdown was not kept in this file")
    blocks = first.get("blocks") or []
    if not blocks or blocks[0].get("type") != "markdown" or not isinstance(blocks[0].get("text"), str):
        raise ExtractError(f"{where}: the source page holds no markdown block")
    return blocks[0]["text"]


def extract(text: str, where: str = "input") -> tuple[str, str]:
    """Return (markdown, kind) where kind names the container that was recognised."""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as e:
            raise ExtractError(f"{where}: not valid JSON: {e}") from None
        if obj.get("format") == "gospelo-document":
            return _source_from_pages(obj, where), "gospelo-document (json)"
        if obj.get("version") == 1 and "pages" in obj:
            return _source_from_pages(obj, where), "pre-1 content JSON"
        raise ExtractError(f"{where}: unrecognised JSON document")
    m = ENVELOPE_RE.search(text)
    if m:
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            raise ExtractError(f"{where}: embedded envelope is not valid JSON: {e}") from None
        return _source_from_pages(obj, where), "gospelo-document (html)"
    m = LEGACY_MD_RE.search(text)
    if m:
        md = m.group(1)
        if md.endswith("\n"):
            md = md[:-1]  # the newline the old renderer added before </script>
        return md.replace("<\\/script", "</script"), "pre-1 md2html HTML (page-0 block)"
    m = LEGACY_JSON_RE.search(text)
    if m:
        obj = json.loads(m.group(1))
        return _source_from_pages(obj, where), "pre-1 md2html HTML (md2html-content block)"
    raise ExtractError(f"{where}: no embedded Markdown found (not a gospelo-md2html output?)")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", type=Path, help=".gospelo.html, .gospelo.json, or a pre-1 md2html .html / .json")
    p.add_argument("-o", "--output", type=Path, help="Markdown file to write (default: stdout)")
    args = p.parse_args(argv)
    try:
        text = args.input.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 1
    try:
        md, kind = extract(text, str(args.input))
    except ExtractError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if args.output:
        args.output.write_text(md if md.endswith("\n") else md + "\n", encoding="utf-8")
        print(f"wrote {args.output} ({kind})", file=sys.stderr)
    else:
        sys.stdout.write(md if md.endswith("\n") else md + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
