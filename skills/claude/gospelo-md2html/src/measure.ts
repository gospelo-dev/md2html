// Measurement pass, verification pass and PDF export, in chrome-headless-shell
// (puppeteer-core). One browser is shared across passes and with mermaid-arch,
// which draws the diagrams in its own page of the same browser. Every page load
// waits for figures.js to finish (<html data-figures="done">); an error state aborts.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchBrowser } from '@gospelo/mermaid-arch'
import type { Browser as PBrowser, Page as PPage } from 'puppeteer-core'

const FIGURES_TIMEOUT_MS = 120_000
// the viewport Playwright used by default; pages are sized in CSS mm, so it only sets the window
const VIEWPORT = { width: 1280, height: 720 }

export class MeasureError extends Error {}

export class Browser {
  readonly browser: PBrowser
  readonly path: string
  readonly source: string

  private constructor(browser: PBrowser, path: string, source: string) {
    this.browser = browser
    this.path = path
    this.source = source
  }

  /** Launch chrome-headless-shell the way mermaid-arch finds it (--chrome, CHROME_PATH,
   * PUPPETEER_EXECUTABLE_PATH, puppeteer's cache). Throws mermaid-arch's BuildError
   * (chrome-missing / chrome-launch-failed) with the install command. */
  static async launch(chrome: string | null): Promise<Browser> {
    const launched = await launchBrowser({ chrome })
    return new Browser(launched.browser, launched.path, launched.source)
  }

  async close(): Promise<void> {
    await this.browser.close()
  }

  /** Open a generated HTML and wait for figures.js. `scale` is the device scale
   * factor (screenshots at 96 dpi x scale). */
  async open(htmlPath: string, scale = 1.0): Promise<PPage> {
    const page = await this.browser.newPage()
    try {
      await page.setViewport({ ...VIEWPORT, deviceScaleFactor: scale })
      await page.goto(pathToFileURL(resolve(htmlPath)).href)
      await waitFigures(page)
      return page
    } catch (e) {
      await page.close()
      throw e
    }
  }

  async exportPdf(htmlPath: string, pdfPath: string): Promise<void> {
    const page = await this.open(htmlPath)
    try {
      await page.emulateMediaType('print')
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      })
      writeFileSync(pdfPath, pdf)
    } finally {
      await page.close()
    }
  }
}

async function waitFigures(page: PPage): Promise<void> {
  await page.waitForFunction(
    "['done', 'error'].includes(document.documentElement.dataset.figures || '')",
    { timeout: FIGURES_TIMEOUT_MS },
  )
  const state = await page.evaluate('document.documentElement.dataset.figures')
  if (state !== 'done') {
    const msg = await page.evaluate("document.documentElement.dataset.figuresError || ''")
    throw new MeasureError(`figure rendering failed: ${msg}`)
  }
}

/** Evaluate a function written as source text, with JSON arguments. */
export async function call<T>(page: PPage, fnSource: string, ...args: unknown[]): Promise<T> {
  return (await page.evaluate(`(${fnSource})(${args.map((a) => JSON.stringify(a)).join(', ')})`)) as T
}

const MEASURE_JS = String.raw`
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
      entry.split = parseInt(el.dataset.split || '1', 10);
    }
    result[el.dataset.block] = entry;
  }
  return result;
}
`

export type Measured = Record<string, Record<string, any>>

/** {col: {...}, single: {...}} (col is absent for single-column formats). */
export async function measureDocument(browser: Browser, htmlPath: string): Promise<{ col?: Measured; single?: Measured }> {
  const page = await browser.open(htmlPath)
  try {
    const out: { col?: Measured; single?: Measured } = {}
    for (const sel of ['col', 'single'] as const) {
      const data = await call<Measured | null>(page, MEASURE_JS, sel)
      if (data !== null) out[sel] = data
    }
    return out
  } finally {
    await page.close()
  }
}

const VERIFY_JS = String.raw`
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
`

const CODE_HTML_JS = String.raw`
() => {
  const out = {};
  for (const pre of document.querySelectorAll('pre.code[data-highlighted="true"]')) {
    const bid = pre.dataset.block;
    const code = pre.querySelector('code');
    if (bid && code) { out[bid] = code.innerHTML; }
  }
  return out;
}
`

/** Per-page overflow report, and prerendered Shiki code HTML (block id -> innerHTML of <code>). */
export async function verifyDocument(browser: Browser, htmlPath: string): Promise<[any[], Record<string, string>]> {
  const page = await browser.open(htmlPath)
  try {
    return [await call<any[]>(page, VERIFY_JS), await call<Record<string, string>>(page, CODE_HTML_JS)]
  } finally {
    await page.close()
  }
}
