#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "markdown-it-py>=3.0",
#   "mdit-py-plugins>=0.4",
#   "playwright>=1.45",
# ]
# ///
"""gospelo-md2html: Markdown + Mermaid -> paginated HTML / PDF.

Run with uv:  uv run <skill>/scripts/md2html.py <subcommand> ...
Subcommands:  setup | import | check | build | restore
Repository: https://github.com/gospelo-dev/md2html (README, quickstart, references).
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from md2html import assets, blocks as blocks_mod, content as content_mod, report as report_mod  # noqa: E402
from md2html.formats import get_format  # noqa: E402
from md2html.layout import Layout, LayoutError, build_layout  # noqa: E402
from md2html.measure import Browser, MeasureError, measure_document, verify_document  # noqa: E402
from md2html.paginate import BlockHeight, PaginateContext, Spill, flatten_for_reflow, paginate, spill_pages  # noqa: E402
from md2html.render import RenderContext, first_figure, page_mode, render_document, render_measure_document  # noqa: E402
from md2html.scale import SAFETY, Metrics, build_metrics  # noqa: E402

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NOT_CONVERGED = 2
MAX_VERIFY_ROUNDS = 3


class CliError(Exception):
    pass


# --------------------------------------------------------------------------
# argument parsing
# --------------------------------------------------------------------------

def _add_layout_args(p: argparse.ArgumentParser) -> None:
    g = p.add_argument_group("layout")
    g.add_argument("--layout", type=Path, help="layout JSON (CLI options win)")
    g.add_argument("--page", choices=["a4", "a4-landscape", "a3", "a3-landscape", "16x9", "4x3"])
    g.add_argument("--font-size", dest="font_size", help="body font size: 11pt / 14px / 3.5mm")
    g.add_argument("--title-scale", dest="title_scale", type=float)
    g.add_argument("--header-title", dest="header_title", help="section | doc | fixed:<text>")
    g.add_argument("--columns", choices=["split", "single"])
    g.add_argument("--figure-side", dest="figure_side", choices=["left", "right"])
    g.add_argument("--split-ratio", dest="split_ratio", type=float)
    g.add_argument("--details", choices=["drop", "expand"])
    g.add_argument("--mermaid-lib", dest="mermaid_lib", choices=["embed", "link"])
    g.add_argument("--hr-break", dest="hr_break", action="store_const", const=True)
    g.add_argument("--image-scale", dest="image_scale", type=float)
    g.add_argument("--embed-images", dest="embed_images", action="store_const", const=True)
    g.add_argument("--date", help="YYYY-MM-DD or none")
    g.add_argument("--css", help="extra CSS file")


def make_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="md2html.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("setup", help="install Chromium for Playwright (first run only)")

    pi = sub.add_parser("import", help="Markdown -> content JSON (paginated)")
    pi.add_argument("input", type=Path)
    pi.add_argument("-o", "--output", type=Path, help="content JSON path (default: <input>.json)")
    pi.add_argument("--force", action="store_true", help="overwrite an existing content JSON")
    pi.add_argument("--dry-run", dest="dry_run", action="store_true")
    pi.add_argument("--report", type=Path)
    pi.add_argument("--verbose", action="store_true")
    _add_layout_args(pi)

    pc = sub.add_parser("check", help="verify a content JSON and report capacity (writes nothing)")
    pc.add_argument("content", type=Path)
    pc.add_argument("--report", type=Path)
    pc.add_argument("--verbose", action="store_true")
    _add_layout_args(pc)

    pb = sub.add_parser("build", help="content JSON -> HTML (and PDF)")
    pb.add_argument("content", type=Path)
    pb.add_argument("-o", "--output", type=Path, help="HTML path (default: <content>.html)")
    pb.add_argument("--pdf", type=Path)
    pb.add_argument("--report", type=Path)
    pb.add_argument("--reflow", action="store_true", help="re-paginate everything, rewrite the JSON and exit")
    pb.add_argument("--no-write-back", dest="no_write_back", action="store_true")
    pb.add_argument("--verbose", action="store_true")
    _add_layout_args(pb)

    pr = sub.add_parser("restore", help="write the original Markdown from page 0 of a JSON or HTML")
    pr.add_argument("source", type=Path)
    pr.add_argument("-o", "--output", type=Path, required=True)
    return p


def layout_from_args(args: argparse.Namespace) -> Layout:
    cli = {
        "page": args.page, "font_size": args.font_size, "title_scale": args.title_scale,
        "header_title": args.header_title, "columns": args.columns, "figure_side": args.figure_side,
        "split_ratio": args.split_ratio, "details": args.details, "mermaid_lib": args.mermaid_lib,
        "hr_break": args.hr_break, "image_scale": args.image_scale, "embed_images": args.embed_images,
        "date": args.date, "css": args.css,
    }
    return build_layout(args.layout, cli)


def metrics_from_layout(layout: Layout) -> Metrics:
    fmt = get_format(layout.page)
    return build_metrics(fmt, layout.font_size, layout.title_scale, layout.columns, layout.figure_side, layout.split_ratio)


def date_text(layout: Layout, doc_date: str | None) -> str | None:
    if layout.date == "none":
        return None
    if layout.date:
        return layout.date
    if doc_date:
        return doc_date
    return dt.date.today().isoformat()


# --------------------------------------------------------------------------
# shared pipeline pieces
# --------------------------------------------------------------------------

def _temp_html(dir_: Path, prefix: str) -> Path:
    fd, name = tempfile.mkstemp(prefix=f".md2html-{prefix}-", suffix=".html", dir=str(dir_))
    os.close(fd)
    return Path(name)


def measure_heights(browser: Browser, blocks: list[dict[str, Any]], ctx: RenderContext, work_dir: Path,
                    keep: bool = False) -> tuple[dict[str, BlockHeight], dict[str, BlockHeight]]:
    """Measure every block. Returns (heights at text-column width, heights at single width)."""
    html_text = render_measure_document(blocks, ctx)
    path = _temp_html(work_dir, "measure")
    try:
        path.write_text(html_text, encoding="utf-8")
        raw = measure_document(browser, path)
    finally:
        if not keep:
            path.unlink(missing_ok=True)
    single = {k: BlockHeight.from_js(v) for k, v in raw["single"].items()}
    col = {k: BlockHeight.from_js(v) for k, v in raw["col"].items()} if "col" in raw else single
    missing = [b["id"] for b in blocks if b["id"] not in single and b["type"] != "pagebreak"]
    if missing:
        raise CliError(f"measurement returned no height for blocks: {', '.join(missing)}")
    return col, single


def make_paginate_ctx(metrics: Metrics, columns: str, heights_col, heights_single, doc_title: str) -> PaginateContext:
    heights = heights_col if columns == "split" else heights_single
    return PaginateContext(
        is_slide=metrics.fmt.is_slide, columns=columns, capacity=metrics.content_h_px * SAFETY,
        line_px=metrics.line_px, heights=dict(heights), heights_single=dict(heights_single), doc_title=doc_title,
    )


def assign_page_ids(pages: list[dict[str, Any]], start: int = 1) -> None:
    for i, p in enumerate(pages, start=start):
        p["id"] = f"p{i:02d}"


def verify_and_fix(browser: Browser, doc: dict[str, Any], pages: list[dict[str, Any]], ctx: RenderContext,
                   date: str | None, work_dir: Path, verbose: bool) -> tuple[str, list[dict[str, Any]], int]:
    """Render, verify, and push overflowing tail blocks to continuation pages. Returns (html, verify, rounds)."""
    rounds = 0
    while True:
        html_text = render_document(doc, pages, ctx, date)
        path = _temp_html(work_dir, "verify")
        keep = os.environ.get("MD2HTML_KEEP_TEMP") == "1"
        try:
            path.write_text(html_text, encoding="utf-8")
            verify = verify_document(browser, path)
        finally:
            if not keep:
                path.unlink(missing_ok=True)
        overflowing = [v for v in verify if v["overflowPx"] > 0 and v["mode"] != "cover"]
        if not overflowing:
            return html_text, verify, rounds
        rounds += 1
        if verbose:
            for v in overflowing:
                ids = ",".join(b["id"] for b in v["blocks"])
                print(f"  verify round {rounds}: {v['id']} overflow {v['overflowPx']}px used {v['usedPx']}/{v['contentHeightPx']} blocks={ids}", file=sys.stderr)
            if keep:
                print(f"  kept {path}", file=sys.stderr)
        if rounds > MAX_VERIFY_ROUNDS:
            ids = ", ".join(v["id"] for v in overflowing)
            raise CliError(f"verification did not converge after {MAX_VERIFY_ROUNDS} rounds; overflowing pages: {ids}")
        pages = _push_last_blocks(pages, {v["id"]: v for v in overflowing})


def _push_last_blocks(pages: list[dict[str, Any]], overflowing: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Move the last text block of each overflowing page to a continuation page.
    A lone table / list / code block is split using the unit heights measured
    in the verify pass instead, so a single-block page can always make progress."""
    out: list[dict[str, Any]] = []
    existing = {p["id"] for p in pages}
    for page in pages:
        v = overflowing.get(page["id"])
        if v is None:
            out.append(page)
            continue
        fig = first_figure(page)
        text_blocks = [b for b in page["blocks"] if b is not fig]
        if not text_blocks:
            out.append(page)
            continue
        moved: dict[str, Any] | None = None
        keep: list[dict[str, Any]]
        if len(text_blocks) == 1:
            split = _split_by_verify(text_blocks[0], v)
            if split is None:
                out.append(page)  # cannot shrink further; reported as clipped
                continue
            head, tail = split
            keep = [head if b is text_blocks[0] else b for b in page["blocks"]]
            moved = tail
        else:
            moved = text_blocks[-1]
            keep = [b for b in page["blocks"] if b is not moved]
        n = 2
        while f"{page['id']}-{n}" in existing:
            n += 1
        new_id = f"{page['id']}-{n}"
        existing.add(new_id)
        out.append(dict(page, blocks=keep))
        out.append({"id": new_id, "kind": "content", "title": page["title"], "continued": page["title"] is not None,
                    "blocks": [moved]})
    return out


def _split_by_verify(block: dict[str, Any], v: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    info = next((b for b in v["blocks"] if b["id"] == block["id"]), None)
    if info is None:
        return None
    overflow = v["overflowPx"] + 1
    t = block["type"]
    tail_id = f"{block['id']}.2"
    if t == "table" and info.get("rowHeightsPx") and len(block["rows"]) > 1:
        heights = info["rowHeightsPx"]
        cut = len(heights)
        removed = 0.0
        while cut > 1 and removed < overflow:
            cut -= 1
            removed += heights[cut]
        if cut < 1 or cut >= len(block["rows"]):
            return None
        return dict(block, rows=block["rows"][:cut]), dict(block, rows=block["rows"][cut:], continued=True, id=tail_id)
    if t == "list" and info.get("itemHeightsPx") and len(block["items"]) > 1:
        heights = info["itemHeightsPx"]
        cut = len(heights)
        removed = 0.0
        while cut > 1 and removed < overflow:
            cut -= 1
            removed += heights[cut]
        if cut < 1 or cut >= len(block["items"]):
            return None
        tail = dict(block, items=block["items"][cut:], id=tail_id)
        if block.get("ordered"):
            tail["start"] = int(block.get("start", 1)) + cut
        return dict(block, items=block["items"][:cut]), tail
    if t == "code" and info.get("lineHeightPx") and len(block["lines"]) > 1:
        lh = info["lineHeightPx"]
        n_remove = int(overflow // lh) + 1
        cut = len(block["lines"]) - n_remove
        if cut < 1:
            return None
        return dict(block, lines=block["lines"][:cut]), dict(block, lines=block["lines"][cut:], continued=True, id=tail_id)
    return None


def resolve_image_base(content_path: Path, doc: dict[str, Any]) -> Path:
    src = doc["meta"].get("source")
    if src:
        return (content_path.parent / Path(src).parent).resolve()
    return content_path.parent.resolve()


def print_verbose_heights(heights: dict[str, BlockHeight]) -> None:
    for k, v in heights.items():
        print(f"    {k:<12} {v.height:7.1f}px  mt {v.margin_top:4.0f} mb {v.margin_bottom:4.0f}", file=sys.stderr)


# --------------------------------------------------------------------------
# subcommands
# --------------------------------------------------------------------------

def cmd_setup(args: argparse.Namespace) -> int:
    print("Installing Chromium for Playwright ...")
    result = subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"])
    if result.returncode != 0:
        raise CliError("playwright install chromium failed")
    print("done")
    return EXIT_OK


def cmd_import(args: argparse.Namespace) -> int:
    src: Path = args.input
    if not src.is_file():
        raise CliError(f"input not found: {src}")
    out_path: Path = args.output or src.with_suffix(".json")
    if out_path.exists() and not args.force and not args.dry_run:
        raise CliError(f"{out_path} already exists; pass --force to overwrite (this discards edits)")
    layout = layout_from_args(args)
    metrics = metrics_from_layout(layout)

    original = src.read_text(encoding="utf-8")
    notes = blocks_mod.ImportNotes()
    text = blocks_mod.preprocess_markdown(original, layout.details, notes)
    block_list = blocks_mod.parse_blocks(text, layout.hr_break, notes)
    if not block_list:
        raise CliError("no content blocks found in the Markdown")
    for i, b in enumerate(block_list):
        b["id"] = f"b{i}"
    title = blocks_mod.doc_title_from_blocks(block_list, src.stem)
    date = date_text(layout, None)

    doc: dict[str, Any] = {
        "version": content_mod.SCHEMA_VERSION,
        "meta": {"title": title, "date": date, "source": os.path.relpath(src.resolve(), out_path.resolve().parent).replace(os.sep, "/")},
        "pages": [content_mod.make_source_page(original)],
    }
    image_base = src.resolve().parent
    work_dir = out_path.resolve().parent
    work_dir.mkdir(parents=True, exist_ok=True)
    measure_ctx = RenderContext(metrics, layout, image_base, None)

    with Browser() as browser:
        heights_col, heights_single = measure_heights(browser, block_list, measure_ctx, work_dir)
        if args.verbose:
            print_verbose_heights(heights_col)
        pctx = make_paginate_ctx(metrics, metrics.columns, heights_col, heights_single, title)
        pages = [p.to_json() for p in paginate(block_list, pctx)]
        assign_page_ids(pages)
        for p in pages:
            for b in p["blocks"]:
                b.pop("id", None)
        doc["pages"].extend(pages)
        content_mod.validate_content(doc, str(out_path))
        content_mod.assign_block_ids(doc)
        final_ctx = RenderContext(metrics, layout, image_base, work_dir, layout.embed_images)
        html_text, verify, rounds = verify_and_fix(browser, doc, content_mod.content_pages(doc), final_ctx, date, work_dir, args.verbose)
    # verify_and_fix may have pushed blocks to new pages: take its page order and renumber sequentially
    final_pages = _replay_push(content_mod.content_pages(doc), verify)
    assign_page_ids(final_pages)
    for p in final_pages:
        for b in p["blocks"]:
            b.pop("id", None)
            b.pop("_generated_id", None)
    doc["pages"] = [doc["pages"][0]] + final_pages
    content_mod.assign_block_ids(doc)
    for v, p in zip(verify, final_pages):
        v["id"] = p["id"]
    report = report_mod.build_report(metrics, metrics.columns, verify, [], pctx.warnings, _notes_dict(notes))
    report["verifyRounds"] = rounds
    report_mod.print_summary(report, "import (dry-run)" if args.dry_run else "import")
    if args.report:
        report_mod.write_report(report, args.report)
    if args.dry_run:
        print(f"dry run: {out_path} not written")
        return EXIT_OK
    content_mod.save_content(doc, out_path)
    print(f"wrote {out_path}")
    return EXIT_OK


def _notes_dict(notes: blocks_mod.ImportNotes) -> dict[str, Any]:
    return {
        "droppedDetails": notes.dropped_details,
        "expandedDetails": notes.expanded_details,
        "rescuedMermaid": notes.rescued_mermaid,
        "discardedImages": notes.discarded_images,
        "htmlBlocks": notes.html_blocks,
        "ignoredHr": notes.ignored_hr,
    }


def _prepare_build(args: argparse.Namespace):
    content_path: Path = args.content
    doc = content_mod.load_content(content_path)
    layout = layout_from_args(args)
    metrics = metrics_from_layout(layout)
    image_base = resolve_image_base(content_path, doc)
    return content_path, doc, layout, metrics, image_base


def _build_pages(browser: Browser, doc, layout: Layout, metrics: Metrics, image_base: Path, work_dir: Path, verbose: bool):
    """Measure all blocks, spill per page. Returns (pages, spills, warnings)."""
    pages = content_mod.content_pages(doc)
    all_blocks = [b for p in pages for b in p["blocks"]]
    measure_ctx = RenderContext(metrics, layout, image_base, None)
    heights_col, heights_single = measure_heights(browser, all_blocks, measure_ctx, work_dir)
    if verbose:
        print_verbose_heights(heights_col)
    warnings: list[str] = []
    render_ctx_probe = RenderContext(metrics, layout, image_base, None)

    def columns_for_page(page: dict[str, Any]) -> str:
        mode = page_mode(page, render_ctx_probe)
        return "single" if mode == "single" else "split"

    def make_ctx(columns: str) -> PaginateContext:
        ctx = make_paginate_ctx(metrics, columns, heights_col, heights_single, doc["meta"]["title"])
        ctx.warnings = warnings
        return ctx

    new_pages, spills = spill_pages(pages, make_ctx, columns_for_page)
    return new_pages, spills, warnings


def cmd_check(args: argparse.Namespace) -> int:
    content_path, doc, layout, metrics, image_base = _prepare_build(args)
    work_dir = content_path.resolve().parent
    date = date_text(layout, doc["meta"].get("date"))
    with Browser() as browser:
        pages, spills, warnings = _build_pages(browser, doc, layout, metrics, image_base, work_dir, args.verbose)
        final_ctx = RenderContext(metrics, layout, image_base, work_dir, layout.embed_images)
        _, verify, rounds = verify_and_fix(browser, doc, pages, final_ctx, date, work_dir, args.verbose)
    report = report_mod.build_report(metrics, metrics.columns, verify, [s.__dict__ | {"from": s.source, "to": s.target} for s in spills], warnings)
    report["verifyRounds"] = rounds
    _fix_spill_keys(report)
    report_mod.print_summary(report, "check")
    if args.report:
        report_mod.write_report(report, args.report)
    return EXIT_OK


def _fix_spill_keys(report: dict[str, Any]) -> None:
    report["spills"] = [{"from": s["from"], "to": s["to"], "blocks": s["blocks"]} for s in report["spills"]]


def cmd_build(args: argparse.Namespace) -> int:
    content_path, doc, layout, metrics, image_base = _prepare_build(args)
    out_path: Path = args.output or content_path.with_suffix(".html")
    out_dir = out_path.resolve().parent
    out_dir.mkdir(parents=True, exist_ok=True)
    date = date_text(layout, doc["meta"].get("date"))

    if args.reflow:
        return _cmd_reflow(content_path, doc, layout, metrics, image_base, args.verbose)

    with Browser() as browser:
        pages, spills, warnings = _build_pages(browser, doc, layout, metrics, image_base, out_dir, args.verbose)
        final_ctx = RenderContext(metrics, layout, image_base, out_dir, layout.embed_images)
        html_text, verify, rounds = verify_and_fix(browser, doc, pages, final_ctx, date, out_dir, args.verbose)
        out_path.write_text(html_text, encoding="utf-8")
        print(f"wrote {out_path}")
        if args.pdf:
            browser.export_pdf(out_path, args.pdf)
            print(f"wrote {args.pdf}")

    # pages after verify may contain pushed continuation pages; rebuild from verify order
    by_id = {p["id"]: p for p in pages}
    final_pages = [by_id[v["id"]] for v in verify if v["id"] in by_id]
    pushed = [v["id"] for v in verify if v["id"] not in by_id]
    if pushed:
        # verify_and_fix created pages we do not hold here; rebuild by re-deriving from html is not possible,
        # so re-run the push logic deterministically to obtain the same page objects.
        final_pages = _replay_push(pages, verify)
    changed = bool(spills) or bool(pushed)
    if changed and not args.no_write_back:
        doc["pages"] = ([doc["pages"][0]] if doc["pages"][0]["kind"] == "source" else []) + final_pages
        content_mod.save_content(doc, content_path)
        print(f"wrote back {content_path} (auto spill)")
    report = report_mod.build_report(metrics, metrics.columns, verify,
                                     [{"from": s.source, "to": s.target, "blocks": s.blocks} for s in spills], warnings)
    report["verifyRounds"] = rounds
    report_mod.print_summary(report, "build")
    if args.report:
        report_mod.write_report(report, args.report)
    return EXIT_OK


def _replay_push(pages: list[dict[str, Any]], verify: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reconstruct the page list produced inside verify_and_fix from the verify result."""
    by_id = {p["id"]: p for p in pages}
    block_index: dict[str, dict[str, Any]] = {}
    for p in pages:
        for b in p["blocks"]:
            block_index[b["id"]] = b
    out = []
    for v in verify:
        if v["id"] in by_id:
            src = by_id[v["id"]]
            ids = {b["id"] for b in v["blocks"]} | ({v["figure"]["id"]} if v.get("figure") else set())
            out.append(dict(src, blocks=[b for b in src["blocks"] if b["id"] in ids]))
        else:
            base = v["id"].rsplit("-", 1)[0]
            src = by_id.get(base) or next((p for p in pages if v["id"].startswith(p["id"])), None)
            ids = [b["id"] for b in v["blocks"]] + ([v["figure"]["id"]] if v.get("figure") else [])
            out.append({"id": v["id"], "kind": "content", "title": src["title"] if src else None,
                        "continued": bool(src and src["title"]), "blocks": [block_index[i] for i in ids if i in block_index]})
    return out


def _cmd_reflow(content_path: Path, doc, layout: Layout, metrics: Metrics, image_base: Path, verbose: bool) -> int:
    flat = flatten_for_reflow(doc["pages"])
    for i, b in enumerate(flat):
        b["id"] = f"b{i}"
    work_dir = content_path.resolve().parent
    measure_ctx = RenderContext(metrics, layout, image_base, None)
    with Browser() as browser:
        heights_col, heights_single = measure_heights(browser, flat, measure_ctx, work_dir)
        pctx = make_paginate_ctx(metrics, metrics.columns, heights_col, heights_single, doc["meta"]["title"])
        pages = [p.to_json() for p in paginate(flat, pctx)]
    assign_page_ids(pages)
    for p in pages:
        for b in p["blocks"]:
            b.pop("id", None)
    head = [doc["pages"][0]] if doc["pages"][0]["kind"] == "source" else []
    doc["pages"] = head + pages
    content_mod.validate_content(doc, str(content_path))
    content_mod.save_content(doc, content_path)
    print(f"reflowed {content_path}: {len(pages)} pages (no HTML written; run build next)")
    for w in pctx.warnings:
        print(f"  warning: {w}")
    return EXIT_OK


def cmd_restore(args: argparse.Namespace) -> int:
    text = content_mod.restore_markdown(args.source)
    args.output.write_text(text, encoding="utf-8")
    print(f"wrote {args.output}")
    return EXIT_OK


# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    if shutil.which("uv") is None and os.environ.get("MD2HTML_ALLOW_NO_UV") != "1":
        print("error: uv is required. Install: curl -LsSf https://astral.sh/uv/install.sh | sh", file=sys.stderr)
        return EXIT_ERROR
    parser = make_parser()
    args = parser.parse_args(argv)
    handlers = {"setup": cmd_setup, "import": cmd_import, "check": cmd_check, "build": cmd_build, "restore": cmd_restore}
    try:
        return handlers[args.command](args)
    except (CliError, LayoutError, content_mod.ContentError, assets.AssetError, MeasureError, ValueError, FileNotFoundError) as e:
        msg = str(e)
        print(f"error: {msg}", file=sys.stderr)
        return EXIT_NOT_CONVERGED if "did not converge" in msg else EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
