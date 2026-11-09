// gospelo-md2html: Markdown + Mermaid -> paginated HTML / PDF / PPTX.
//
// Run:          node <skill>/scripts/md2html.mjs <subcommand> ...
//               (or uv run <skill>/scripts/md2html.py ..., which calls this)
// Subcommands:  setup | import | check | build | restore
// Repository:   https://github.com/gospelo-dev/md2html

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { BuildError, puppeteerCacheDir, resolveChrome, SHELL_VERSION } from '@gospelo/mermaid-arch'
import * as assets from './assets.ts'
import * as blocksMod from './blocks.ts'
import type { Block } from './blocks.ts'
import * as contentMod from './content.ts'
import type { Doc, Page } from './content.ts'
import { embeddedFontCss } from './fonts.ts'
import { getFormat, PAGE_IDS } from './formats.ts'
import { buildLayout, type Layout, LayoutError, type LayoutValues } from './layout.ts'
import { Browser, MeasureError, measureDocument, verifyDocument } from './measure.ts'
import { DiagramError, Diagrams, LayoutRequestError } from './mermaid.ts'
import {
  BlockHeight,
  flattenForReflow,
  paginate,
  type PaginateContext,
  relayoutPages,
  type Spill,
  spillPages,
} from './paginate.ts'
import { exportPptx, type PptxOptions } from './pptx.ts'
import { counter, fixed } from './py.ts'
import {
  effectiveLayout,
  firstFigure,
  needsFontAwesome,
  pageMode,
  type RenderContext,
  RenderError,
  renderDocument,
  renderMeasureDocument,
} from './render.ts'
import * as reportMod from './report.ts'
import type { VerifyPage } from './report.ts'
import { buildMetrics, type Metrics, SAFETY } from './scale.ts'
import { VERSION } from './version.ts'

const EXIT_OK = 0
const EXIT_ERROR = 1
const EXIT_USAGE = 2
const EXIT_NOT_CONVERGED = 2
const MAX_VERIFY_ROUNDS = 3
const verifySplitCounter = counter(1) // unique ids for blocks split by the verify pass

class CliError extends Error {}
class UsageError extends Error {}

// --------------------------------------------------------------------------
// argument parsing

type Opt = { type: 'string' | 'boolean'; short?: string; choices?: string[]; help: string; metavar?: string }

const LAYOUT_OPTS: Record<string, Opt> = {
  layout: { type: 'string', help: 'layout JSON (CLI options win)', metavar: 'FILE' },
  page: { type: 'string', choices: PAGE_IDS, help: 'page format' },
  'font-size': { type: 'string', help: 'body font size: 11pt / 14px / 3.5mm' },
  'font-family': { type: 'string', help: "CSS font-family list for body text, e.g. \"'Noto Sans JP', sans-serif\" (default: base.css stack)" },
  'code-font-family': { type: 'string', help: 'CSS font-family list for code and inline code (default: base.css stack)' },
  'no-embed-fonts': { type: 'boolean', help: "do not embed subsets of the vendored BIZ UD fonts (the viewer's own fonts are used)" },
  'title-scale': { type: 'string', help: 'title size as a multiple of the body size', metavar: 'FLOAT' },
  'header-title': { type: 'string', help: 'section | doc | fixed:<text>' },
  columns: { type: 'string', choices: ['two', 'split', 'single'], help: 'two = two columns, left then right (default on landscape paper), split = one figure beside the text, single' },
  'figure-side': { type: 'string', choices: ['left', 'right'], help: 'side of the figure column in split pages' },
  'split-ratio': { type: 'string', help: 'text column fraction in split pages (0.4 to 0.6)', metavar: 'FLOAT' },
  details: { type: 'string', choices: ['drop', 'expand'], help: 'what to do with <details> blocks' },
  'mermaid-lib': {
    type: 'string',
    choices: ['prerender'],
    help: 'prerender = diagrams written as SVG (the only mode; embed and link are no longer supported)',
  },
  'mermaid-version': {
    type: 'string',
    metavar: 'X.Y.Z',
    help: 'accept the Mermaid version mermaid-arch draws with, for a document paginated with another one',
  },
  'hr-break': { type: 'boolean', help: 'a horizontal rule starts a new page' },
  'image-scale': { type: 'string', help: 'image pixels per CSS px', metavar: 'FLOAT' },
  'embed-images': { type: 'boolean', help: 'embed images as data: URIs' },
  date: { type: 'string', help: 'YYYY-MM-DD or none' },
  css: { type: 'string', help: 'extra CSS file', metavar: 'FILE' },
}

const DRAW_OPTS: Record<string, Opt> = {
  'icons-zip': {
    type: 'string',
    metavar: 'ZIP',
    help: 'AWS Architecture Icons package (Icon-package_*.zip); required when diagrams use aws: icons',
  },
  chrome: {
    type: 'string',
    metavar: 'PATH',
    help: 'chrome-headless-shell executable (default: $CHROME_PATH, $PUPPETEER_EXECUTABLE_PATH, then puppeteer\'s cache)',
  },
}

const REPORT_OPTS: Record<string, Opt> = {
  report: { type: 'string', help: 'write the report JSON here', metavar: 'FILE' },
  verbose: { type: 'boolean', help: 'print measured heights and verify rounds' },
}

interface Command {
  help: string
  positional: string[]
  opts: Record<string, Opt>
  required?: string[]
}

const COMMANDS: Record<string, Command> = {
  setup: { help: 'install the npm packages and chrome-headless-shell (first run only)', positional: [], opts: {} },
  import: {
    help: 'Markdown -> Gospelo Document (.gospelo.html, paginated and verified)',
    positional: ['input'],
    opts: {
      output: { type: 'string', short: 'o', metavar: 'PATH', help: 'output path: <name>.gospelo.html (default: next to the input) or a <name>.gospelo.json sidecar' },
      force: { type: 'boolean', help: 'overwrite an existing output' },
      'dry-run': { type: 'boolean', help: 'do everything but write the output' },
      ...REPORT_OPTS,
      ...DRAW_OPTS,
      ...LAYOUT_OPTS,
    },
  },
  check: {
    help: 'verify a Gospelo Document and report capacity (writes nothing)',
    positional: ['content'],
    opts: { ...REPORT_OPTS, ...DRAW_OPTS, ...LAYOUT_OPTS },
  },
  build: {
    help: 'Gospelo Document -> rebuilt .gospelo.html (and PDF / PPTX)',
    positional: ['content'],
    opts: {
      output: { type: 'string', short: 'o', metavar: 'PATH', help: 'HTML path (default: the input HTML, or <name>.gospelo.html next to a JSON)' },
      pdf: { type: 'string', metavar: 'PATH', help: 'also write a PDF' },
      pptx: { type: 'string', metavar: 'PATH', help: 'also write a PPTX: one image slide per page, links as invisible hotspots' },
      'pptx-dpi': { type: 'string', metavar: 'INT', help: 'slide image resolution (default 200)' },
      'pptx-image': { type: 'string', choices: ['jpg', 'png'], help: 'slide image format (default jpg; png is crisper but larger)' },
      'pptx-text': { type: 'boolean', help: 'add a transparent selectable-text layer over each slide (some viewers show it as faint doubled text)' },
      'pptx-no-links': { type: 'boolean', help: 'skip the link hotspots' },
      reflow: { type: 'boolean', help: 're-paginate everything (HTML input: rebuild in place; JSON input: rewrite the JSON and exit)' },
      'no-write-back': { type: 'boolean', help: 'do not write auto spills back to a JSON input' },
      ...REPORT_OPTS,
      ...DRAW_OPTS,
      ...LAYOUT_OPTS,
    },
  },
  restore: {
    help: 'write the original Markdown from page 0 of a Gospelo Document',
    positional: ['source'],
    opts: { output: { type: 'string', short: 'o', metavar: 'PATH', help: 'Markdown path to write' } },
    required: ['output'],
  },
}

type Args = Record<string, string | boolean | undefined> & { command: string }

function usage(command?: string): string {
  if (command === undefined) {
    const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(8)} ${c.help}`)
    return `usage: md2html <command> [options]\n\ngospelo-md2html ${VERSION}: Markdown + Mermaid -> paginated HTML / PDF / PPTX\n\ncommands:\n${lines.join('\n')}\n\nRun md2html <command> --help for the options of a command.`
  }
  const c = COMMANDS[command]!
  const pos = c.positional.map((p) => p.toUpperCase()).join(' ')
  const lines = Object.entries(c.opts).map(([name, o]) => {
    const flag = (o.short ? `-${o.short}, ` : '') + `--${name}` + (o.type === 'string' ? ` ${o.choices ? `{${o.choices.join(',')}}` : o.metavar ?? name.toUpperCase().replace(/-/g, '_')}` : '')
    return `  ${flag}\n      ${o.help}`
  })
  return `usage: md2html ${command} ${pos} [options]\n\n${c.help}\n\noptions:\n${lines.join('\n')}`
}

function parse(argv: string[]): Args {
  const [command, ...rest] = argv
  if (command === undefined || command === '-h' || command === '--help') {
    console.log(usage())
    process.exit(command === undefined ? EXIT_USAGE : EXIT_OK)
  }
  if (command === '--version') {
    console.log(VERSION)
    process.exit(EXIT_OK)
  }
  const c = COMMANDS[command]
  if (!c) throw new UsageError(`unknown command '${command}' (choose from ${Object.keys(COMMANDS).join(', ')})`)
  if (command === 'setup' && rest.some((a) => a === '--elk' || a === '--elk-only')) {
    throw new UsageError(
      'setup --elk / --elk-only is no longer needed: Mermaid 12 includes the ELK layout. Run setup without options',
    )
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    console.log(usage(command))
    process.exit(EXIT_OK)
  }
  const options: ParseArgsConfig['options'] = {}
  for (const [name, o] of Object.entries(c.opts)) options[name] = { type: o.type, ...(o.short ? { short: o.short } : {}) }
  let parsed
  try {
    parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true })
  } catch (e) {
    throw new UsageError((e as Error).message)
  }
  if (parsed.positionals.length !== c.positional.length) {
    throw new UsageError(`${command} takes ${c.positional.length ? c.positional.map((p) => p.toUpperCase()).join(' ') : 'no arguments'}`)
  }
  const args: Args = { command }
  c.positional.forEach((p, i) => (args[p] = parsed.positionals[i]))
  for (const [name, o] of Object.entries(c.opts)) {
    const v = parsed.values[name] as string | boolean | undefined
    if (typeof v === 'string' && o.choices && !o.choices.includes(v)) {
      throw new UsageError(`argument --${name}: invalid choice: '${v}' (choose from ${o.choices.join(', ')})`)
    }
    args[name] = v
  }
  for (const r of c.required ?? []) if (args[r] === undefined) throw new UsageError(`the following arguments are required: --${r}`)
  return args
}

function floatArg(args: Args, name: string): number | undefined {
  const v = args[name]
  if (v === undefined) return undefined
  const n = Number(v)
  if (typeof v !== 'string' || v.trim() === '' || !Number.isFinite(n)) throw new UsageError(`argument --${name}: invalid float value: '${v}'`)
  return n
}

function intArg(args: Args, name: string, dflt: number): number {
  const v = args[name]
  if (v === undefined) return dflt
  if (typeof v !== 'string' || !/^[+-]?\d+$/.test(v.trim())) throw new UsageError(`argument --${name}: invalid int value: '${v}'`)
  return parseInt(v, 10)
}

const str = (args: Args, name: string): string | undefined => args[name] as string | undefined
const flag = (args: Args, name: string): boolean => args[name] === true

function layoutFromArgs(args: Args, base: Record<string, unknown> | null = null): Layout {
  const cli: Partial<LayoutValues> = {
    page: str(args, 'page'),
    fontSize: str(args, 'font-size'),
    fontFamily: str(args, 'font-family'),
    codeFontFamily: str(args, 'code-font-family'),
    embedFonts: flag(args, 'no-embed-fonts') ? false : undefined,
    titleScale: floatArg(args, 'title-scale'),
    headerTitle: str(args, 'header-title'),
    columns: str(args, 'columns'),
    figureSide: str(args, 'figure-side'),
    splitRatio: floatArg(args, 'split-ratio'),
    details: str(args, 'details'),
    mermaidLib: str(args, 'mermaid-lib'),
    mermaidVersion: str(args, 'mermaid-version'),
    hrBreak: flag(args, 'hr-break') ? true : undefined,
    imageScale: floatArg(args, 'image-scale'),
    embedImages: flag(args, 'embed-images') ? true : undefined,
    date: str(args, 'date'),
    css: str(args, 'css'),
  }
  return buildLayout(str(args, 'layout') ?? null, cli, base, assets.mermaidVersion())
}

function metricsFromLayout(layout: Layout): Metrics {
  return buildMetrics(getFormat(layout.page), layout.fontSize, layout.titleScale, layout.columns, layout.figureSide, layout.splitRatio)
}

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dateText(layout: Layout, docDate: string | null | undefined): string | null {
  if (layout.date === 'none') return null
  if (layout.date) return layout.date
  if (docDate) return docDate
  return today()
}

// --------------------------------------------------------------------------
// shared pipeline pieces

/** The browser, mermaid-arch's renderer in it, and the per-command values the passes share. */
interface Session {
  browser: Browser
  diagrams: Diagrams
  metrics: Metrics
  layout: Layout
  imageBase: string
  fontCss: string
}

async function openSession(
  args: Args,
  layout: Layout,
  metrics: Metrics,
  imageBase: string,
  fontCss: string,
  allBlocks: Block[],
): Promise<Session> {
  const iconsZip = str(args, 'icons-zip') ?? null
  if (iconsZip !== null && !(existsSync(iconsZip) && statSync(iconsZip).isFile())) {
    throw new CliError(`--icons-zip: no such file: ${iconsZip}`)
  }
  const browser = await Browser.launch(str(args, 'chrome') ?? null)
  const diagrams = new Diagrams(browser, { iconsZip, fontCss, fontAwesome: needsFontAwesome(allBlocks) }, metrics, layout)
  return { browser, diagrams, metrics, layout, imageBase, fontCss }
}

async function closeSession(s: Session): Promise<void> {
  try {
    await s.diagrams.close()
  } finally {
    await s.browser.close()
  }
}

async function withSession<T>(s: Session, fn: (s: Session) => Promise<T>): Promise<T> {
  try {
    return await fn(s)
  } finally {
    await closeSession(s)
  }
}

function renderContext(s: Session, htmlDir: string | null, svgs: Map<string, string>): RenderContext {
  return {
    metrics: s.metrics,
    layout: s.layout,
    imageBase: s.imageBase,
    htmlDir,
    embedImages: htmlDir !== null && s.layout.embedImages,
    svgs,
    codeHtml: null,
    fontCss: s.fontCss,
  }
}

function tempHtml(dir: string, prefix: string): string {
  return join(dir, `.md2html-${prefix}-${randomBytes(6).toString('hex')}.html`)
}

function writeTemp(path: string, text: string): void {
  writeFileSync(path, text, { encoding: 'utf-8', flag: 'wx' })
}

async function measureHeights(
  s: Session,
  blocks: Block[],
  workDir: string,
): Promise<[Record<string, BlockHeight>, Record<string, BlockHeight>]> {
  const ctx = renderContext(s, null, await s.diagrams.svgsFor(blocks))
  const htmlText = renderMeasureDocument(blocks, ctx)
  const path = tempHtml(workDir, 'measure')
  let raw
  try {
    writeTemp(path, htmlText)
    raw = await measureDocument(s.browser, path)
  } finally {
    if (process.env.MD2HTML_KEEP_TEMP !== '1') unlinkSync(path)
  }
  if (!raw.single) throw new CliError('measurement returned no single-width heights')
  const toHeights = (m: Record<string, any>): Record<string, BlockHeight> =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, BlockHeight.fromJs(v)]))
  const single = toHeights(raw.single)
  const col = raw.col ? toHeights(raw.col) : single
  const missing = blocks.filter((b) => !(b.id in single) && b.type !== 'pagebreak').map((b) => b.id)
  if (missing.length) throw new CliError(`measurement returned no height for blocks: ${missing.join(', ')}`)
  return [col, single]
}

function makePaginateCtx(
  metrics: Metrics,
  columns: string,
  heightsCol: Record<string, BlockHeight>,
  heightsSingle: Record<string, BlockHeight>,
  docTitle: string,
  layout: Layout | null,
): PaginateContext {
  const heights = columns === 'split' || columns === 'two' ? heightsCol : heightsSingle
  const [colW, colH, colR] = metrics.figureBox('col')
  const [bandW, bandH, bandR] = metrics.figureBox('single')
  return {
    isSlide: metrics.fmt.isSlide,
    columns,
    capacity: metrics.contentHPx * SAFETY,
    linePx: metrics.linePx,
    heights: { ...heights },
    heightsSingle: { ...heightsSingle },
    docTitle,
    warnings: [],
    spanOverride: layout ? layout.spanOverrides() : {},
    colBox: [colW, colH * colR],
    bandBox: [bandW, bandH * bandR],
  }
}

function assignPageIds(pages: Page[], start = 1): void {
  pages.forEach((p, i) => (p.id = `p${String(i + start).padStart(2, '0')}`))
}

/** Render, verify, and push overflowing tail blocks to continuation pages. Returns
 * [html, verify, rounds, pages] where `pages` is the final page list the HTML was
 * rendered from. `relayout(pages)` recomputes the two-column placement of pages
 * changed by a push. */
async function verifyAndFix(
  s: Session,
  doc: Doc,
  pagesIn: Page[],
  htmlDir: string,
  date: string | null,
  workDir: string,
  verbose: boolean,
  relayout: ((pages: Page[]) => Page[]) | null,
): Promise<[string, VerifyPage[], number, Page[], Record<string, string> | null]> {
  let pages = pagesIn
  let rounds = 0
  const keep = process.env.MD2HTML_KEEP_TEMP === '1'
  for (;;) {
    const ctx = renderContext(s, htmlDir, await s.diagrams.svgsFor(pages.flatMap((p) => p.blocks)))
    let htmlText = renderDocument(doc, pages, ctx, date)
    const path = tempHtml(workDir, 'verify')
    let verify: VerifyPage[]
    let codeHtml: Record<string, string>
    try {
      writeTemp(path, htmlText)
      ;[verify, codeHtml] = await verifyDocument(s.browser, path)
    } finally {
      if (!keep) unlinkSync(path)
    }
    const overflowing = verify.filter((v) => v.overflowPx > 0 && v.mode !== 'cover')
    if (!overflowing.length) {
      if (Object.keys(codeHtml).length) ctx.codeHtml = codeHtml
      htmlText = renderDocument(doc, pages, ctx, date)
      return [htmlText, verify, rounds, pages, ctx.codeHtml]
    }
    rounds += 1
    if (verbose) {
      for (const v of overflowing) {
        const ids = v.blocks.map((b) => b.id).join(',')
        console.error(`  verify round ${rounds}: ${v.id} overflow ${v.overflowPx}px used ${v.usedPx}/${v.contentHeightPx} blocks=${ids}`)
      }
      if (keep) console.error(`  kept ${path}`)
    }
    if (rounds > MAX_VERIFY_ROUNDS) {
      throw new CliError(
        `verification did not converge after ${MAX_VERIFY_ROUNDS} rounds; overflowing pages: ${overflowing.map((v) => v.id).join(', ')}`,
      )
    }
    pages = pushLastBlocks(pages, new Map(overflowing.map((v) => [v.id, v])))
    if (relayout !== null) pages = relayout(pages)
  }
}

/** Move the last text block of each overflowing page to a continuation page. A lone
 * table / list / code block is split using the unit heights measured in the verify pass
 * instead, so a single-block page can always make progress. */
function pushLastBlocks(pages: Page[], overflowing: Map<string, VerifyPage>): Page[] {
  const out: Page[] = []
  const existing = new Set(pages.map((p) => p.id))
  for (const page of pages) {
    const v = overflowing.get(page.id)
    if (v === undefined) {
      out.push(page)
      continue
    }
    // only the figure-slot layout keeps a figure out of the flow; in single / two-column modes every block moves
    const fig = String(v.mode ?? '').startsWith('split') ? firstFigure(page) : null
    const textBlocks = page.blocks.filter((b) => b !== fig)
    if (!textBlocks.length) {
      out.push(page)
      continue
    }
    let moved: Block
    let keep: Block[]
    if (textBlocks.length === 1) {
      const split = splitByVerify(textBlocks[0]!, v)
      if (split === null) {
        out.push(page) // cannot shrink further; reported as clipped
        continue
      }
      const [headB, tailB] = split
      keep = page.blocks.map((b) => (b === textBlocks[0] ? headB : b))
      moved = tailB
    } else {
      moved = textBlocks[textBlocks.length - 1]!
      keep = page.blocks.filter((b) => b !== moved)
    }
    let n = 2
    while (existing.has(`${page.id}-${n}`)) n += 1
    const newId = `${page.id}-${n}`
    existing.add(newId)
    const shrunk: Page = { ...page, blocks: keep }
    delete shrunk._layout // placement is recomputed by relayout()
    out.push(shrunk)
    out.push({ id: newId, kind: 'content', title: page.title, continued: page.title !== null, blocks: [moved] })
  }
  return out
}

function splitByVerify(block: Block, v: VerifyPage): [Block, Block] | null {
  const info = v.blocks.find((b) => b.id === block.id)
  if (info === undefined) return null
  const overflow = v.overflowPx + 1
  const t = block.type
  const tailId = `${block.id}.v${verifySplitCounter()}`
  const cutFrom = (heights: number[]): number => {
    let cut = heights.length
    let removed = 0.0
    while (cut > 1 && removed < overflow) {
      cut -= 1
      removed += heights[cut]!
    }
    return cut
  }
  if (t === 'table' && info.rowHeightsPx?.length && block.rows.length > 1) {
    const cut = cutFrom(info.rowHeightsPx)
    if (cut < 1 || cut >= block.rows.length) return null
    return [{ ...block, rows: block.rows.slice(0, cut) }, { ...block, rows: block.rows.slice(cut), continued: true, id: tailId }]
  }
  if (t === 'list' && info.itemHeightsPx?.length && block.items.length > 1) {
    const cut = cutFrom(info.itemHeightsPx)
    if (cut < 1 || cut >= block.items.length) return null
    const tail: Block = { ...block, items: block.items.slice(cut), id: tailId }
    if (block.ordered) tail.start = Math.trunc(block.start ?? 1) + cut
    return [{ ...block, items: block.items.slice(0, cut) }, tail]
  }
  if (t === 'code' && info.lineHeightPx && block.lines.length > 1) {
    const lh = info.lineHeightPx as number
    const nRemove = Math.floor(overflow / lh) + 1
    const cut = block.lines.length - nRemove
    if (cut < 1) return null
    return [{ ...block, lines: block.lines.slice(0, cut) }, { ...block, lines: block.lines.slice(cut), continued: true, id: tailId }]
  }
  return null
}

function resolveImageBase(contentPath: string, doc: Doc): string {
  const src = doc.meta.source
  if (src) return resolve(dirname(contentPath), dirname(src))
  return resolve(dirname(contentPath))
}

function printVerboseHeights(heights: Record<string, BlockHeight>): void {
  for (const [k, v] of Object.entries(heights)) {
    console.error(
      `    ${k.padEnd(12)} ${fixed(v.height, 1).padStart(7)}px  mt ${fixed(v.marginTop, 0).padStart(4)} mb ${fixed(v.marginBottom, 0).padStart(4)}`,
    )
  }
}

function relPath(target: string, fromDir: string): string {
  return relative(resolve(fromDir), resolve(target)).split(sep).join('/')
}

// --------------------------------------------------------------------------
// subcommands

const SKILL_DIR = assets.SKILL_DIR

/** Install chrome-headless-shell into puppeteer's cache when it is not found. The npm
 * packages are installed by scripts/md2html.py setup before this runs. */
async function cmdSetup(): Promise<number> {
  try {
    const found = resolveChrome(null)
    console.log(`chrome-headless-shell: ${found.path} (from ${found.source})`)
    return EXIT_OK
  } catch (e) {
    if (!(e instanceof BuildError) || e.code !== 'chrome-missing') throw e
  }
  const cache = puppeteerCacheDir()
  console.log(`Installing chrome-headless-shell ${SHELL_VERSION} into ${cache} ...`)
  const r = spawnSync('npx', ['--no-install', '@puppeteer/browsers', 'install', `chrome-headless-shell@${SHELL_VERSION}`, '--path', cache], {
    cwd: SKILL_DIR,
    stdio: 'inherit',
  })
  if (r.status !== 0) throw new CliError(`installing chrome-headless-shell ${SHELL_VERSION} failed`)
  const found = resolveChrome(null)
  console.log(`chrome-headless-shell: ${found.path} (from ${found.source})`)
  return EXIT_OK
}

async function fontCss(doc: Doc, layout: Layout, blocks?: Block[]): Promise<string> {
  // @font-face rules for the embedded font subsets; computed once per command and used by
  // the measurement pages, the diagram page and the final HTML, so pagination is
  // machine-independent. `blocks` is the not-yet-paginated block list on import.
  const pages = contentMod.contentPages(doc)
  const bl = blocks ?? pages.flatMap((p) => p.blocks)
  const titles = [doc.meta.title, ...pages.filter((p) => p.title).map((p) => p.title as string)]
  if (layout.headerTitle.startsWith('fixed:')) titles.push(layout.headerTitle.slice('fixed:'.length))
  return embeddedFontCss(bl, titles, layout)
}

function dropRuntimeKeys(pages: Page[]): void {
  // remove pagination-time block ids and page placement so ids can be reassigned
  for (const p of pages) {
    for (const key of Object.keys(p)) if (key.startsWith('_')) delete p[key]
    for (const b of p.blocks) {
      delete b.id
      delete b._generated_id
    }
  }
}

function remapIds(text: string, idMap: Map<string, string>): string {
  return text.replace(/\b(?:p\d+(?:-\d+)*-)?b\d+(?:\.[sv]?\d+)*\b/g, (m) => idMap.get(m) ?? m)
}

async function cmdImport(args: Args): Promise<number> {
  const src = str(args, 'input')!
  if (!existsSync(src) || !statSync(src).isFile()) throw new CliError(`input not found: ${src}`)
  const outPath = str(args, 'output') ?? contentMod.defaultHtmlPath(src)
  const toHtml = contentMod.isHtmlPath(outPath)
  if (!toHtml && extname(outPath).toLowerCase() !== '.json') {
    throw new CliError(`output must end in .html (Gospelo Document) or .json (sidecar): ${outPath}`)
  }
  const dryRun = flag(args, 'dry-run')
  const verbose = flag(args, 'verbose')
  if (existsSync(outPath) && !flag(args, 'force') && !dryRun) {
    throw new CliError(`${outPath} already exists; pass --force to overwrite (this discards edits)`)
  }
  const layout = layoutFromArgs(args)
  const metrics = metricsFromLayout(layout)

  const original = readFileSync(src, 'utf-8')
  const notes = new blocksMod.ImportNotes()
  const text = blocksMod.preprocessMarkdown(original, layout.details, notes)
  const blockList = blocksMod.parseBlocks(text, layout.hrBreak, notes)
  if (!blockList.length) throw new CliError('no content blocks found in the Markdown')
  blockList.forEach((b, i) => (b.id = `b${i}`))
  const stem = basename(src, extname(src))
  const title = blocksMod.docTitleFromBlocks(blockList, stem)
  const date = dateText(layout, null)

  const doc: Doc = {
    version: contentMod.SCHEMA_VERSION,
    meta: { title, date, source: relPath(src, dirname(resolve(outPath))) },
    pages: [contentMod.makeSourcePage(original)],
  }
  const imageBase = dirname(resolve(src))
  const workDir = dirname(resolve(outPath))
  mkdirSync(workDir, { recursive: true })
  // the block list holds every character the paginated pages can show, so the subset is final here
  const css = await fontCss(doc, layout, blockList)
  const session = await openSession(args, layout, metrics, imageBase, css, blockList)

  const { finalPages, verify, rounds, warnings, htmlText, oldIds } = await withSession(session, async (s) => {
    const [heightsCol, heightsSingle] = await measureHeights(s, blockList, workDir)
    if (verbose) printVerboseHeights(heightsCol)
    const pctx = makePaginateCtx(metrics, metrics.columns, heightsCol, heightsSingle, title, layout)
    const firstPass = paginate(blockList, pctx).map((p) => p.toJson())
    assignPageIds(firstPass)
    dropRuntimeKeys(firstPass)
    doc.pages.push(...firstPass)
    contentMod.validateContent(doc, outPath)
    contentMod.assignBlockIds(doc)
    // Settle: the same measure / spill / verify pass that `build` runs. The first pass placed
    // split blocks (table rows, list items) by estimated heights; this pass measures them as
    // they really render, so a later `build` of the written document does not move anything.
    const [pages, , warnings, relayout] = await buildPages(s, doc, workDir, verbose)
    const [, verify, rounds, finalPages, codeHtml] = await verifyAndFix(s, doc, pages, workDir, date, workDir, verbose, relayout)
    // spills and pushes add pages such as p09-2: renumber sequentially
    const oldIds = finalPages.map((p) => p.blocks.map((b) => b.id as string | undefined))
    assignPageIds(finalPages)
    // the HTML is rendered from the renumbered pages while their column placement is still
    // attached; block ids are still the settle-pass ones, which the drawn code is keyed by
    let htmlText: string | null = null
    if (toHtml) {
      const ctx = renderContext(s, workDir, await s.diagrams.svgsFor(finalPages.flatMap((p) => p.blocks)))
      ctx.codeHtml = codeHtml
      htmlText = renderDocument(doc, finalPages, ctx, date)
    }
    return { finalPages, verify, rounds, warnings, htmlText, oldIds }
  })
  dropRuntimeKeys(finalPages)
  doc.pages = [doc.pages[0]!, ...finalPages]
  contentMod.assignBlockIds(doc)
  // settle-pass ids (p09-2-b0) -> final page-based ids (p10-b0) in the report and warnings
  const idMap = new Map<string, string>()
  finalPages.forEach((p, i) =>
    p.blocks.forEach((b, j) => {
      const old = oldIds[i]![j]
      if (old) idMap.set(old, b.id)
    }),
  )
  verify.forEach((v, i) => {
    v.id = finalPages[i]!.id
    for (const b of v.blocks) b.id = idMap.get(b.id) ?? b.id
    if (v.figure) v.figure.id = idMap.get(v.figure.id) ?? v.figure.id
  })
  // the settle pass re-paginates every page, so it repeats the first pass's warnings with page-based ids
  const warningsOut = warnings.map((w) => remapIds(w, idMap))
  const report = reportMod.buildReport(metrics, metrics.columns, verify, [], warningsOut, notes.toDict())
  report.verifyRounds = rounds
  reportMod.printSummary(report, dryRun ? 'import (dry-run)' : 'import')
  const reportPath = str(args, 'report')
  if (reportPath) reportMod.writeReport(report, reportPath)
  if (dryRun) {
    console.log(`dry run: ${outPath} not written`)
    return EXIT_OK
  }
  if (toHtml) writeFileSync(outPath, htmlText!, 'utf-8')
  else contentMod.saveDocument(doc, effectiveLayout(layout), outPath)
  console.log(`wrote ${outPath}`)
  return EXIT_OK
}

/** Input is a Gospelo Document (.gospelo.html or .gospelo.json). Its layout is the base;
 * --layout and CLI options override it. */
function prepareBuild(args: Args): [string, Doc, Layout, Metrics, string] {
  const contentPath = str(args, 'content')!
  const [doc, embeddedLayout] = contentMod.loadDocument(contentPath)
  const layout = layoutFromArgs(args, embeddedLayout)
  const metrics = metricsFromLayout(layout)
  return [contentPath, doc, layout, metrics, resolveImageBase(contentPath, doc)]
}

/** Measure all blocks, spill per page. Returns [pages, spills, warnings, relayout]. */
async function buildPages(
  s: Session,
  doc: Doc,
  workDir: string,
  verbose: boolean,
): Promise<[Page[], Spill[], string[], (pages: Page[]) => Page[]]> {
  const pages = contentMod.contentPages(doc)
  const allBlocks = pages.flatMap((p) => p.blocks)
  const [heightsCol, heightsSingle] = await measureHeights(s, allBlocks, workDir)
  if (verbose) printVerboseHeights(heightsCol)
  const warnings: string[] = []
  const probe = { layout: s.layout, metrics: s.metrics }

  const columnsForPage = (page: Page): string => {
    const mode = pageMode(page, probe)
    if (mode === 'two') return 'two'
    return mode === 'single' ? 'single' : 'split'
  }
  const makeCtx = (columns: string): PaginateContext => {
    const ctx = makePaginateCtx(s.metrics, columns, heightsCol, heightsSingle, doc.meta.title, s.layout)
    ctx.warnings = warnings
    return ctx
  }
  const [newPages, spills] = spillPages(pages, makeCtx, columnsForPage)

  // pages created by the verify pass (pushed blocks) have no two-column placement yet;
  // blocks split by the verify pass have no measured height, and such pages keep the
  // full-width rendering instead of being re-laid out
  const needsRelayout = (p: Page): boolean =>
    p.kind === 'content' && !('_layout' in p) && columnsForPage(p) === 'two' && p.blocks.every((b) => b.id in heightsCol)
  const relayout = (current: Page[]): Page[] =>
    relayoutPages(current, needsRelayout, (pgs, existing) => spillPages(pgs, makeCtx, columnsForPage, existing))
  return [newPages, spills, warnings, relayout]
}

function spillEntries(spills: Spill[]): reportMod.SpillEntry[] {
  return spills.map((sp) => ({ from: sp.source, to: sp.target, blocks: sp.blocks }))
}

async function cmdCheck(args: Args): Promise<number> {
  const [contentPath, doc, layout, metrics, imageBase] = prepareBuild(args)
  const verbose = flag(args, 'verbose')
  const workDir = dirname(resolve(contentPath))
  const date = dateText(layout, doc.meta.date)
  const css = await fontCss(doc, layout)
  const session = await openSession(args, layout, metrics, imageBase, css, contentMod.contentPages(doc).flatMap((p) => p.blocks))
  const [spills, warnings, verify, rounds] = await withSession(session, async (s) => {
    const [pages, spills, warnings, relayout] = await buildPages(s, doc, workDir, verbose)
    const [, verify, rounds] = await verifyAndFix(s, doc, pages, workDir, date, workDir, verbose, relayout)
    return [spills, warnings, verify, rounds] as const
  })
  const report = reportMod.buildReport(metrics, metrics.columns, verify, spillEntries(spills), warnings)
  report.verifyRounds = rounds
  reportMod.printSummary(report, 'check')
  const reportPath = str(args, 'report')
  if (reportPath) reportMod.writeReport(report, reportPath)
  return EXIT_OK
}

async function cmdBuild(args: Args): Promise<number> {
  let [contentPath, doc, layout, metrics, imageBase] = prepareBuild(args)
  const verbose = flag(args, 'verbose')
  const fromHtml = contentMod.isHtmlPath(contentPath)
  // an HTML input is rebuilt in place by default: the HTML is the document
  const outPath = str(args, 'output') ?? (fromHtml ? contentPath : contentMod.defaultHtmlPath(contentPath))
  const outDir = dirname(resolve(outPath))
  mkdirSync(outDir, { recursive: true })
  const date = dateText(layout, doc.meta.date)

  if (flag(args, 'reflow')) {
    if (!fromHtml) return cmdReflow(args, contentPath, doc, layout, metrics, imageBase)
    const [reflowed, reflowWarnings] = await reflowDoc(args, doc, layout, metrics, imageBase, outDir)
    doc = reflowed
    console.log(`reflowed ${contentPath}: ${contentMod.contentPages(doc).length} pages; rebuilding the HTML`)
    for (const w of reflowWarnings) console.log(`  warning: ${w}`)
  }

  const css = await fontCss(doc, layout)
  const session = await openSession(args, layout, metrics, imageBase, css, contentMod.contentPages(doc).flatMap((p) => p.blocks))
  const [pages, spills, warnings, verify, rounds, finalPages] = await withSession(session, async (s) => {
    const [pages, spills, warnings, relayout] = await buildPages(s, doc, outDir, verbose)
    const [htmlText, verify, rounds, finalPages] = await verifyAndFix(s, doc, pages, outDir, date, outDir, verbose, relayout)
    writeFileSync(outPath, htmlText, 'utf-8')
    console.log(`wrote ${outPath}`)
    const pdf = str(args, 'pdf')
    if (pdf) {
      await s.browser.exportPdf(outPath, pdf)
      console.log(`wrote ${pdf}`)
    }
    const pptx = str(args, 'pptx')
    if (pptx) {
      const opts: PptxOptions = {
        dpi: intArg(args, 'pptx-dpi', 200),
        imageFormat: str(args, 'pptx-image') === 'png' ? 'png' : 'jpeg',
        jpegQuality: 92,
        textLayer: flag(args, 'pptx-text'),
        linkHotspots: !flag(args, 'pptx-no-links'),
      }
      const counts = await exportPptx(s.browser, outPath, pptx, metrics.fmt.widthMm, metrics.fmt.heightMm, opts)
      console.log(
        `wrote ${pptx} (${counts.slides} slides, ${counts.links} links` + (opts.textLayer ? `, ${counts.textLines} text lines` : '') + ')',
      )
    }
    return [pages, spills, warnings, verify, rounds, finalPages] as const
  })

  // finalPages is the page list the HTML was rendered from (including pages the verify pass pushed)
  const before = new Set(pages.map((p) => p.id))
  const pushed = finalPages.filter((p) => !before.has(p.id))
  const changed = spills.length > 0 || pushed.length > 0 || rounds > 0
  if (changed && !flag(args, 'no-write-back')) {
    if (fromHtml) {
      // the rebuilt HTML already embeds the updated pages; there is no separate JSON to write
      console.log(`auto spill applied; the updated pages are embedded in ${outPath}`)
    } else {
      doc.pages = [...(doc.pages[0]!.kind === 'source' ? [doc.pages[0]!] : []), ...finalPages]
      contentMod.saveDocument(doc, effectiveLayout(layout), contentPath)
      console.log(`wrote back ${contentPath} (auto spill)`)
    }
  }
  const report = reportMod.buildReport(metrics, metrics.columns, verify, spillEntries(spills), warnings)
  report.verifyRounds = rounds
  reportMod.printSummary(report, 'build')
  const reportPath = str(args, 'report')
  if (reportPath) reportMod.writeReport(report, reportPath)
  return EXIT_OK
}

/** Re-paginate every block from scratch. Returns [doc with new pages, warnings]. */
async function reflowDoc(args: Args, doc: Doc, layout: Layout, metrics: Metrics, imageBase: string, workDir: string): Promise<[Doc, string[]]> {
  const flat = flattenForReflow(doc.pages)
  flat.forEach((b, i) => (b.id = `b${i}`))
  const css = await fontCss(doc, layout, flat)
  const session = await openSession(args, layout, metrics, imageBase, css, flat)
  const [pages, warnings] = await withSession(session, async (s) => {
    const [heightsCol, heightsSingle] = await measureHeights(s, flat, workDir)
    const pctx = makePaginateCtx(metrics, metrics.columns, heightsCol, heightsSingle, doc.meta.title, layout)
    return [paginate(flat, pctx).map((p) => p.toJson()), pctx.warnings] as const
  })
  assignPageIds(pages)
  for (const p of pages) for (const b of p.blocks) delete b.id
  const head = doc.pages[0]!.kind === 'source' ? [doc.pages[0]!] : []
  doc.pages = [...head, ...pages]
  contentMod.validateContent(doc, 'reflow')
  contentMod.assignBlockIds(doc)
  return [doc, warnings]
}

async function cmdReflow(args: Args, contentPath: string, doc: Doc, layout: Layout, metrics: Metrics, imageBase: string): Promise<number> {
  const [reflowed, warnings] = await reflowDoc(args, doc, layout, metrics, imageBase, dirname(resolve(contentPath)))
  contentMod.saveDocument(reflowed, effectiveLayout(layout), contentPath)
  console.log(`reflowed ${contentPath}: ${contentMod.contentPages(reflowed).length} pages (no HTML written; run build next)`)
  for (const w of warnings) console.log(`  warning: ${w}`)
  return EXIT_OK
}

function cmdRestore(args: Args): number {
  const text = contentMod.restoreMarkdown(str(args, 'source')!)
  const out = str(args, 'output')!
  writeFileSync(out, text, 'utf-8')
  console.log(`wrote ${out}`)
  return EXIT_OK
}

// --------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parse(argv)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    console.error(`${usage(COMMANDS[argv[0] ?? ''] ? argv[0] : undefined).split('\n')[0]}\nmd2html: error: ${e.message}`)
    return EXIT_USAGE
  }
  try {
    switch (args.command) {
      case 'setup':
        return await cmdSetup()
      case 'import':
        return await cmdImport(args)
      case 'check':
        return await cmdCheck(args)
      case 'build':
        return await cmdBuild(args)
      case 'restore':
        return cmdRestore(args)
    }
    return EXIT_USAGE
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${usage(args.command).split('\n')[0]}\nmd2html: error: ${e.message}`)
      return EXIT_USAGE
    }
    if (e instanceof DiagramError || e instanceof BuildError) {
      console.error(`error: ${e.text()}`)
      return EXIT_ERROR
    }
    if (
      e instanceof CliError ||
      e instanceof LayoutError ||
      e instanceof contentMod.ContentError ||
      e instanceof assets.AssetError ||
      e instanceof MeasureError ||
      e instanceof RenderError ||
      e instanceof LayoutRequestError ||
      e instanceof RangeError
    ) {
      console.error(`error: ${e.message}`)
      return e.message.includes('did not converge') ? EXIT_NOT_CONVERGED : EXIT_ERROR
    }
    throw e
  }
}

const exitCode = await main(process.argv.slice(2))
process.exitCode = exitCode
