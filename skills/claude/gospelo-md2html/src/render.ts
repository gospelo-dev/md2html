// HTML rendering: blocks, pages, final document and measurement document.
// render.ts only sees content blocks plus a Metrics/Layout pair; it never reads
// layout values from the content.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as assets from './assets.ts'
import type { Block, Item } from './blocks.ts'
import { FIGURE_TYPES, GENERATOR, SCHEMA_VERSION, SIGNATURE, envelopeScript, makeEnvelope, type Doc, type Page } from './content.ts'
import { renderInline } from './inline.ts'
import { type Layout, layoutToDict, MERMAID_LIB } from './layout.ts'
import { esc, fixed, pyFloat } from './py.ts'
import type { FigureMode, Metrics } from './scale.ts'

export interface RenderContext {
  metrics: Metrics
  layout: Layout
  imageBase: string // directory image src paths are relative to
  htmlDir: string | null // output directory (null = measurement, use absolute file URLs)
  embedImages: boolean
  /** Mermaid SVG drawn by mermaid-arch, per block id. Every mermaid block must have one. */
  svgs: Map<string, string>
  codeHtml: Record<string, string> | null // prerendered Shiki HTML per block id
  fontCss: string // @font-face rules for the embedded font subsets (fonts.ts)
}

export class RenderError extends Error {}

// --------------------------------------------------------------------------
// blocks

export function renderBlock(block: Block, ctx: RenderContext, mode: FigureMode): string {
  const t = block.type
  const bid: string = block.id ?? ''
  let attr = ` data-block="${esc(bid)}" data-type="${t}"`
  if (t === 'heading') {
    const lvl = block.level
    return `<h${lvl}${attr}>${renderInline(block.text)}</h${lvl}>`
  }
  if (t === 'paragraph') return `<p${attr}>${renderInline(block.text)}</p>`
  if (t === 'quote') {
    const paras = (block.text as string).split('\n\n').map((p) => `<p>${renderInline(p)}</p>`).join('')
    return `<blockquote${attr}>${paras}</blockquote>`
  }
  if (t === 'list') {
    if ((block.start ?? 1) !== 1) attr += ` start="${Math.trunc(block.start)}"`
    return renderList(block.items, block.ordered, attr, true)
  }
  if (t === 'table') return renderTable(block, attr)
  if (t === 'code') {
    const lang = block.lang ? ` data-lang="${esc(block.lang)}"` : ''
    const prerendered = ctx.codeHtml?.[bid]
    if (prerendered) return `<pre class="code"${attr}${lang} data-highlighted="true"><code>${prerendered}</code></pre>`
    const lines = (block.lines as string[]).map((line) => `<span class="line">${esc(line) || ' '}</span>`).join('')
    const note = block.continued ? '<span class="continued-note">(続き)</span>' : ''
    return `<pre class="code"${attr}${lang}><code>${note}${lines}</code></pre>`
  }
  if (t === 'html') return `<div class="raw-html"${attr}>${block.html}</div>`
  if (FIGURE_TYPES.has(t)) return renderFigure(block, ctx, mode, attr)
  if (t === 'pagebreak') return ''
  throw new RenderError(`cannot render block type '${t}'`)
}

function renderList(items: Item[], ordered: boolean, attr: string, top: boolean): string {
  const tag = ordered ? 'ol' : 'ul'
  const out = [`<${tag}${top ? attr : ''}>`]
  items.forEach((item, i) => {
    const marker = top ? ` data-item="${i}"` : ''
    let inner = renderInline(item.text)
    if (item.children?.length) {
      // a nested list may differ from its parent (numbered steps with bullet notes)
      inner += renderList(item.children, item.childrenOrdered ?? ordered, '', false)
    }
    out.push(`<li${marker}>${inner}</li>`)
  })
  out.push(`</${tag}>`)
  return out.join('')
}

function zip<A, B>(a: A[], b: B[]): Array<[A, B]> {
  return a.slice(0, Math.min(a.length, b.length)).map((x, i) => [x, b[i]!])
}

function renderTable(block: Block, attr: string): string {
  const align: string[] = block.align ?? (block.header as string[]).map(() => 'left')
  const cls = block.continued ? ' class="continued"' : ''
  const out = [`<table${cls}${attr}>`]
  if (block.continued) out.push('<caption>(続き)</caption>')
  out.push('<thead><tr>')
  for (const [h, a] of zip(block.header as string[], align)) out.push(`<th class="${a}">${renderInline(h)}</th>`)
  out.push('</tr></thead><tbody>')
  ;(block.rows as string[][]).forEach((row, r) => {
    out.push(`<tr data-row="${r}">`)
    for (const [c, a] of zip(row, align)) out.push(`<td class="${a}">${renderInline(c)}</td>`)
    out.push('</tr>')
  })
  out.push('</tbody></table>')
  return out.join('')
}

function renderFigure(block: Block, ctx: RenderContext, mode: FigureMode, attr: string): string {
  const ratio = ctx.layout.blockOverride(block.id ?? '').maxHeightRatio as number | undefined
  const [W, H, r] = ctx.metrics.figureBox(mode, ratio)
  const data =
    ` data-figure-w="${fixed(W, 2)}" data-figure-h="${fixed(H, 2)}" data-figure-r="${pyFloat(r)}"` +
    ` data-image-scale="${pyFloat(ctx.layout.imageScale)}"`
  let body: string
  let caption = ''
  if (block.type === 'mermaid') {
    const svg = ctx.svgs.get(block.id ?? '')
    // the source itself stays in the envelope, so `build` can always draw it again
    if (svg === undefined) throw new RenderError(`internal: Mermaid block ${block.id} has no drawn SVG`)
    body = svg
  } else {
    const src = imageSrc(block.src, ctx)
    body = `<img src="${esc(src)}" alt="${esc(block.alt)}">`
    const cap: string = block.caption || (block.alt && block.alt !== 'diagram' ? block.alt : '')
    caption = cap ? `<figcaption>${renderInline(cap)}</figcaption>` : ''
  }
  return `<figure class="figure"${attr}${data}>${body}${caption}</figure>`
}

function imageSrc(src: string, ctx: RenderContext): string {
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return src
  const absPath = resolve(ctx.imageBase, src)
  if (ctx.embedImages) return dataUri(absPath)
  if (ctx.htmlDir === null) return pathToFileURL(absPath).href
  return relative(resolve(ctx.htmlDir), absPath).split(sep).join('/')
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/vnd.microsoft.icon',
}

function dataUri(path: string): string {
  const mime = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
  if (!existsSync(path) || !statSync(path).isFile()) throw new RenderError(`image not found: ${path}`)
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

// --------------------------------------------------------------------------
// pages

export function renderPage(page: Page, ctx: RenderContext, pageNo: number, total: number, docTitle: string, dateText: string | null): string {
  const fmt = ctx.metrics.fmt
  const pid = page.id
  const footerLeft = esc(docTitle) + (dateText ? ` <span class="date">${esc(dateText)}</span>` : '')
  const footer =
    `<footer class="page-footer"><span class="footer-left">${footerLeft}</span>` +
    `<span class="page-number">${pageNo} / ${total}</span></footer>`

  if (page.kind === 'cover') {
    const h1 = page.blocks.find((b) => b.type === 'heading' && b.level === 1)
    const subtitle = page.blocks.find((b) => b.type === 'paragraph')
    let body = `<h1>${h1 ? renderInline(h1.text) : esc(docTitle)}</h1>`
    if (subtitle) body += `<p class="subtitle">${renderInline(subtitle.text)}</p>`
    if (dateText) body += `<p class="date">${esc(dateText)}</p>`
    return (
      `<section class="page cover" data-page-id="${esc(pid)}" data-mode="cover">` +
      `<div class="page-body">${body}</div>${footer}</section>`
    )
  }

  const mode = pageMode(page, ctx)
  let header = ''
  if (fmt.isSlide) {
    const title = headerTitle(page, ctx, docTitle)
    const cont = page.continued ? ' <span class="continued">(続き)</span>' : ''
    header = `<header class="page-header"><span class="title">${renderInline(title)}${cont}</span></header>`
  }
  let cols: string
  if (mode === 'two') {
    cols = renderTwoColumns(page, ctx)
  } else {
    const figure = mode !== 'single' ? firstFigure(page) : null
    const textBlocks = page.blocks.filter((b) => b !== figure)
    const figureMode: FigureMode = mode !== 'single' ? 'split' : 'single'
    const colText = textBlocks.map((b) => renderBlock(b, ctx, figureMode)).join('\n')
    cols = `<div class="column-text">\n${colText}\n</div>`
    if (figure !== null) cols += `\n<div class="column-figure">${renderBlock(figure, ctx, 'split')}</div>`
  }
  // one block per line inside a section so that edits produce block-sized diffs
  return (
    `<section class="page" data-page-id="${esc(pid)}" data-mode="${mode}">${header}\n` +
    `<div class="page-body ${mode}">\n${cols}\n</div>\n${footer}</section>`
  )
}

/** Two-column page in column order (left column, then right): segments of [left | right]
 * columns and full-width bands. The placement (`_layout`) is computed by paginate;
 * without it every block is a band. */
function renderTwoColumns(page: Page, ctx: RenderContext): string {
  const blocks = page.blocks
  const layout = page._layout ?? blocks.map((_, i) => ({ kind: 'wide' as const, index: i }))
  const out: string[] = []
  for (const seg of layout) {
    if (seg.kind === 'cols') {
      const left = seg.left.map((i) => renderBlock(blocks[i]!, ctx, 'col')).join('\n')
      const right = seg.right.map((i) => renderBlock(blocks[i]!, ctx, 'col')).join('\n')
      out.push(
        `<div class="segment cols">\n<div class="col col-left">\n${left}\n</div>\n` +
          `<div class="col col-right">\n${right}\n</div>\n</div>`,
      )
    } else {
      out.push(`<div class="segment wide">\n${renderBlock(blocks[seg.index]!, ctx, 'single')}\n</div>`)
    }
  }
  return `<div class="column-text two">\n${out.join('\n')}\n</div>`
}

/** 'two' | 'split-right' | 'split-left' | 'single' for a content page. */
export function pageMode(page: Page, ctx: { layout: Layout; metrics: Metrics }): string {
  const ov = ctx.layout.pageOverride(page.id)
  const columns = (ov.columns as string | undefined) ?? ctx.metrics.columns
  if (columns === 'two') return 'two'
  if (columns === 'single' || firstFigure(page) === null) return 'single'
  const side = (ov.figureSide as string | undefined) ?? ctx.metrics.figureSide
  return `split-${side}`
}

export function firstFigure(page: Page): Block | null {
  return page.blocks.find((b) => FIGURE_TYPES.has(b.type)) ?? null
}

function headerTitle(page: Page, ctx: RenderContext, docTitle: string): string {
  const mode = ctx.layout.headerTitle
  if (mode === 'doc') return docTitle
  if (mode.startsWith('fixed:')) return mode.slice('fixed:'.length)
  return page.title || docTitle
}

// --------------------------------------------------------------------------
// documents

/** Gospelo Document head: signature comment, then the envelope as the first script
 * (before every style and other script, so a reader can stop there), then styles.
 * `envelope=null` is the measurement document. */
function head(ctx: RenderContext, title: string, needsFa: boolean, envelope: unknown | null, lang: string): string {
  const m = ctx.metrics
  const parts = ['<!DOCTYPE html>']
  if (envelope !== null) parts.push(SIGNATURE)
  let htmlAttrs = ` lang="${esc(lang)}" data-mermaid-font-size="${mermaidFontSize(m)}"`
  if (envelope !== null) htmlAttrs += ` data-gospelo-document="${SCHEMA_VERSION}"`
  parts.push(`<html${htmlAttrs}>`, '<head>', '<meta charset="UTF-8">', `<title>${esc(title)}</title>`)
  if (envelope !== null) {
    parts.push(`<meta name="generator" content="${esc(GENERATOR)}">`)
    parts.push(envelopeScript(envelope))
  }
  parts.push('<style>\n' + ctx.fontCss + m.cssVars() + fontVars(ctx.layout) + assets.baseCss() + '\n</style>')
  if (ctx.layout.css) parts.push('<style>\n' + readFileSync(ctx.layout.css, 'utf-8') + '\n</style>')
  if (needsFa) parts.push(assets.fontawesomeStyleTag())
  parts.push('</head>')
  return parts.join('\n')
}

/** The Mermaid font size (90% of the body size), as mermaid-arch is told and figures.js reads it. */
export function mermaidFontSize(m: Metrics): string {
  return `${fixed(m.F * 0.9, 1)}px`
}

/** CSS variables that override the base.css font stacks when the layout sets them. */
function fontVars(layout: Layout): string {
  const lines: string[] = []
  if (layout.fontFamily) lines.push(`  --font-family: ${layout.fontFamily};`)
  if (layout.codeFontFamily) lines.push(`  --code-font-family: ${layout.codeFontFamily};`)
  return lines.length ? ':root {\n' + lines.join('\n') + '\n}\n' : ''
}

/** Large static assets go last: Shiki (when code blocks have a language), then figures.js. */
function tailScripts(needsShiki: boolean): string[] {
  const parts: string[] = []
  if (needsShiki) {
    const tag = assets.shikiScriptTag()
    if (tag) parts.push(tag)
  }
  parts.push('<script>\n' + assets.figuresJs() + '\n</script>')
  return parts
}

/** Layout JSON to embed: records the Mermaid version the diagrams were drawn with, so
 * that a later `build` of the file can tell when that changes (figure sizes, and
 * therefore pagination, depend on it). */
export function effectiveLayout(layout: Layout): Record<string, unknown> {
  const out = layoutToDict(layout)
  out.mermaidLib = MERMAID_LIB
  out.mermaidVersion = assets.mermaidVersion()
  return out
}

/** Whether the document needs Font Awesome (fa: icons in diagram labels). */
export function needsFontAwesome(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === 'mermaid' && (b.source as string).includes('fa:'))
}

function needs(blocks: Block[], codeHtml: Record<string, string> | null): [boolean, boolean] {
  const codeWithLang = blocks.some((b) => b.type === 'code' && b.lang)
  return [needsFontAwesome(blocks), codeWithLang && !codeHtml]
}

export function renderDocument(doc: Doc, pages: Page[], ctx: RenderContext, dateText: string | null): string {
  const title = doc.meta.title
  const allBlocks = pages.flatMap((p) => p.blocks)
  const [needsFa, needsShiki] = needs(allBlocks, ctx.codeHtml)
  // The file is a Gospelo Document: the envelope (original Markdown as pages[0], the
  // pages the HTML is rendered from, the effective layout) is the first thing in
  // <head>, so `build out.gospelo.html` can regenerate the file from itself.
  const envelope = makeEnvelope(doc, effectiveLayout(ctx.layout), pages)
  const source = doc.meta.source
  if (source && ctx.htmlDir !== null) {
    const mdPath = resolve(ctx.imageBase, basename(source))
    envelope.meta.source = relative(resolve(ctx.htmlDir), mdPath).split(sep).join('/')
  }
  const lang = doc.meta.lang || 'ja'
  const out = [head(ctx, title, needsFa, envelope, lang), '<body>']
  pages.forEach((page, i) => out.push(renderPage(page, ctx, i + 1, pages.length, title, dateText)))
  out.push(...tailScripts(needsShiki), assets.pageNumberScript(), '</body></html>')
  return out[0] + '\n' + out.slice(1).join('\n')
}

/** One or two flow containers (text column width and single width). */
export function renderMeasureDocument(blocks: Block[], ctx: RenderContext): string {
  const m = ctx.metrics
  const [needsFa, needsShiki] = needs(blocks, null)
  const out = [head(ctx, 'measure', needsFa, null, 'ja'), '<body>']
  const widths: Array<[string, number, FigureMode]> = []
  if (m.columns === 'two') widths.push(['col', m.col2Px, 'col'])
  else if (m.columns === 'split') widths.push(['col', m.textColPx, 'split'])
  widths.push(['single', m.contentWPx, 'single'])
  for (const [name, width, figMode] of widths) {
    out.push(`<div class="measure" data-measure="${name}" style="width:${fixed(width, 2)}px">`)
    for (const b of blocks) out.push(renderBlock(b, ctx, figMode))
    out.push('</div>')
  }
  out.push(...tailScripts(needsShiki), '</body></html>')
  return out[0] + '\n' + out.slice(1).join('\n')
}
