"""HTML rendering: blocks, pages, final document and measurement document
(docs/02_pipeline.md section (6), docs/03 sections 3 and 7).

render.py only sees content blocks plus a Metrics/Layout pair; it never
reads layout values from the content JSON.
"""

from __future__ import annotations

import html
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import assets
from .content import CONTENT_SCRIPT_ID, FIGURE_TYPES, LAYOUT_SCRIPT_ID, embed_json, escape_for_script, strip_runtime_ids
from .inline import render_inline
from .layout import Layout, layout_to_dict
from .scale import Metrics


@dataclass
class RenderContext:
    metrics: Metrics
    layout: Layout
    image_base: Path            # directory image src paths are relative to
    html_dir: Path | None       # output directory (None = measurement, use absolute file paths)
    embed_images: bool = False


def _esc(s: str) -> str:
    return html.escape(s, quote=True)


# --------------------------------------------------------------------------
# blocks
# --------------------------------------------------------------------------

def render_block(block: dict[str, Any], ctx: RenderContext, mode: str) -> str:
    t = block["type"]
    bid = block.get("id", "")
    attr = f' data-block="{_esc(bid)}" data-type="{t}"'
    if t == "heading":
        lvl = block["level"]
        return f"<h{lvl}{attr}>{render_inline(block['text'])}</h{lvl}>"
    if t == "paragraph":
        return f"<p{attr}>{render_inline(block['text'])}</p>"
    if t == "quote":
        paras = "".join(f"<p>{render_inline(p)}</p>" for p in block["text"].split("\n\n"))
        return f"<blockquote{attr}>{paras}</blockquote>"
    if t == "list":
        if block.get("start", 1) != 1:
            attr += f' start="{int(block["start"])}"'
        return _render_list(block["items"], block["ordered"], attr, top=True)
    if t == "table":
        return _render_table(block, attr)
    if t == "code":
        lines = "".join(f'<span class="line">{_esc(line) or " "}</span>' for line in block["lines"])
        note = '<span class="continued-note">(続き)</span>' if block.get("continued") else ""
        lang = f' data-lang="{_esc(block["lang"])}"' if block.get("lang") else ""
        return f'<pre class="code"{attr}{lang}><code>{note}{lines}</code></pre>'
    if t == "html":
        return f'<div class="raw-html"{attr}>{block["html"]}</div>'
    if t in FIGURE_TYPES:
        return _render_figure(block, ctx, mode, attr)
    if t == "pagebreak":
        return ""
    raise ValueError(f"cannot render block type {t!r}")


def _render_list(items: list[dict[str, Any]], ordered: bool, attr: str, top: bool) -> str:
    tag = "ol" if ordered else "ul"
    out = [f"<{tag}{attr if top else ''}>"]
    for i, item in enumerate(items):
        marker = f' data-item="{i}"' if top else ""
        inner = render_inline(item["text"])
        if item.get("children"):
            inner += _render_list(item["children"], ordered, "", top=False)
        out.append(f"<li{marker}>{inner}</li>")
    out.append(f"</{tag}>")
    return "".join(out)


def _render_table(block: dict[str, Any], attr: str) -> str:
    align = block.get("align") or ["left"] * len(block["header"])
    cls = ' class="continued"' if block.get("continued") else ""
    out = [f"<table{cls}{attr}>"]
    if block.get("continued"):
        out.append("<caption>(続き)</caption>")
    out.append("<thead><tr>")
    for h, a in zip(block["header"], align):
        out.append(f'<th class="{a}">{render_inline(h)}</th>')
    out.append("</tr></thead><tbody>")
    for r, row in enumerate(block["rows"]):
        out.append(f'<tr data-row="{r}">')
        for c, a in zip(row, align):
            out.append(f'<td class="{a}">{render_inline(c)}</td>')
        out.append("</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def _render_figure(block: dict[str, Any], ctx: RenderContext, mode: str, attr: str) -> str:
    m = ctx.metrics
    ratio = ctx.layout.block_override(block.get("id", "")).get("maxHeightRatio")
    W, H, r = m.figure_box(mode, ratio)
    data = (f' data-figure-w="{W:.2f}" data-figure-h="{H:.2f}" data-figure-r="{r}"'
            f' data-image-scale="{ctx.layout.image_scale}"')
    if block["type"] == "mermaid":
        body = f'<pre class="mermaid">{_esc(block["source"])}</pre>'
        caption = ""
    else:
        src = _image_src(block["src"], ctx)
        body = f'<img src="{_esc(src)}" alt="{_esc(block["alt"])}">'
        cap = block.get("caption") or (block["alt"] if block["alt"] and block["alt"] != "diagram" else "")
        caption = f"<figcaption>{render_inline(cap)}</figcaption>" if cap else ""
    return f'<figure class="figure"{attr}{data}>{body}{caption}</figure>'


def _image_src(src: str, ctx: RenderContext) -> str:
    if src.startswith(("http://", "https://", "data:")):
        return src
    abs_path = (ctx.image_base / src).resolve()
    if ctx.embed_images:
        return _data_uri(abs_path)
    if ctx.html_dir is None:
        return abs_path.as_uri()
    return os.path.relpath(abs_path, ctx.html_dir.resolve()).replace(os.sep, "/")


def _data_uri(path: Path) -> str:
    import base64
    import mimetypes
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if not path.is_file():
        raise FileNotFoundError(f"image not found: {path}")
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


# --------------------------------------------------------------------------
# pages
# --------------------------------------------------------------------------

def render_page(page: dict[str, Any], ctx: RenderContext, page_no: int, total: int,
                doc_title: str, date_text: str | None) -> str:
    m = ctx.metrics
    fmt = m.fmt
    pid = page["id"]
    footer_left = _esc(doc_title) + (f' <span class="date">{_esc(date_text)}</span>' if date_text else "")
    footer = (f'<footer class="page-footer"><span class="footer-left">{footer_left}</span>'
              f'<span class="page-number">{page_no} / {total}</span></footer>')

    if page["kind"] == "cover":
        h1 = next((b for b in page["blocks"] if b["type"] == "heading" and b["level"] == 1), None)
        subtitle = next((b for b in page["blocks"] if b["type"] == "paragraph"), None)
        body = f"<h1>{render_inline(h1['text']) if h1 else _esc(doc_title)}</h1>"
        if subtitle:
            body += f'<p class="subtitle">{render_inline(subtitle["text"])}</p>'
        if date_text:
            body += f'<p class="date">{_esc(date_text)}</p>'
        return (f'<section class="page cover" data-page-id="{_esc(pid)}" data-mode="cover">'
                f'<div class="page-body">{body}</div>{footer}</section>')

    mode = page_mode(page, ctx)
    header = ""
    if fmt.is_slide:
        title = header_title(page, ctx, doc_title)
        cont = ' <span class="continued">(続き)</span>' if page.get("continued") else ""
        header = f'<header class="page-header"><span class="title">{render_inline(title)}{cont}</span></header>'
    if mode == "two":
        cols = _render_two_columns(page, ctx)
    else:
        figure = first_figure(page) if mode != "single" else None
        text_blocks = [b for b in page["blocks"] if b is not figure]
        figure_mode = "split" if mode != "single" else "single"
        col_text = "".join(render_block(b, ctx, figure_mode) for b in text_blocks)
        cols = f'<div class="column-text">{col_text}</div>'
        if figure is not None:
            cols += f'<div class="column-figure">{render_block(figure, ctx, "split")}</div>'
    return (f'<section class="page" data-page-id="{_esc(pid)}" data-mode="{mode}">{header}'
            f'<div class="page-body {mode}">{cols}</div>{footer}</section>')


def _render_two_columns(page: dict[str, Any], ctx: RenderContext) -> str:
    """N-order two-column page: segments of [left | right] columns and full-width bands.
    The placement (`_layout`) is computed by paginate; without it every block is a band."""
    blocks = page["blocks"]
    layout = page.get("_layout") or [{"kind": "wide", "index": i} for i in range(len(blocks))]
    out = []
    for seg in layout:
        if seg["kind"] == "cols":
            left = "".join(render_block(blocks[i], ctx, "col") for i in seg["left"])
            right = "".join(render_block(blocks[i], ctx, "col") for i in seg["right"])
            out.append(f'<div class="segment cols"><div class="col col-left">{left}</div><div class="col col-right">{right}</div></div>')
        else:
            out.append(f'<div class="segment wide">{render_block(blocks[seg["index"]], ctx, "single")}</div>')
    return f'<div class="column-text two">{"".join(out)}</div>'


def page_mode(page: dict[str, Any], ctx: RenderContext) -> str:
    """'two' | 'split-right' | 'split-left' | 'single' for a content page."""
    ov = ctx.layout.page_override(page["id"])
    columns = ov.get("columns", ctx.metrics.columns)
    if columns == "two":
        return "two"
    if columns == "single" or first_figure(page) is None:
        return "single"
    side = ov.get("figureSide", ctx.metrics.figure_side)
    return f"split-{side}"


def first_figure(page: dict[str, Any]) -> dict[str, Any] | None:
    for b in page["blocks"]:
        if b["type"] in FIGURE_TYPES:
            return b
    return None


def header_title(page: dict[str, Any], ctx: RenderContext, doc_title: str) -> str:
    mode = ctx.layout.header_title
    if mode == "doc":
        return doc_title
    if mode.startswith("fixed:"):
        return mode[len("fixed:"):]
    return page.get("title") or doc_title


# --------------------------------------------------------------------------
# documents
# --------------------------------------------------------------------------

def _head(ctx: RenderContext, title: str, needs_mermaid: bool, needs_fa: bool, out_dir: Path | None) -> str:
    """out_dir=None means a temporary (measurement) document: always embed the library."""
    lib_mode = ctx.layout.mermaid_lib if out_dir is not None else "embed"
    m = ctx.metrics
    parts = [
        "<!DOCTYPE html>",
        f'<html lang="ja" data-mermaid-font-size="{m.F * 0.9:.1f}px">',
        "<head>",
        '<meta charset="UTF-8">',
        f"<title>{_esc(title)}</title>",
        "<style>\n" + m.css_vars() + assets.base_css() + "\n</style>",
    ]
    if ctx.layout.css:
        parts.append("<style>\n" + Path(ctx.layout.css).read_text(encoding="utf-8") + "\n</style>")
    if needs_fa:
        parts.append(assets.fontawesome_style_tag())
    if needs_mermaid:
        parts.append(assets.mermaid_script_tag(lib_mode, out_dir, ctx.layout.mermaid_version))
    parts.append("</head>")
    return "\n".join(parts)


def _effective_layout(layout) -> dict[str, Any]:
    """Layout JSON to embed: pins the Mermaid version actually used, so that a
    later `build out.html` renders with the same version (figure sizes, and
    therefore pagination, depend on it)."""
    out = layout_to_dict(layout)
    out["mermaidVersion"] = assets.resolve_mermaid_version(layout.mermaid_version)
    return out


def _needs(blocks: list[dict[str, Any]]) -> tuple[bool, bool]:
    mermaid = [b for b in blocks if b["type"] == "mermaid"]
    needs_fa = any("fa:" in b["source"] for b in mermaid)
    return bool(mermaid), needs_fa


def render_document(doc: dict[str, Any], pages: list[dict[str, Any]], ctx: RenderContext,
                    date_text: str | None) -> str:
    title = doc["meta"]["title"]
    all_blocks = [b for p in pages for b in p["blocks"]]
    needs_mermaid, needs_fa = _needs(all_blocks)
    head = _head(ctx, title, needs_mermaid, needs_fa, ctx.html_dir)
    body = ["<body>"]
    src_page = doc["pages"][0] if doc["pages"][0]["kind"] == "source" else None
    if src_page is not None:
        src_attr = f' data-source="{_esc(doc["meta"].get("source") or "")}"'
        body.append(f'<script type="text/markdown" id="page-0"{src_attr}>\n'
                    + escape_for_script(src_page["blocks"][0]["text"]) + "\n</script>")
    # The HTML carries its own content JSON and layout so that `build out.html` can
    # regenerate it without the original JSON (docs/07 section 9).
    embedded = {"version": doc["version"], "meta": dict(doc["meta"]),
                "pages": ([src_page] if src_page is not None else []) + list(pages)}
    embedded = strip_runtime_ids(embedded)
    source = doc["meta"].get("source")
    if source and ctx.html_dir is not None:
        md_path = (ctx.image_base / Path(source).name).resolve()
        embedded["meta"]["source"] = os.path.relpath(md_path, ctx.html_dir.resolve()).replace(os.sep, "/")
    body.append(f'<script type="application/json" id="{CONTENT_SCRIPT_ID}">\n' + embed_json(embedded) + "\n</script>")
    body.append(f'<script type="application/json" id="{LAYOUT_SCRIPT_ID}">\n'
                + embed_json(_effective_layout(ctx.layout)) + "\n</script>")
    total = len(pages)
    for i, page in enumerate(pages, start=1):
        body.append(render_page(page, ctx, i, total, title, date_text))
    body.append("<script>\n" + assets.figures_js() + "\n</script>")
    body.append(assets.page_number_script())
    body.append("</body></html>")
    return head + "\n" + "\n".join(body)


def render_measure_document(blocks: list[dict[str, Any]], ctx: RenderContext) -> str:
    """One or two flow containers (text column width and single width)."""
    m = ctx.metrics
    needs_mermaid, needs_fa = _needs(blocks)
    head = _head(ctx, "measure", needs_mermaid, needs_fa, None)
    body = ["<body>"]
    widths: list[tuple[str, float, str]] = []
    if m.columns == "two":
        widths.append(("col", m.col2_px, "col"))
    elif m.columns == "split":
        widths.append(("col", m.text_col_px, "split"))
    widths.append(("single", m.content_w_px, "single"))
    for name, width, fig_mode in widths:
        body.append(f'<div class="measure" data-measure="{name}" style="width:{width:.2f}px">')
        for b in blocks:
            body.append(render_block(b, ctx, fig_mode))
        body.append("</div>")
    body.append("<script>\n" + assets.figures_js() + "\n</script>")
    body.append("</body></html>")
    return head + "\n" + "\n".join(body)
