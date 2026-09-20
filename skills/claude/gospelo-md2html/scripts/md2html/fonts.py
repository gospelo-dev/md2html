"""Embedded web fonts: subsets of the vendored BIZ UD fonts covering the characters
a document uses, written as @font-face data URIs into the document head.

Why: the same glyphs then render identically on every machine (viewer and
builder alike, so pagination is reproducible), and Chromium embeds the glyf
TrueType subsets into the PDF at a few hundred KB instead of substituting a
2 MB Osaka-Mono for the CFF-based Hiragino. Only the vendored families that
appear in the effective font stacks are embedded; a custom --font-family that
names another font is not embedded (it must exist on the viewer's machine).

Each face is subset to the characters that can actually reach it: the regular
body face gets every character, the bold body face only what base.css renders
bold (headings, table headers, strong spans, page titles), and a family named
in the code stack gets only what code blocks and inline code contain. A family
in the code stack is embedded at weight 400 only; bold code is synthesised.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .assets import VENDOR, AssetError
from .inline import _md

FONT_DIR = VENDOR / "fonts" / "bizud"

# base.css keeps the same lists as its var() fallbacks (tests assert they match)
DEFAULT_BODY_STACK = "-apple-system, 'Helvetica Neue', 'BIZ UDPGothic', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif"
DEFAULT_CODE_STACK = "'SFMono-Regular', Menlo, 'BIZ UDGothic', 'Noto Sans Mono CJK JP', monospace"

# characters the chrome (header, footer, continuation notes) can show whatever the content
ALWAYS = "0123456789 /()（続き）.-:"
ASCII = "".join(chr(c) for c in range(0x20, 0x7F))

BODY, BOLD, CODE = "body", "bold", "code"


@dataclass(frozen=True)
class VendoredFont:
    family: str
    weight: int
    file: str


VENDORED = (
    VendoredFont("BIZ UDPGothic", 400, "BIZUDPGothic-Regular.woff2"),
    VendoredFont("BIZ UDPGothic", 700, "BIZUDPGothic-Bold.woff2"),
    VendoredFont("BIZ UDGothic", 400, "BIZUDGothic-Regular.woff2"),
    VendoredFont("BIZ UDGothic", 700, "BIZUDGothic-Bold.woff2"),
)


# --------------------------------------------------------------------------
# which characters reach which face
# --------------------------------------------------------------------------

def inline_runs(text: str) -> list[tuple[str, str]]:
    """(kind, text) runs of an inline-Markdown string: kind is body, bold or code."""
    tokens = _md.parseInline(text)[0].children or []
    runs: list[tuple[str, str]] = []
    strong = 0
    for tok in tokens:
        if tok.type == "strong_open":
            strong += 1
        elif tok.type == "strong_close":
            strong -= 1
        elif tok.type == "code_inline":
            runs.append((CODE, tok.content))
        elif tok.type == "text":
            runs.append((BOLD if strong else BODY, tok.content))
        elif tok.type == "html_inline":
            runs.append((BODY, tok.content))
            runs.append((BOLD, tok.content))
    return runs


def character_sets(blocks: Iterable[dict[str, Any]], titles: Iterable[str], extra: str = "") -> dict[str, str]:
    """Text per face role for a document: body (everything), bold, code."""
    parts: dict[str, list[str]] = {BODY: [ALWAYS, extra], BOLD: [ALWAYS, extra], CODE: [ASCII]}

    def inline(text: str, bold: bool = False) -> None:
        for kind, s in inline_runs(text):
            parts[BOLD if bold and kind == BODY else kind].append(s)

    def items(lst: list[dict[str, Any]]) -> None:
        for it in lst:
            inline(it["text"])
            if it.get("children"):
                items(it["children"])

    for t in titles:
        parts[BOLD].append(t)
    for b in blocks:
        t = b["type"]
        if t == "heading":
            inline(b["text"], bold=True)
        elif t in ("paragraph", "quote"):
            inline(b["text"])
        elif t == "list":
            items(b["items"])
        elif t == "table":
            for h in b["header"]:
                inline(h, bold=True)
            for row in b["rows"]:
                for c in row:
                    inline(c)
        elif t == "code":
            parts[CODE].append("\n".join(b["lines"]))
        elif t == "mermaid":
            # diagram labels use the body font; some diagram types set labels bold
            parts[BODY].append(b["source"])
            parts[BOLD].append(b["source"])
        elif t == "image":
            inline(b.get("caption") or b["alt"])
        elif t in ("html", "markdown"):
            raw = b.get("html") or b.get("text") or ""
            for k in parts:
                parts[k].append(raw)
    body = "".join(parts[BODY]) + "".join(parts[BOLD])   # the regular face covers bold text too
    return {BODY: body, BOLD: "".join(parts[BOLD]), CODE: "".join(parts[CODE])}


# --------------------------------------------------------------------------
# subsetting and CSS
# --------------------------------------------------------------------------

def families_in_stacks(font_family: str | None, code_font_family: str | None) -> set[str]:
    stacks = (font_family or DEFAULT_BODY_STACK) + "," + (code_font_family or DEFAULT_CODE_STACK)
    return {f.family for f in VENDORED if f.family in stacks}


def faces_to_embed(font_family: str | None, code_font_family: str | None) -> list[tuple[VendoredFont, list[str]]]:
    """(face, roles) pairs: a family in the body stack gets 400 for body text and 700 for bold
    text; a family in the code stack gets 400 for code text. Roles merge when both apply."""
    body_stack = font_family or DEFAULT_BODY_STACK
    code_stack = code_font_family or DEFAULT_CODE_STACK
    out: list[tuple[VendoredFont, list[str]]] = []
    for f in VENDORED:
        roles: list[str] = []
        if f.family in body_stack:
            roles.append(BODY if f.weight == 400 else BOLD)
        if f.family in code_stack and f.weight == 400:
            roles.append(CODE)
        if roles:
            out.append((f, roles))
    return out


def subset_woff2(path: Path, text: str) -> bytes:
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:  # pragma: no cover - uv resolves this
        raise AssetError("fonttools is not installed; run this script with uv run") from None
    if not path.is_file():
        raise AssetError(f"required asset is missing: {path}")
    font = TTFont(path)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.hinting = False
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue()


def font_face_css(texts: dict[str, str], font_family: str | None, code_font_family: str | None) -> str:
    """@font-face rules (data URIs) for the vendored faces the stacks use, each subset to its roles' text."""
    rules = []
    for f, roles in faces_to_embed(font_family, code_font_family):
        text = "".join(texts[r] for r in roles)
        data = base64.b64encode(subset_woff2(FONT_DIR / f.file, text)).decode("ascii")
        rules.append(f"@font-face {{ font-family: '{f.family}'; font-weight: {f.weight}; font-style: normal; "
                     f"font-display: block; src: url(data:font/woff2;base64,{data}) format('woff2'); }}")
    return "\n".join(rules) + ("\n" if rules else "")


def embedded_font_css(blocks: Iterable[dict[str, Any]], titles: Iterable[str], layout, extra: str = "") -> str:
    """The CSS to put in the head, or '' when embedding is off or no vendored family is in the stacks."""
    if not layout.embed_fonts:
        return ""
    if not faces_to_embed(layout.font_family, layout.code_font_family):
        return ""
    return font_face_css(character_sets(blocks, titles, extra), layout.font_family, layout.code_font_family)
