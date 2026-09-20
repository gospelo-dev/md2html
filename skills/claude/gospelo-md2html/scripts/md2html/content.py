"""Gospelo Document I/O and content validation (docs/spec/gospelo-document.md).

A document is one envelope object: format, version, generator, meta, layout,
pages. It is stored either inside a .gospelo.html file (script
id="gospelo-document", first thing in <head>) or as a .gospelo.json sidecar.
Internally the tool works on the content part (version, meta, pages) and a
layout dict; the envelope exists only at the file boundary.

Validation is a self-contained minimal check (required keys, types, enums
and the page-0 rules). It never fills in defaults for missing data.

There is no reader for the pre-1 format (md2html-content / page-0 blocks or a
bare content JSON): such files raise a ContentError pointing at MIGRATION_URL.
"""

from __future__ import annotations

import html as html_mod
import json
import re
from pathlib import Path
from typing import Any

from . import __version__

FORMAT = "gospelo-document"
SCHEMA_VERSION = 1
GENERATOR = f"gospelo-md2html {__version__}"
DOC_SCRIPT_ID = "gospelo-document"
SIGNATURE = f"<!-- {FORMAT} {SCHEMA_VERSION} -->"
HTML_SUFFIX = ".gospelo.html"
JSON_SUFFIX = ".gospelo.json"
MIGRATION_URL = "https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION.md"

HEAD_CHUNK = 64 * 1024  # the envelope must start within the first chunk

PAGE_KINDS = ("source", "cover", "content")

# type -> {key: (types, required)}
BLOCK_SPEC: dict[str, dict[str, tuple[tuple[type, ...], bool]]] = {
    "heading": {"level": ((int,), True), "text": ((str,), True)},
    "paragraph": {"text": ((str,), True)},
    "list": {"ordered": ((bool,), True), "items": ((list,), True), "start": ((int,), False)},
    "table": {"header": ((list,), True), "rows": ((list,), True), "align": ((list,), False), "continued": ((bool,), False)},
    "code": {"lang": ((str, type(None)), True), "lines": ((list,), True), "continued": ((bool,), False)},
    "image": {"src": ((str,), True), "alt": ((str,), True), "caption": ((str, type(None)), False)},
    "mermaid": {"source": ((str,), True)},
    "quote": {"text": ((str,), True)},
    "html": {"html": ((str,), True)},
    "markdown": {"text": ((str,), True)},
    "pagebreak": {},
}

FIGURE_TYPES = ("image", "mermaid")


class ContentError(ValueError):
    pass


# --------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------

def is_html_path(path: Path) -> bool:
    return path.suffix.lower() in (".html", ".htm")


def default_html_path(path: Path) -> Path:
    """<name>.gospelo.html next to `path` (input Markdown or sidecar JSON)."""
    name = path.name
    for suffix in (JSON_SUFFIX, HTML_SUFFIX):
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)]
            break
    else:
        name = path.stem
    return path.with_name(name + HTML_SUFFIX)


# --------------------------------------------------------------------------
# envelope <-> (content, layout)
# --------------------------------------------------------------------------

def make_envelope(doc: dict[str, Any], layout: dict[str, Any], pages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The Gospelo Document object for `doc` (content part) and an effective layout dict."""
    src_page = doc["pages"][0] if doc["pages"] and doc["pages"][0]["kind"] == "source" else None
    body = list(pages) if pages is not None else [p for p in doc["pages"] if p["kind"] != "source"]
    env: dict[str, Any] = {
        "format": FORMAT,
        "version": SCHEMA_VERSION,
        "generator": GENERATOR,
        "meta": dict(doc["meta"]),
        "layout": dict(layout),
        "pages": ([src_page] if src_page is not None else []) + body,
    }
    if doc.get("extras"):
        env["extras"] = doc["extras"]
    return strip_runtime_ids(env)


def split_envelope(env: Any, where: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate the envelope shell and return (content doc, layout dict)."""
    if not isinstance(env, dict) or env.get("format") != FORMAT:
        raise ContentError(
            f"{where}: not a Gospelo Document (no \"format\": \"{FORMAT}\"). "
            f"Files written by earlier md2html releases must be converted first: {MIGRATION_URL}"
        )
    if env.get("version") != SCHEMA_VERSION:
        raise ContentError(f"{where}: unsupported {FORMAT} version {env.get('version')!r} (this tool reads {SCHEMA_VERSION})")
    for key in env:
        if key not in ("format", "version", "generator", "meta", "layout", "pages", "extras"):
            raise ContentError(f"{where}: unknown top-level key {key!r}")
    if "generator" in env and not isinstance(env["generator"], str):
        raise ContentError(f"{where}: generator must be a string")
    layout = env.get("layout")
    if not isinstance(layout, dict):
        raise ContentError(f"{where}: layout must be an object")
    doc: dict[str, Any] = {"version": SCHEMA_VERSION, "meta": env.get("meta"), "pages": env.get("pages")}
    if "extras" in env:
        doc["extras"] = env["extras"]
    validate_content(doc, where)
    return doc, layout


# --------------------------------------------------------------------------
# load / save
# --------------------------------------------------------------------------

def load_document(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """(content doc with block ids assigned, layout dict) from a .gospelo.html or .gospelo.json."""
    if is_html_path(path):
        env = _envelope_from_html(read_head(path), str(path))
    else:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise ContentError(f"document not found: {path}") from None
        try:
            env = json.loads(text)
        except json.JSONDecodeError as e:
            raise ContentError(f"document is not valid JSON: {path}: {e}") from None
    doc, layout = split_envelope(env, str(path))
    assign_block_ids(doc)
    return doc, layout


def load_content(path: Path) -> dict[str, Any]:
    return load_document(path)[0]


def load_embedded_layout(path: Path) -> dict[str, Any]:
    return load_document(path)[1]


def save_document(doc: dict[str, Any], layout: dict[str, Any], path: Path) -> None:
    """Write the sidecar form (.gospelo.json)."""
    env = make_envelope(doc, layout)
    path.write_text(json.dumps(env, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def strip_runtime_ids(doc: dict[str, Any]) -> dict[str, Any]:
    """Block ids are computed at load time; do not persist the generated ones.
    Runtime keys (leading underscore) on pages are dropped as well."""
    copy = json.loads(json.dumps(doc, ensure_ascii=False))
    for page in copy["pages"]:
        for key in [k for k in page if k.startswith("_")]:
            page.pop(key)  # runtime-only data such as the two-column placement (_layout)
        for block in page["blocks"]:
            if block.get("_generated_id"):
                block.pop("id", None)
                block.pop("_generated_id", None)
    return copy


def assign_block_ids(doc: dict[str, Any]) -> None:
    for page in doc["pages"]:
        for i, block in enumerate(page["blocks"]):
            if "id" not in block:
                block["id"] = f"{page['id']}-b{i}"
                block["_generated_id"] = True


# --------------------------------------------------------------------------
# HTML container: embed and extract
# --------------------------------------------------------------------------

def embed_json(obj: Any) -> str:
    """JSON safe to place inside <script type="application/json">: '<', '>' and
    '&' are escaped so no '</script' or comment sequence can appear, and
    Unicode is kept readable."""
    return (json.dumps(obj, ensure_ascii=False, indent=2)
            .replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e"))


def envelope_script(env: dict[str, Any]) -> str:
    return f'<script type="application/json" id="{DOC_SCRIPT_ID}">\n' + embed_json(env) + "\n</script>"


_OPEN_TAG = f'<script type="application/json" id="{DOC_SCRIPT_ID}">'
_CLOSE_TAG = "</script>"


def read_head(path: Path) -> str:
    """Read `path` only as far as the end of the envelope block. The envelope
    is the first script in <head>, so a few chunks are enough; the Mermaid
    library and the rendered pages after it are never read."""
    try:
        f = path.open("r", encoding="utf-8")
    except FileNotFoundError:
        raise ContentError(f"document not found: {path}") from None
    with f:
        buf = f.read(HEAD_CHUNK)
        start = buf.find(_OPEN_TAG)
        if start < 0:
            _raise_not_gospelo(buf, str(path))
        while True:
            end = buf.find(_CLOSE_TAG, start + len(_OPEN_TAG))
            if end >= 0:
                return buf[: end + len(_CLOSE_TAG)]
            chunk = f.read(HEAD_CHUNK)
            if not chunk:
                raise ContentError(f"{path}: the {DOC_SCRIPT_ID} block is not terminated")
            buf += chunk


def _raise_not_gospelo(head: str, where: str) -> None:
    # pre-1 md2html output: the envelope blocks sat after the Mermaid library, but the
    # <html> tag (always inside the first chunk) carried this attribute from the start
    legacy = "data-mermaid-font-size=" in head or 'id="md2html-content"' in head or 'id="page-0"' in head
    hint = ("it was written by an earlier md2html release; convert it first: " if legacy
            else "it was not generated by md2html build, or the block was removed. Conversion notes: ")
    raise ContentError(f"{where}: no <script id=\"{DOC_SCRIPT_ID}\"> envelope found; {hint}{MIGRATION_URL}")


def extract_from_html(html_text: str, where: str = "html") -> tuple[dict[str, Any], dict[str, Any]]:
    """(content doc, layout dict) from the text of a .gospelo.html (or its head)."""
    return split_envelope(_envelope_from_html(html_text, where), where)


def _envelope_from_html(text: str, where: str) -> dict[str, Any]:
    start = text.find(_OPEN_TAG)
    if start < 0:
        _raise_not_gospelo(text, where)
    end = text.find(_CLOSE_TAG, start + len(_OPEN_TAG))
    if end < 0:
        raise ContentError(f"{where}: the {DOC_SCRIPT_ID} block is not terminated")
    try:
        return json.loads(text[start + len(_OPEN_TAG):end])
    except json.JSONDecodeError as e:
        raise ContentError(f"{where}: embedded {DOC_SCRIPT_ID} JSON is not valid: {e}") from None


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------

def validate_content(doc: Any, where: str = "content") -> None:
    if not isinstance(doc, dict):
        raise ContentError(f"{where}: top level must be an object")
    if doc.get("version") != SCHEMA_VERSION:
        raise ContentError(f"{where}: version must be {SCHEMA_VERSION} (got {doc.get('version')!r})")
    meta = doc.get("meta")
    if not isinstance(meta, dict):
        raise ContentError(f"{where}: meta must be an object")
    if not isinstance(meta.get("title"), str):
        raise ContentError(f"{where}: meta.title must be a string")
    if not isinstance(meta.get("date"), (str, type(None))):
        raise ContentError(f"{where}: meta.date must be a string or null")
    if not isinstance(meta.get("source"), (str, type(None))):
        raise ContentError(f"{where}: meta.source must be a string or null")
    if "lang" in meta and (not isinstance(meta["lang"], str) or not meta["lang"]):
        raise ContentError(f"{where}: meta.lang must be a non-empty string")
    for key in meta:
        if key not in ("title", "date", "source", "lang", "extras"):
            raise ContentError(f"{where}: meta has unknown key {key!r}")
    if "extras" in meta and not isinstance(meta["extras"], dict):
        raise ContentError(f"{where}: meta.extras must be an object")
    if "extras" in doc and not isinstance(doc["extras"], dict):
        raise ContentError(f"{where}: extras must be an object")
    pages = doc.get("pages")
    if not isinstance(pages, list) or not pages:
        raise ContentError(f"{where}: pages must be a non-empty array")
    seen: set[str] = set()
    for idx, page in enumerate(pages):
        _validate_page(page, idx, where)
        if page["id"] in seen:
            raise ContentError(f"{where}: duplicate page id {page['id']!r}")
        seen.add(page["id"])
    content_pages = [p for p in pages if p["kind"] != "source"]
    if not content_pages:
        raise ContentError(f"{where}: at least one cover or content page is required")


def _validate_page(page: Any, idx: int, where: str) -> None:
    loc = f"{where}: pages[{idx}]"
    if not isinstance(page, dict):
        raise ContentError(f"{loc} must be an object")
    for key in ("id", "kind", "title", "continued", "blocks"):
        if key not in page:
            raise ContentError(f"{loc} is missing {key!r}")
    for key in page:
        if key not in ("id", "kind", "title", "continued", "blocks", "extras") and not key.startswith("_"):
            raise ContentError(f"{loc} has unknown key {key!r}")
    if not isinstance(page["id"], str) or not page["id"]:
        raise ContentError(f"{loc}.id must be a non-empty string")
    if page["kind"] not in PAGE_KINDS:
        raise ContentError(f"{loc}.kind must be one of {PAGE_KINDS}")
    if not isinstance(page["title"], (str, type(None))):
        raise ContentError(f"{loc}.title must be a string or null")
    if not isinstance(page["continued"], bool):
        raise ContentError(f"{loc}.continued must be a boolean")
    if not isinstance(page["blocks"], list):
        raise ContentError(f"{loc}.blocks must be an array")
    if "extras" in page and not isinstance(page["extras"], dict):
        raise ContentError(f"{loc}.extras must be an object")
    if page["kind"] == "source":
        if idx != 0:
            raise ContentError(f"{loc}: a source page must be pages[0]")
        if len(page["blocks"]) != 1 or page["blocks"][0].get("type") != "markdown":
            raise ContentError(f"{loc}: a source page must contain exactly one markdown block")
    for b_idx, block in enumerate(page["blocks"]):
        _validate_block(block, f"{loc}.blocks[{b_idx}]", page["kind"])


def _validate_block(block: Any, loc: str, page_kind: str) -> None:
    if not isinstance(block, dict):
        raise ContentError(f"{loc} must be an object")
    btype = block.get("type")
    if btype not in BLOCK_SPEC:
        raise ContentError(f"{loc}.type {btype!r} is not a known block type")
    if btype == "markdown" and page_kind != "source":
        raise ContentError(f"{loc}: markdown blocks are only allowed on the source page")
    if "id" in block and (not isinstance(block["id"], str) or not block["id"]):
        raise ContentError(f"{loc}.id must be a non-empty string")
    spec = BLOCK_SPEC[btype]
    for key, (types, required) in spec.items():
        if key not in block:
            if required:
                raise ContentError(f"{loc} ({btype}) is missing {key!r}")
            continue
        if not isinstance(block[key], types):
            raise ContentError(f"{loc}.{key} has wrong type for {btype}")
    for key in block:
        if key not in spec and key not in ("type", "id", "_generated_id"):
            raise ContentError(f"{loc} ({btype}) has unknown key {key!r}")
    if btype == "heading" and not (1 <= block["level"] <= 4):
        raise ContentError(f"{loc}: heading level must be 1 to 4")
    if btype == "list":
        _validate_items(block["items"], loc)
    if btype == "table":
        ncols = len(block["header"])
        if ncols == 0 or not all(isinstance(h, str) for h in block["header"]):
            raise ContentError(f"{loc}: table header must be a non-empty array of strings")
        for r_idx, row in enumerate(block["rows"]):
            if not isinstance(row, list) or not all(isinstance(c, str) for c in row):
                raise ContentError(f"{loc}.rows[{r_idx}] must be an array of strings")
            if len(row) != ncols:
                raise ContentError(f"{loc}.rows[{r_idx}] has {len(row)} cells, header has {ncols}")
        if "align" in block and (len(block["align"]) != ncols or not all(a in ("left", "center", "right") for a in block["align"])):
            raise ContentError(f"{loc}.align must list left/center/right for each column")
    if btype == "code" and not all(isinstance(line, str) for line in block["lines"]):
        raise ContentError(f"{loc}.lines must be an array of strings")


def _validate_items(items: Any, loc: str) -> None:
    if not isinstance(items, list):
        raise ContentError(f"{loc}.items must be an array")
    if not items:
        raise ContentError(f"{loc}.items must not be empty")
    for i, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("text"), str):
            raise ContentError(f"{loc}.items[{i}] must be an object with a text string")
        for key in item:
            if key not in ("text", "children"):
                raise ContentError(f"{loc}.items[{i}] has unknown key {key!r}")
        if "children" in item:
            _validate_items(item["children"], f"{loc}.items[{i}]")


# --------------------------------------------------------------------------
# page 0 (source backup) and restore
# --------------------------------------------------------------------------

def make_source_page(markdown_text: str) -> dict[str, Any]:
    return {
        "id": "p00",
        "kind": "source",
        "title": None,
        "continued": False,
        "blocks": [{"type": "markdown", "text": markdown_text}],
    }


def get_source_markdown(doc: dict[str, Any]) -> str | None:
    first = doc["pages"][0]
    if first["kind"] == "source":
        return first["blocks"][0]["text"]
    return None


def content_pages(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [p for p in doc["pages"] if p["kind"] != "source"]


def restore_markdown(path: Path) -> str:
    """The original Markdown (pages[0]) of a .gospelo.html or .gospelo.json."""
    doc, _ = load_document(path)
    src = get_source_markdown(doc)
    if src is None:
        raise ContentError(f"{path}: this document has no page 0 source backup")
    return src


def html_attr(value: str) -> str:
    return html_mod.escape(value, quote=True)
