"""Markdown -> block list (docs/02_pipeline.md sections (1) and 3,
docs/07_content_model.md section 6).

Pre-processing on the raw text handles <details> (Mermaid rescue first,
then drop/expand) and the pagebreak comment. markdown-it then yields a
token stream that is folded into top-level blocks matching the content
JSON schema.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from markdown_it import MarkdownIt

_md = MarkdownIt("gfm-like", {"linkify": False})
_md.enable("table")

_DETAILS_RE = re.compile(r"<details>(.*?)</details>[ \t]*\n?", re.DOTALL | re.IGNORECASE)
_SUMMARY_RE = re.compile(r"<summary>(.*?)</summary>", re.DOTALL | re.IGNORECASE)
_MERMAID_FENCE_RE = re.compile(r"^```mermaid[^\n]*\n(.*?)\n```\s*$", re.DOTALL)
_DIAGRAM_IMG_RE = re.compile(r"(?:^|\n)!\[[^\]]*\]\(([^)]+)\)[ \t]*\n\s*$")
_PAGEBREAK = "<!-- pagebreak -->"


@dataclass
class ImportNotes:
    dropped_details: list[str] = field(default_factory=list)
    expanded_details: int = 0
    rescued_mermaid: int = 0
    discarded_images: list[str] = field(default_factory=list)
    html_blocks: int = 0
    ignored_hr: int = 0
    # blocks (code, table, quote ...) inside a nested list item: a nested item cannot hold them
    dropped_list_blocks: list[str] = field(default_factory=list)


def preprocess_markdown(text: str, details_mode: str, notes: ImportNotes) -> str:
    def repl(m: re.Match) -> str:
        inner = m.group(1)
        summary = ""
        sm = _SUMMARY_RE.search(inner)
        if sm:
            summary = sm.group(1).strip()
            inner = inner[:sm.start()] + inner[sm.end():]
        stripped = inner.strip()
        fm = _MERMAID_FENCE_RE.match(stripped)
        if fm:
            notes.rescued_mermaid += 1
            return "\n```mermaid\n" + fm.group(1) + "\n```\n"
        if details_mode == "drop":
            notes.dropped_details.append(stripped[:40].replace("\n", " "))
            return "\n"
        notes.expanded_details += 1
        head = f"\n#### {summary}\n\n" if summary else "\n"
        return head + stripped + "\n"

    out = []
    last = 0
    for m in _DETAILS_RE.finditer(text):
        before = text[last:m.start()]
        replacement = repl(m)
        if replacement.startswith("\n```mermaid"):
            # a rendered PNG right before the fold is the same diagram: discard it
            im = _DIAGRAM_IMG_RE.search(before)
            if im:
                notes.discarded_images.append(im.group(1))
                before = before[:im.start()] + "\n"
        out.append(before)
        out.append(replacement)
        last = m.end()
    out.append(text[last:])
    return "".join(out)


# --------------------------------------------------------------------------
# token folding
# --------------------------------------------------------------------------

def parse_blocks(text: str, hr_break: bool, notes: ImportNotes) -> list[dict[str, Any]]:
    return _fold(_md.parse(text), hr_break, notes)


def _fold(tokens, hr_break: bool, notes: ImportNotes) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        t = tok.type
        if t == "heading_open":
            inline = tokens[i + 1]
            blocks.append({"type": "heading", "level": int(tok.tag[1]), "text": inline.content.strip()})
            i += 3
        elif t == "paragraph_open":
            inline = tokens[i + 1]
            blk = _paragraph_block(inline)
            blocks.append(blk)
            i += 3
        elif t in ("bullet_list_open", "ordered_list_open"):
            j = _find_close(tokens, i)
            blocks.extend(_list_blocks(tokens[i:j + 1], hr_break, notes))
            i = j + 1
        elif t == "table_open":
            j = _find_close(tokens, i)
            blocks.append(_table_block(tokens[i:j + 1]))
            i = j + 1
        elif t == "fence":
            info = (tok.info or "").strip()
            if info.split()[:1] == ["mermaid"]:
                blocks.append({"type": "mermaid", "source": tok.content.rstrip("\n")})
            else:
                blocks.append({"type": "code", "lang": info.split()[0] if info else None,
                               "lines": tok.content.rstrip("\n").split("\n")})
            i += 1
        elif t == "code_block":
            blocks.append({"type": "code", "lang": None, "lines": tok.content.rstrip("\n").split("\n")})
            i += 1
        elif t == "blockquote_open":
            j = _find_close(tokens, i)
            parts = [tk.content for tk in tokens[i:j] if tk.type == "inline"]
            blocks.append({"type": "quote", "text": "\n\n".join(p.strip() for p in parts)})
            i = j + 1
        elif t == "html_block":
            content = tok.content.strip()
            if content == _PAGEBREAK:
                blocks.append({"type": "pagebreak"})
            else:
                notes.html_blocks += 1
                blocks.append({"type": "html", "html": content})
            i += 1
        elif t == "hr":
            if hr_break:
                blocks.append({"type": "pagebreak"})
            else:
                notes.ignored_hr += 1
            i += 1
        else:
            i += 1
    return blocks


def _find_close(tokens, i: int) -> int:
    depth = 0
    for j in range(i, len(tokens)):
        depth += tokens[j].nesting
        if depth == 0:
            return j
    raise ValueError("unbalanced token stream")


def _paragraph_block(inline) -> dict[str, Any]:
    children = inline.children or []
    meaningful = [c for c in children if not (c.type == "text" and not c.content.strip())]
    if len(meaningful) == 1 and meaningful[0].type == "image":
        img = meaningful[0]
        return {"type": "image", "src": img.attrGet("src") or "", "alt": img.content or ""}
    return {"type": "paragraph", "text": inline.content.strip()}


# Block-level content a list item cannot hold: an item keeps inline text and nested lists only.
_ITEM_BREAKERS = ("fence", "code_block", "table_open", "blockquote_open", "html_block", "hr", "heading_open")
_LIST_OPENS = ("bullet_list_open", "ordered_list_open")


def _list_blocks(tokens, hr_break: bool, notes: ImportNotes) -> list[dict[str, Any]]:
    """Fold a top-level list. A code block, table, quote or other block inside an item ends
    the list at that item: the item's text stays in the list, the item's remaining content
    follows as top-level blocks, and the next items continue in a new list that keeps the
    numbering. Dropping such content would lose commands written under numbered steps."""
    ordered = tokens[0].type == "ordered_list_open"
    start = _list_start(tokens[0]) if ordered else 1
    out: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    for inner in _item_spans(tokens[1:-1]):
        item, rest = _item(inner, ordered, nested=False, notes=notes)
        current.append(item)
        if rest:
            out.append(_list(ordered, current, start))
            start += len(current)
            current = []
            out.extend(_fold(rest, hr_break, notes))
    if current:
        out.append(_list(ordered, current, start))
    return out


def _list(ordered: bool, items: list[dict[str, Any]], start: int) -> dict[str, Any]:
    block: dict[str, Any] = {"type": "list", "ordered": ordered, "items": items}
    if ordered and start != 1:
        block["start"] = start
    return block


def _list_start(tok) -> int:
    value = tok.attrGet("start")
    return int(value) if value is not None else 1


def _item_spans(tokens):
    i = 0
    while i < len(tokens):
        if tokens[i].type != "list_item_open":
            i += 1
            continue
        j = _find_close(tokens, i)
        yield tokens[i + 1:j]
        i = j + 1


def _item(inner, parent_ordered: bool, nested: bool, notes: ImportNotes):
    """Returns (item, rest). `rest` is the token run from the first block the item cannot
    hold to the end of the item (top-level items only; empty when there is none)."""
    texts: list[str] = []
    children: list[dict[str, Any]] = []
    children_ordered: bool | None = None
    rest: list = []
    k = 0
    while k < len(inner):
        tk = inner[k]
        if tk.type in _ITEM_BREAKERS:
            if not nested:
                rest = inner[k:]
                break
            # a nested item has no place to put the block: report it instead of losing it silently
            end = _find_close(inner, k) if tk.nesting == 1 else k
            notes.dropped_list_blocks.append(_describe(inner[k:end + 1]))
            k = end + 1
        elif tk.type == "paragraph_open":
            texts.append(inner[k + 1].content.strip())
            k += 3
        elif tk.type in _LIST_OPENS:
            m = _find_close(inner, k)
            sub_ordered = tk.type == "ordered_list_open"
            if children_ordered is None:
                children_ordered = sub_ordered
            children.extend(_nested_items(inner[k + 1:m], sub_ordered, notes))
            k = m + 1
        elif tk.type == "inline":
            texts.append(tk.content.strip())
            k += 1
        else:
            k += 1
    item: dict[str, Any] = {"text": " ".join(texts)}
    if children:
        item["children"] = children
        if children_ordered != parent_ordered:
            item["childrenOrdered"] = children_ordered
    return item, rest


def _nested_items(tokens, ordered: bool, notes: ImportNotes) -> list[dict[str, Any]]:
    return [_item(inner, ordered, nested=True, notes=notes)[0] for inner in _item_spans(tokens)]


def _describe(tokens) -> str:
    tk = tokens[0]
    text = tk.content or next((t.content for t in tokens if t.type == "inline"), "")
    kind = tk.type.removesuffix("_open")
    return f"{kind}: {text.strip()[:40]}".replace("\n", " ")


def _table_block(tokens) -> dict[str, Any]:
    header: list[str] = []
    align: list[str] = []
    rows: list[list[str]] = []
    in_head = False
    row: list[str] | None = None
    for tk in tokens:
        if tk.type == "thead_open":
            in_head = True
        elif tk.type == "thead_close":
            in_head = False
        elif tk.type == "tr_open":
            row = []
        elif tk.type == "tr_close":
            if in_head:
                header = row or []
            else:
                rows.append(row or [])
            row = None
        elif tk.type in ("th_open", "td_open"):
            if in_head:
                style = tk.attrGet("style") or ""
                align.append(_align_from_style(style))
        elif tk.type == "inline" and row is not None:
            row.append(tk.content.strip())
    block: dict[str, Any] = {"type": "table", "header": header, "rows": rows}
    if any(a != "left" for a in align):
        block["align"] = align
    return block


def _align_from_style(style: str) -> str:
    for a in ("center", "right"):
        if a in style:
            return a
    return "left"


def doc_title_from_blocks(blocks: list[dict[str, Any]], fallback: str) -> str:
    for b in blocks:
        if b["type"] == "heading" and b["level"] == 1:
            return b["text"]
    return fallback
