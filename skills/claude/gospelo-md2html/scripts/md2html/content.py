"""Content JSON: load, validate, save, page 0 backup, restore
(docs/07_content_model.md sections 3, 3.5 and 8).

Validation is a self-contained minimal check (required keys, types, enums
and the page-0 rules). It never fills in defaults for missing data.
"""

from __future__ import annotations

import html as html_mod
import json
import re
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

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
# load / save
# --------------------------------------------------------------------------

def is_html_path(path: Path) -> bool:
    return path.suffix.lower() in (".html", ".htm")


def load_content(path: Path) -> dict[str, Any]:
    """Load a content JSON, or the content JSON embedded in a generated HTML."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ContentError(f"content file not found: {path}") from None
    if is_html_path(path):
        doc, _ = extract_from_html(text)
    else:
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as e:
            raise ContentError(f"content file is not valid JSON: {path}: {e}") from None
    validate_content(doc, str(path))
    assign_block_ids(doc)
    return doc


def load_embedded_layout(path: Path) -> dict[str, Any] | None:
    """The layout snapshot embedded in a generated HTML (None for JSON inputs)."""
    if not is_html_path(path):
        return None
    _, layout = extract_from_html(path.read_text(encoding="utf-8"))
    return layout


def save_content(doc: dict[str, Any], path: Path) -> None:
    out = strip_runtime_ids(doc)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def strip_runtime_ids(doc: dict[str, Any]) -> dict[str, Any]:
    """Block ids are computed at load time; do not persist the generated ones."""
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


def escape_for_script(text: str) -> str:
    return text.replace("</script", "<\\/script")


def unescape_from_script(text: str) -> str:
    return text.replace("<\\/script", "</script")


_PAGE0_RE = re.compile(
    r'<script type="text/markdown" id="page-0"[^>]*>\n?(.*?)</script>', re.DOTALL
)


def restore_from_html(html_text: str) -> str:
    m = _PAGE0_RE.search(html_text)
    if not m:
        raise ContentError("no page-0 source block found in the HTML")
    text = m.group(1)
    if text.endswith("\n"):
        text = text[:-1]  # the newline the renderer adds before </script>
    return unescape_from_script(text)


# --------------------------------------------------------------------------
# content JSON embedded in generated HTML (the HTML is a self-contained document)
# --------------------------------------------------------------------------

CONTENT_SCRIPT_ID = "md2html-content"
LAYOUT_SCRIPT_ID = "md2html-layout"


def embed_json(obj: Any) -> str:
    """JSON safe to place inside <script type="application/json">: '<' is escaped
    so no '</script' sequence can appear, and Unicode is kept readable."""
    return json.dumps(obj, ensure_ascii=False, indent=2).replace("<", "\\u003c")


_CONTENT_RE = re.compile(
    r'<script type="application/json" id="' + CONTENT_SCRIPT_ID + r'">\s*(.*?)\s*</script>', re.DOTALL
)
_LAYOUT_RE = re.compile(
    r'<script type="application/json" id="' + LAYOUT_SCRIPT_ID + r'">\s*(.*?)\s*</script>', re.DOTALL
)


def extract_from_html(html_text: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Return (content doc, layout dict or None) embedded in a generated HTML."""
    m = _CONTENT_RE.search(html_text)
    if not m:
        raise ContentError(
            "this HTML has no embedded content JSON (id=md2html-content); "
            "it was not generated by md2html build, or the block was removed"
        )
    try:
        doc = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        raise ContentError(f"embedded content JSON is not valid: {e}") from None
    layout = None
    lm = _LAYOUT_RE.search(html_text)
    if lm:
        try:
            layout = json.loads(lm.group(1))
        except json.JSONDecodeError as e:
            raise ContentError(f"embedded layout JSON is not valid: {e}") from None
    return doc, layout


def restore_markdown(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".html", ".htm"):
        return restore_from_html(text)
    doc = json.loads(text)
    validate_content(doc, str(path))
    src = get_source_markdown(doc)
    if src is None:
        raise ContentError(f"{path}: this content JSON has no page 0 source backup")
    return src


def html_attr(value: str) -> str:
    return html_mod.escape(value, quote=True)
