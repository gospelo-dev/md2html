"""Playwright measurement pass, verification pass and PDF export
(docs/04_layout_logic.md sections 4.3 and 4.4, docs/02 section (8)).

One Chromium instance is shared across passes. Every page load waits for
figures.js to finish (<html data-figures="done">); an error state aborts.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

FIGURES_TIMEOUT_MS = 120_000


class MeasureError(RuntimeError):
    pass


class Browser:
    def __init__(self) -> None:
        self._pw = None
        self._browser = None

    def __enter__(self) -> "Browser":
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:  # pragma: no cover - uv resolves this
            raise MeasureError("playwright is not installed; run this script with uv run") from None
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.launch()
        except Exception as e:  # noqa: BLE001
            self._pw.stop()
            raise MeasureError(
                "Chromium is not available. Run: uv run md2html.py setup\n" + str(e).splitlines()[0]
            ) from None
        return self

    def __exit__(self, *exc) -> None:
        if self._browser is not None:
            self._browser.close()
        if self._pw is not None:
            self._pw.stop()

    def open(self, html_path: Path):
        page = self._browser.new_page()
        page.goto(html_path.resolve().as_uri())
        wait_figures(page)
        return page

    def export_pdf(self, html_path: Path, pdf_path: Path) -> None:
        page = self.open(html_path)
        try:
            page.emulate_media(media="print")
            page.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True,
                     margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        finally:
            page.close()


def wait_figures(page) -> None:
    page.wait_for_function(
        "() => ['done', 'error'].includes(document.documentElement.dataset.figures || '')",
        timeout=FIGURES_TIMEOUT_MS,
    )
    state = page.evaluate("() => document.documentElement.dataset.figures")
    if state != "done":
        msg = page.evaluate("() => document.documentElement.dataset.figuresError || ''")
        raise MeasureError(f"figure rendering failed: {msg}")


_MEASURE_JS = r"""
(sel) => {
  const container = document.querySelector('.measure[data-measure="' + sel + '"]');
  if (!container) { return null; }
  const lineOffsets = (el) => {
    const offsets = [0];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, cum = 0, lastTop = null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + 1);
        const rects = r.getClientRects();
        if (rects.length) {
          const top = rects[0].top;
          if (lastTop === null) { lastTop = top; }
          else if (top > lastTop + 1) { offsets.push(cum); lastTop = top; }
        }
        cum++;
      }
    }
    return offsets;
  };
  const result = {};
  for (const el of container.querySelectorAll(':scope > [data-block]')) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const type = el.dataset.type;
    const entry = { type, height: rect.height, marginTop: parseFloat(cs.marginTop) || 0, marginBottom: parseFloat(cs.marginBottom) || 0 };
    if (type === 'paragraph') {
      entry.lineHeight = parseFloat(cs.lineHeight);
      entry.lineOffsets = lineOffsets(el);
    }
    if (type === 'table') {
      const thead = el.querySelector('thead');
      entry.thead = thead ? thead.getBoundingClientRect().height : 0;
      entry.rows = Array.from(el.querySelectorAll('tbody > tr')).map(tr => tr.getBoundingClientRect().height);
      entry.lineHeight = parseFloat(cs.lineHeight);
    }
    if (type === 'list') {
      entry.items = Array.from(el.querySelectorAll(':scope > li')).map(li => li.getBoundingClientRect().height + (parseFloat(getComputedStyle(li).marginBottom) || 0));
    }
    if (type === 'code') {
      entry.lines = Array.from(el.querySelectorAll('.line')).map(l => l.getBoundingClientRect().height);
      entry.padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + 2;
    }
    if (el.classList.contains('figure')) {
      entry.scale = parseFloat(el.dataset.scale || '1');
      entry.intrinsicW = parseFloat(el.dataset.intrinsicW || '0');
      entry.intrinsicH = parseFloat(el.dataset.intrinsicH || '0');
    }
    result[el.dataset.block] = entry;
  }
  return result;
}
"""


def measure_document(browser: Browser, html_path: Path) -> dict[str, dict[str, Any]]:
    """Return {"col": {...}, "single": {...}} (the col entry is absent for single-column formats)."""
    page = browser.open(html_path)
    try:
        out: dict[str, dict[str, Any]] = {}
        for sel in ("col", "single"):
            data = page.evaluate(_MEASURE_JS, sel)
            if data is not None:
                out[sel] = data
        return out
    finally:
        page.close()


_VERIFY_JS = r"""
() => Array.from(document.querySelectorAll('.page')).map(p => {
  const col = p.querySelector('.column-text');
  const figCol = p.querySelector('.column-figure');
  const title = p.querySelector('.page-header .title');
  const blockInfo = (b) => {
    const e = { id: b.dataset.block, type: b.dataset.type, heightPx: Math.round(b.getBoundingClientRect().height * 10) / 10 };
    if (b.dataset.type === 'table') { e.rowHeightsPx = Array.from(b.querySelectorAll('tbody > tr')).map(tr => Math.round(tr.getBoundingClientRect().height * 10) / 10); }
    if (b.dataset.type === 'list') { e.itemHeightsPx = Array.from(b.querySelectorAll(':scope > li')).map(li => Math.round(li.getBoundingClientRect().height * 10) / 10); }
    if (b.dataset.type === 'code') { const l = b.querySelector('.line'); e.lineHeightPx = l ? Math.round(l.getBoundingClientRect().height * 10) / 10 : null; }
    if (b.classList.contains('figure')) { e.scale = parseFloat(b.dataset.scale || '1'); e.widthPx = Math.round(b.getBoundingClientRect().width); }
    return e;
  };
  let usedPx = 0, contentH = 0;
  if (col) {
    contentH = col.clientHeight;
    const top = col.getBoundingClientRect().top;
    // deepest visible bottom edge among the column's children (a two-column segment is as tall as
    // its taller column). The last block's bottom margin is not counted: it is invisible, and
    // pagination already reserves it, so counting it here reported overflow for pages that fit.
    const bottoms = Array.from(col.children).map(k => {
      const kids = k.classList.contains('segment') ? Array.from(k.querySelectorAll('[data-block]')) : [k];
      if (!kids.length) { return 0; }
      return Math.max(...kids.map(b => b.getBoundingClientRect().bottom - top));
    });
    usedPx = bottoms.length ? Math.max(...bottoms) : 0;
  }
  let figure = null, figureOverflowPx = 0;
  if (figCol) {
    const f = figCol.querySelector('figure');
    if (f) { figure = blockInfo(f); }
    figureOverflowPx = Math.max(0, figCol.scrollHeight - figCol.clientHeight);
  }
  return {
    id: p.dataset.pageId, mode: p.dataset.mode,
    contentHeightPx: Math.round(contentH), usedPx: Math.round(usedPx),
    overflowPx: Math.max(0, Math.round(usedPx - contentH)),
    figureOverflowPx: Math.round(figureOverflowPx),
    titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : false,
    blocks: col ? Array.from(col.querySelectorAll('[data-block]')).map(blockInfo) : [],
    figure
  };
})
"""


_SVGS_JS = r"""
() => {
  const out = {};
  for (const fig of document.querySelectorAll('figure.figure[data-type="mermaid"]')) {
    const svg = fig.querySelector('svg');
    if (svg) { out[fig.dataset.block] = svg.outerHTML; }
  }
  return out;
}
"""


def verify_document(browser: Browser, html_path: Path) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Per-page overflow report, plus the SVG markup Mermaid produced for each
    mermaid block (block id -> <svg ...>, already sized by figures.js). The SVGs
    let `prerender` mode write the final document without the Mermaid library."""
    page = browser.open(html_path)
    try:
        return page.evaluate(_VERIFY_JS), page.evaluate(_SVGS_JS)
    finally:
        page.close()
