// Pagination and overflow spilling. Pure functions over measured heights.

import type { Block } from './blocks.ts'
import { FIGURE_TYPES, type Page as PageJson, type Segment } from './content.ts'
import { splitInline } from './inline.ts'
import { counter } from './py.ts'
import { SAFETY } from './scale.ts'

export const MIN_TABLE_HEAD_ROWS = 3
export const MIN_CODE_LINES_TO_SPLIT = 16
export const MIN_CODE_SIDE_LINES = 3
export const MIN_PARAGRAPH_SIDE_LINES = 2

export interface BlockHeightInit {
  height: number
  marginTop?: number
  marginBottom?: number
  lineHeight?: number | null
  lineOffsets?: number[] | null
  thead?: number | null
  rows?: number[] | null
  items?: number[] | null
  lines?: number[] | null
  padding?: number
  scale?: number | null
  intrinsicW?: number
  intrinsicH?: number
  split?: number
}

export class BlockHeight {
  height: number
  marginTop: number
  marginBottom: number
  lineHeight: number | null
  lineOffsets: number[] | null
  thead: number | null
  rows: number[] | null
  items: number[] | null
  lines: number[] | null
  padding: number
  scale: number | null
  intrinsicW: number
  intrinsicH: number
  split: number

  constructor(init: BlockHeightInit) {
    this.height = init.height
    this.marginTop = init.marginTop ?? 0
    this.marginBottom = init.marginBottom ?? 0
    this.lineHeight = init.lineHeight ?? null
    this.lineOffsets = init.lineOffsets ?? null
    this.thead = init.thead ?? null
    this.rows = init.rows ?? null
    this.items = init.items ?? null
    this.lines = init.lines ?? null
    this.padding = init.padding ?? 0
    this.scale = init.scale ?? null
    this.intrinsicW = init.intrinsicW ?? 0
    this.intrinsicH = init.intrinsicH ?? 0
    this.split = init.split ?? 1
  }

  get outer(): number {
    return this.marginTop + this.height + this.marginBottom
  }

  static fromJs(e: Record<string, any>): BlockHeight {
    return new BlockHeight({
      height: Number(e.height),
      marginTop: Number(e.marginTop ?? 0),
      marginBottom: Number(e.marginBottom ?? 0),
      lineHeight: e.lineHeight ?? null,
      lineOffsets: e.lineOffsets ?? null,
      thead: e.thead ?? null,
      rows: e.rows ?? null,
      items: e.items ?? null,
      lines: e.lines ?? null,
      padding: Number(e.padding ?? 0),
      scale: e.scale ?? null,
      intrinsicW: Number(e.intrinsicW || 0),
      intrinsicH: Number(e.intrinsicH || 0),
      split: Math.trunc(Number(e.split || 1)),
    })
  }
}

/** Running height of one column width. */
export class Accumulator {
  used = 0.0
  lastMb = 0.0
  count = 0

  gapFor(h: BlockHeight): number {
    return this.count === 0 ? h.marginTop : Math.max(this.lastMb, h.marginTop)
  }

  needed(h: BlockHeight): number {
    return this.gapFor(h) + h.height + h.marginBottom
  }

  remaining(capacity: number, h: BlockHeight): number {
    return capacity - this.used - this.gapFor(h)
  }

  add(h: BlockHeight): void {
    this.used += this.gapFor(h) + h.height
    this.lastMb = h.marginBottom
    this.count += 1
  }
}

export class Page {
  kind: string
  title: string | null
  continued: boolean
  blocks: Block[] = []
  figure: Block | null = null
  id: string | null = null
  col = new Accumulator() // text-column width accounting
  single = new Accumulator() // full-width accounting
  singleCommitted = false // a block only fits at full width: no figure may join this page

  constructor(opts: { kind?: string; title?: string | null; continued?: boolean; blocks?: Block[] } = {}) {
    this.kind = opts.kind ?? 'content'
    this.title = opts.title ?? null
    this.continued = opts.continued ?? false
    if (opts.blocks) this.blocks = opts.blocks
  }

  isEmpty(): boolean {
    return !this.blocks.length && this.figure === null
  }

  get used(): number {
    return this.figure !== null ? this.col.used : this.single.used
  }

  add(block: Block, hCol: BlockHeight, hSingle: BlockHeight): void {
    this.col.add(hCol)
    this.single.add(hSingle)
    this.blocks.push(block)
  }

  toJson(): PageJson {
    let blocks = [...this.blocks]
    if (this.figure !== null) blocks = insertFigure(blocks, this.figure)
    return { id: this.id as string, kind: this.kind, title: this.title, continued: this.continued, blocks }
  }
}

/** Keep source order: the figure goes back where it was relative to the text. */
function insertFigure(blocks: Block[], figure: Block): Block[] {
  const order = figure._order
  if (order === undefined || order === null) return [...blocks, figure]
  const out: Block[] = []
  let placed = false
  for (const b of blocks) {
    if (!placed && (b._order ?? -1) > order) {
      out.push(figure)
      placed = true
    }
    out.push(b)
  }
  if (!placed) out.push(figure)
  return out
}

export interface PaginateContext {
  isSlide: boolean
  columns: string // "two" | "split" | "single"
  capacity: number // content height x SAFETY
  linePx: number
  heights: Record<string, BlockHeight> // measured at column width
  heightsSingle: Record<string, BlockHeight> // measured at full content width
  docTitle: string
  warnings: string[]
  spanOverride: Record<string, number> // block id -> 1 | 2 (layout overrides)
  // figure boxes [width, max height] in px for the two-column layout: a column and a full-width band
  colBox: [number, number] | null
  bandBox: [number, number] | null
}

/** structuredClone that keeps undefined-free JSON blocks (blocks are plain JSON). */
function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function stripOrder(b: Block): void {
  delete b._order
}

export function paginate(blocks: Block[], ctx: PaginateContext, initialTitle: string | null = null, initialContinued = false): Page[] {
  if (ctx.columns === 'two') return paginateTwoColumns(blocks, ctx, initialTitle, initialContinued)
  const pages: Page[] = []
  const queue: Block[] = deepCopy(blocks)
  queue.forEach((b, i) => {
    if (!('_order' in b)) b._order = i
  })
  let cur = new Page({ title: initialTitle, continued: initialContinued })

  const flush = (): void => {
    if (!cur.isEmpty()) pages.push(cur)
  }
  const continuation = (): Page => new Page({ title: cur.title, continued: cur.title !== null || ctx.isSlide })

  while (queue.length) {
    const b = queue.shift()!
    const t = b.type
    if (t === 'pagebreak') {
      flush()
      cur = new Page({ title: cur.title, continued: cur.title !== null })
      continue
    }
    if (t === 'heading' && b.level === 1) {
      if (ctx.isSlide) {
        flush()
        const cover = new Page({ kind: 'cover', blocks: [b] })
        if (queue.length && queue[0]!.type === 'paragraph') cover.blocks.push(queue.shift()!)
        pages.push(cover)
        cur = new Page({ title: ctx.docTitle, continued: false })
        continue
      }
      if (!cur.isEmpty()) {
        flush()
        cur = new Page()
      }
    }
    if (t === 'heading' && b.level === 2 && ctx.isSlide) {
      flush()
      cur = new Page({ title: b.text, continued: false })
      continue
    }
    if (FIGURE_TYPES.has(t) && ctx.columns === 'split') {
      if (cur.figure === null && !cur.singleCommitted) {
        cur.figure = b
      } else {
        flush()
        cur = continuation()
        cur.figure = b
      }
      continue
    }

    const hCol = height(ctx.heights, b)
    const hSingle = height(ctx.heightsSingle, b)
    const keep = keepWithNext(ctx, b, queue)
    const withFigure = cur.figure !== null
    const fitsCol = cur.col.used + cur.col.needed(hCol) + keep <= ctx.capacity
    const fitsSingle = cur.single.used + cur.single.needed(hSingle) + keep <= ctx.capacity
    if ((withFigure && fitsCol) || (!withFigure && fitsSingle)) {
      cur.add(b, hCol, hSingle)
      if (!withFigure && !fitsCol) cur.singleCommitted = true
      continue
    }

    const [acc, h] = withFigure ? [cur.col, hCol] : [cur.single, hSingle]
    const remaining = acc.remaining(ctx.capacity, h)
    const split = trySplit(ctx, b, h, remaining, cur.isEmpty())
    if (split !== null) {
      const [head, headH, tail, tailH] = split
      cur.add(head, headH, headH)
      if (!withFigure) cur.singleCommitted = true
      ctx.heights[tail.id] = tailH
      ctx.heightsSingle[tail.id] = tailH
      flush()
      cur = continuation()
      queue.unshift(tail)
      continue
    }
    if (cur.isEmpty()) {
      // Nothing else on the page: accept it if it physically fits (no safety margin), else warn.
      // the bottom margin is invisible, so it does not count towards clipping
      const hard = ctx.capacity / SAFETY
      if (acc.gapFor(h) + h.height > hard) {
        ctx.warnings.push(`block ${b.id ?? 'None'} (${t}) is taller than a page; it will be clipped`)
      }
      cur.add(b, hCol, hSingle)
      continue
    }
    // move the block whole; a heading left at the bottom of the page goes with it
    queue.unshift(b)
    if (cur.blocks.length && cur.blocks[cur.blocks.length - 1]!.type === 'heading' && cur.blocks.length > 1) {
      queue.unshift(cur.blocks.pop()!)
    }
    flush()
    cur = continuation()
  }
  flush()
  for (const p of pages) {
    p.blocks.forEach(stripOrder)
    if (p.figure !== null) stripOrder(p.figure)
  }
  return pages
}

function height(heights: Record<string, BlockHeight>, b: Block): BlockHeight {
  const h = heights[b.id]
  if (h === undefined) throw new RangeError(`no measured height for block '${b.id}'`)
  return h
}

/** Extra height a heading must reserve so it is never left alone at the bottom. */
function keepWithNext(ctx: PaginateContext, b: Block, queue: Block[]): number {
  if (b.type !== 'heading') return 0.0
  const lines = b.level <= 2 ? 3 : 2
  if (queue.length) {
    const nxt = queue[0]!
    const nid = nxt.id
    if (FIGURE_TYPES.has(nxt.type)) {
      if (ctx.columns === 'split') return 0.0 // the figure goes to the figure slot on this page
      const table = ctx.columns === 'two' ? ctx.heights : ctx.heightsSingle
      const h = table[nid]
      if (h !== undefined) return h.marginTop + h.height + h.marginBottom // figures are never split
    } else if (ctx.heights[nid] !== undefined) {
      return Math.min(ctx.heights[nid]!.height, lines * ctx.linePx)
    }
  }
  return lines * ctx.linePx
}

// --------------------------------------------------------------------------
// splitting

const splitCounter = counter(1)

/** Unique id for the tail of a split block. A plain '.2' suffix collided when the same
 * block was split twice (column boundary, then balancing). */
function tailId(b: Block): string {
  return `${b.id}.s${splitCounter()}`
}

type Split = [Block, BlockHeight, Block, BlockHeight]

function trySplit(ctx: PaginateContext, b: Block, h: BlockHeight, remaining: number, pageEmpty: boolean): Split | null {
  const t = b.type
  const wholeFitsEmptyPage = h.marginTop + h.height + h.marginBottom <= ctx.capacity
  if (t === 'table' && h.rows?.length) return splitTable(b, h, remaining, wholeFitsEmptyPage, pageEmpty)
  if (t === 'code' && h.lines?.length) return splitCode(b, h, remaining)
  if (t === 'list' && h.items?.length) return splitList(b, h, remaining)
  if (t === 'paragraph' && h.lineOffsets?.length && h.lineHeight) return splitParagraph(b, h, remaining)
  return null
}

function sum(xs: number[]): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

/** Copy of `b` with some keys replaced, keeping key order (like dict(b, **kw)). */
function withKeys(b: Block, kw: Record<string, unknown>): Block {
  return { ...b, ...kw } as Block
}

function splitTable(b: Block, h: BlockHeight, remaining: number, wholeFits: boolean, pageEmpty: boolean): Split | null {
  const rows = h.rows ?? []
  if (rows.length !== b.rows.length) return null // measured heights do not belong to this block's rows
  if (wholeFits && !pageEmpty) return null
  const budget = remaining - (h.thead ?? 0) - h.marginBottom
  let k = 0
  let acc = 0.0
  for (const r of rows) {
    if (acc + r > budget) break
    acc += r
    k += 1
  }
  if (k < MIN_TABLE_HEAD_ROWS || k >= rows.length) return null
  const head = withKeys(b, { rows: b.rows.slice(0, k) })
  const tail = withKeys(b, { rows: b.rows.slice(k), continued: true, id: tailId(b) })
  delete tail._order
  const headH = new BlockHeight({ height: (h.thead ?? 0) + acc, marginTop: h.marginTop, marginBottom: h.marginBottom })
  const cap = (h.lineHeight || 0) * 0.8
  const tailH = new BlockHeight({
    height: (h.thead ?? 0) + sum(rows.slice(k)) + cap,
    marginTop: h.marginTop,
    marginBottom: h.marginBottom,
    thead: h.thead,
    rows: rows.slice(k),
    lineHeight: h.lineHeight,
  })
  return [head, headH, tail, tailH]
}

function splitCode(b: Block, h: BlockHeight, remaining: number): Split | null {
  const lines = h.lines ?? []
  if (lines.length !== b.lines.length || lines.length < MIN_CODE_LINES_TO_SPLIT) return null
  const budget = remaining - h.padding - h.marginBottom
  let k = 0
  let acc = 0.0
  for (const l of lines) {
    if (acc + l > budget) break
    acc += l
    k += 1
  }
  if (k < MIN_CODE_SIDE_LINES || lines.length - k < MIN_CODE_SIDE_LINES) return null
  const head = withKeys(b, { lines: b.lines.slice(0, k) })
  const tail = withKeys(b, { lines: b.lines.slice(k), continued: true, id: tailId(b) })
  delete tail._order
  const note = lines[0]!
  const headH = new BlockHeight({ height: h.padding + acc, marginTop: h.marginTop, marginBottom: h.marginBottom })
  const tailH = new BlockHeight({
    height: h.padding + sum(lines.slice(k)) + note,
    marginTop: h.marginTop,
    marginBottom: h.marginBottom,
    lines: lines.slice(k),
    padding: h.padding,
  })
  return [head, headH, tail, tailH]
}

function splitList(b: Block, h: BlockHeight, remaining: number): Split | null {
  const items = h.items ?? []
  if (items.length !== b.items.length) return null // measured heights do not belong to this block's items
  const budget = remaining - h.marginBottom
  let k = 0
  let acc = 0.0
  for (const it of items) {
    if (acc + it > budget) break
    acc += it
    k += 1
  }
  if (k < 1 || k >= items.length) return null
  const head = withKeys(b, { items: b.items.slice(0, k) })
  const tail = withKeys(b, { items: b.items.slice(k), id: tailId(b) })
  if (b.ordered) tail.start = Math.trunc(b.start ?? 1) + k
  delete tail._order
  const headH = new BlockHeight({ height: acc, marginTop: h.marginTop, marginBottom: h.marginBottom })
  const tailH = new BlockHeight({ height: sum(items.slice(k)), marginTop: h.marginTop, marginBottom: h.marginBottom, items: items.slice(k) })
  return [head, headH, tail, tailH]
}

function splitParagraph(b: Block, h: BlockHeight, remaining: number): Split | null {
  const offsets = h.lineOffsets ?? [0]
  const lh = h.lineHeight || 0
  const n = offsets.length
  const budget = remaining - h.marginBottom
  const k = lh > 0 ? Math.floor(budget / lh) : 0
  if (k < MIN_PARAGRAPH_SIDE_LINES || n - k < MIN_PARAGRAPH_SIDE_LINES) return null
  const parts = splitInline(b.text, offsets[k]!)
  if (parts === null) return null
  const [headText, tailText] = parts
  const head = withKeys(b, { text: headText })
  const tail = withKeys(b, { text: tailText, id: tailId(b) })
  delete tail._order
  const headH = new BlockHeight({ height: k * lh, marginTop: h.marginTop, marginBottom: h.marginBottom })
  const tailH = new BlockHeight({
    height: (n - k) * lh,
    marginTop: h.marginTop,
    marginBottom: h.marginBottom,
    lineHeight: lh,
    lineOffsets: offsets.slice(k).map((o) => o - offsets[k]!),
  })
  return [head, headH, tail, tailH]
}

// --------------------------------------------------------------------------
// build: spill per existing page

export interface Spill {
  source: string
  target: string
  blocks: string[]
}

/** Re-run pagination per page, keeping page boundaries as the starting point. Returns
 * [new pages, spills]. `existingIds` lists every page id already in use (when only a
 * subset of the document is re-laid out). */
export function spillPages(
  pages: PageJson[],
  makeCtx: (columns: string) => PaginateContext,
  layoutColumnsForPage: (page: PageJson) => string,
  existingIds?: Set<string>,
): [PageJson[], Spill[]] {
  const existing = new Set(existingIds ?? [])
  for (const p of pages) existing.add(p.id)
  const out: PageJson[] = []
  const spills: Spill[] = []
  for (const page of pages) {
    if (page.kind === 'source' || page.kind === 'cover') {
      out.push(page)
      continue
    }
    const ctx = makeCtx(layoutColumnsForPage(page))
    const result = paginate(page.blocks, ctx, page.title, page.continued)
    if (!result.length) {
      out.push(page)
      continue
    }
    const first = result[0]!.toJson()
    first.id = page.id
    first.kind = page.kind
    first.continued = page.continued
    out.push(first)
    let prevId = page.id
    for (const extra of result.slice(1)) {
      const newId = uniqueId(page.id, existing)
      existing.add(newId)
      const j = extra.toJson()
      j.id = newId
      j.kind = 'content'
      out.push(j)
      spills.push({ source: prevId, target: newId, blocks: j.blocks.map((b) => b.id ?? '') })
      prevId = newId
    }
  }
  return [out, spills]
}

/** Re-lay out the pages selected by `needsRelayout`, each in its place: the page is
 * replaced by itself and the continuation pages it produced. `spill(pages, existingIds)`
 * is spillPages bound to a context. Each page is spilled on its own (see the Python
 * history: spilling several together put a page such as p26-2 back twice). */
export function relayoutPages(
  current: PageJson[],
  needsRelayout: (p: PageJson) => boolean,
  spill: (pages: PageJson[], existing: Set<string>) => [PageJson[], Spill[]],
): PageJson[] {
  const existing = new Set(current.map((p) => p.id))
  const out: PageJson[] = []
  for (const page of current) {
    if (!needsRelayout(page)) {
      out.push(page)
      continue
    }
    const [fixedPages] = spill([page], existing)
    for (const p of fixedPages) existing.add(p.id)
    out.push(...fixedPages)
  }
  return out
}

function uniqueId(base: string, existing: Set<string>): string {
  let n = 2
  while (existing.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

// --------------------------------------------------------------------------
// two-column flow: fill the left column top to bottom, then the right column.
// Wide blocks (many-column tables, wide figures) become full-width bands; the
// two-column region above a band is balanced so both columns end at the same
// height. A page end is not balanced.

export const WIDE_TABLE_COLUMNS = 4
export const BALANCE_MIN_RATIO = 0.4 // even out the columns only when the region is taller than 40% of the space

/** Scale at which a w x h figure fits a [width, max height] box, never enlarged. */
function fitScale(box: [number, number], w: number, h: number): number {
  return Math.min(box[0] / w, box[1] / h, 1.0)
}

class Region {
  left: Block[] = []
  right: Block[] = []
  leftAcc = new Accumulator()
  rightAcc = new Accumulator()
  leftFull = false

  isEmpty(): boolean {
    return !this.left.length && !this.right.length
  }

  height(): number {
    const left = this.leftAcc.used + (this.left.length ? this.leftAcc.lastMb : 0.0)
    const right = this.rightAcc.used + (this.right.length ? this.rightAcc.lastMb : 0.0)
    return Math.max(left, right)
  }
}

type Seg = ['cols', Region] | ['wide', Block, BlockHeight]

class TwoColPage extends Page {
  segments: Seg[] = []
  usedBefore = 0.0 // height of the closed segments
  region: Region | null = null

  override isEmpty(): boolean {
    return !this.segments.length && (this.region === null || this.region.isEmpty())
  }

  /** Blocks are emitted in source order (a floated figure keeps its place in the
   * content); `_layout` records where each block was placed on the page. */
  override toJson(): PageJson {
    const segments: Seg[] = [...this.segments]
    if (this.region !== null && !this.region.isEmpty()) segments.push(['cols', this.region])
    type Tag = string
    const tagged: Array<[Block, Tag]> = []
    segments.forEach((seg, s) => {
      if (seg[0] === 'cols') {
        for (const b of seg[1].left) tagged.push([b, `cols:${s}:left`])
        for (const b of seg[1].right) tagged.push([b, `cols:${s}:right`])
      } else {
        tagged.push([seg[1], `wide:${s}`])
      }
    })
    const orderOf = (b: Block): number => (b._order === undefined || b._order === null ? Infinity : b._order)
    tagged.sort((a, b) => orderOf(a[0]) - orderOf(b[0]) || 0)
    // copies without the runtime order key, so that toJson() can be called more than once
    const blocks = tagged.map(([b]) => {
      const c = { ...b }
      delete c._order
      return c as Block
    })
    const layout: Segment[] = []
    segments.forEach((seg, s) => {
      if (seg[0] === 'cols') {
        layout.push({
          kind: 'cols',
          left: tagged.flatMap(([, tag], i) => (tag === `cols:${s}:left` ? [i] : [])),
          right: tagged.flatMap(([, tag], i) => (tag === `cols:${s}:right` ? [i] : [])),
        })
      } else {
        layout.push({ kind: 'wide', index: tagged.findIndex(([, tag]) => tag === `wide:${s}`) })
      }
    })
    return { id: this.id as string, kind: this.kind, title: this.title, continued: this.continued, blocks, _layout: layout }
  }
}

/** Source-order key for the tail of a split block: after its head, before the next block. */
function nextOrder(order: unknown): number {
  const o = order === undefined || order === null ? Infinity : Number(order)
  if (o === Infinity) return o
  return o === Math.trunc(o) ? o + 0.5 : o + (Math.ceil(o) - o) / 2.0
}

/** Whether a block takes the full width in two-column mode. */
export function isWide(block: Block, ctx: PaginateContext, queue: Block[] | null = null): boolean {
  const override = ctx.spanOverride[block.id ?? '']
  if (override === 1 || override === 2) return override === 2
  const t = block.type
  if (t === 'heading') {
    // a heading directly followed by a wide block goes above the band
    if (queue && queue.length && queue[0]!.type !== 'heading') return isWide(queue[0]!, ctx, null)
    return false
  }
  if (t === 'table') return block.header.length >= WIDE_TABLE_COLUMNS
  if (t === 'html') return true
  if (FIGURE_TYPES.has(t)) {
    const bid = block.id ?? ''
    const h = ctx.heights[bid]
    const hs = ctx.heightsSingle[bid]
    // measured scales account for column splitting done by figures.js
    if (h && hs && h.scale !== null && hs.scale !== null) return hs.scale > h.scale
    // compare fit from intrinsic dimensions
    if (h && h.intrinsicW > 0 && h.intrinsicH > 0) {
      if (ctx.colBox === null || ctx.bandBox === null) {
        throw new RangeError('two-column pagination needs colBox and bandBox to place figures')
      }
      return fitScale(ctx.bandBox, h.intrinsicW, h.intrinsicH) > fitScale(ctx.colBox, h.intrinsicW, h.intrinsicH)
    }
    return false
  }
  return false
}

export function paginateTwoColumns(
  blocks: Block[],
  ctx: PaginateContext,
  initialTitle: string | null = null,
  initialContinued = false,
): Page[] {
  const pages: Page[] = []
  const queue: Block[] = deepCopy(blocks)
  queue.forEach((b, i) => {
    if (!('_order' in b)) b._order = i
  })
  let cur = new TwoColPage({ title: initialTitle, continued: initialContinued })

  const closeRegion = (balance: boolean): void => {
    if (cur.region === null) return
    if (cur.region.isEmpty()) {
      cur.region = null
      return
    }
    if (balance && cur.region.height() > BALANCE_MIN_RATIO * (ctx.capacity - cur.usedBefore)) {
      balanceRegion(cur.region, ctx)
    }
    cur.segments.push(['cols', cur.region])
    cur.usedBefore += cur.region.height()
    cur.region = null
  }

  /** Close the page. The open region is not balanced: at a page end the columns fill
   * top-down (left, then right); only a region above a band is evened out. */
  const flush = (): void => {
    closeRegion(false)
    if (!cur.isEmpty()) pages.push(cur)
  }
  const continuation = (): TwoColPage => new TwoColPage({ title: cur.title, continued: cur.title !== null || ctx.isSlide })
  const registerTail = (head: Block, tail: Block, tailH: BlockHeight): void => {
    ctx.heights[tail.id] = tailH
    ctx.heightsSingle[tail.id] = tailH
    tail._order = nextOrder(head._order)
  }

  while (queue.length) {
    const b = queue.shift()!
    const t = b.type
    if (t === 'pagebreak') {
      flush()
      cur = new TwoColPage({ title: cur.title, continued: cur.title !== null })
      continue
    }
    if (t === 'heading' && b.level === 1) {
      if (ctx.isSlide) {
        flush()
        const cover = new Page({ kind: 'cover', blocks: [b] })
        if (queue.length && queue[0]!.type === 'paragraph') cover.blocks.push(queue.shift()!)
        pages.push(cover)
        cur = new TwoColPage({ title: ctx.docTitle, continued: false })
        continue
      }
      if (!cur.isEmpty()) {
        flush()
        cur = new TwoColPage()
      }
    }
    if (t === 'heading' && b.level === 2 && ctx.isSlide) {
      flush()
      cur = new TwoColPage({ title: b.text, continued: false })
      continue
    }

    if (isWide(b, ctx, queue)) {
      closeRegion(true)
      const h = height(ctx.heightsSingle, b)
      const keep = keepWithNext(ctx, b, queue)
      if (cur.usedBefore + h.outer + keep <= ctx.capacity) {
        cur.segments.push(['wide', b, h])
        cur.usedBefore += h.outer
        continue
      }
      const remaining = ctx.capacity - cur.usedBefore - h.marginTop
      const split = trySplit(ctx, b, h, remaining, cur.isEmpty())
      if (split !== null) {
        const [head, headH, tail, tailH] = split
        cur.segments.push(['wide', head, headH])
        cur.usedBefore += headH.outer
        registerTail(head, tail, tailH)
        flush()
        cur = continuation()
        queue.unshift(tail)
        continue
      }
      if (cur.isEmpty()) {
        if (h.marginTop + h.height > ctx.capacity / SAFETY) {
          ctx.warnings.push(`block ${b.id ?? 'None'} (${t}) is taller than a page; it will be clipped`)
        }
        cur.segments.push(['wide', b, h])
        cur.usedBefore += h.outer
        continue
      }
      queue.unshift(b)
      const lastSeg = cur.segments[cur.segments.length - 1]
      if (lastSeg && lastSeg[0] === 'wide' && lastSeg[1].type === 'heading' && cur.segments.length > 1) {
        const heading = cur.segments.pop() as ['wide', Block, BlockHeight]
        cur.usedBefore -= heading[2].outer
        queue.unshift(heading[1])
      }
      flush()
      cur = continuation()
      continue
    }

    // column flow
    if (cur.region === null) cur.region = new Region()
    const reg = cur.region
    const limit = ctx.capacity - cur.usedBefore
    const h = height(ctx.heights, b)
    const keep = keepWithNext(ctx, b, queue)
    const [colBlocks, acc] = reg.leftFull ? [reg.right, reg.rightAcc] : [reg.left, reg.leftAcc]
    if (acc.used + acc.needed(h) + keep <= limit) {
      colBlocks.push(b)
      acc.add(h)
      continue
    }
    // a figure that no longer fits the left column floats to the top of the empty right
    // column; the text keeps flowing in the left column beside it (magazine-style)
    if (FIGURE_TYPES.has(t) && !reg.leftFull && !reg.right.length && reg.rightAcc.needed(h) <= limit) {
      reg.right.push(b)
      reg.rightAcc.add(h)
      continue
    }
    const remaining = acc.remaining(limit, h)
    const split = trySplit(ctx, b, h, remaining, acc.count === 0)
    if (split !== null) {
      const [head, headH, tail, tailH] = split
      colBlocks.push(head)
      acc.add(headH)
      registerTail(head, tail, tailH)
      queue.unshift(tail)
      if (!reg.leftFull) {
        reg.leftFull = true
      } else {
        flush()
        cur = continuation()
      }
      continue
    }
    if (acc.count === 0 && cur.usedBefore === 0) {
      if (acc.gapFor(h) + h.height > limit / SAFETY) {
        ctx.warnings.push(`block ${b.id ?? 'None'} (${t}) is taller than a column; it will be clipped`)
      }
      colBlocks.push(b)
      acc.add(h)
      continue
    }
    // move the block whole to the next column / page, taking a trailing heading along
    queue.unshift(b)
    if (colBlocks.length && colBlocks[colBlocks.length - 1]!.type === 'heading' && colBlocks.length > 1) {
      queue.unshift(colBlocks.pop()!)
      rebuildAccumulator(acc, colBlocks, ctx.heights)
    }
    if (!reg.leftFull && acc.count > 0) {
      reg.leftFull = true
    } else {
      flush()
      cur = continuation()
    }
  }
  flush()
  for (const p of pages) p.blocks.forEach(stripOrder)
  return pages
}

function rebuildAccumulator(acc: Accumulator, blocks: Block[], heights: Record<string, BlockHeight>): void {
  acc.used = 0.0
  acc.lastMb = 0.0
  acc.count = 0
  for (const b of blocks) acc.add(heights[b.id]!)
}

/** Redistribute the region's blocks (in source order) over both columns so they end at
 * roughly the same height (used when a band follows). */
function balanceRegion(reg: Region, ctx: PaginateContext): void {
  const orderOf = (b: Block): number => (b._order === undefined || b._order === null ? Infinity : b._order)
  const blocks = [...reg.left, ...reg.right].sort((a, b) => orderOf(a) - orderOf(b) || 0)
  const total = new Accumulator()
  for (const b of blocks) total.add(ctx.heights[b.id]!)
  const target = (total.used + total.lastMb) / 2.0
  let left: Block[] = []
  let right: Block[] = []
  let lacc = new Accumulator()
  for (const b of blocks) {
    if (right.length) {
      right.push(b)
      continue
    }
    const h = ctx.heights[b.id]!
    if (lacc.used + lacc.needed(h) <= target) {
      left.push(b)
      lacc.add(h)
      continue
    }
    // whole blocks only: splitting a short list or code block just to even the columns reads as a stray break
    if (!left.length) {
      left.push(b) // an unsplittable first block stays left, whatever its height
      lacc.add(h)
    } else {
      right.push(b)
    }
  }
  if (right.length && left.length && left[left.length - 1]!.type === 'heading') {
    if (left.length === 1) return // balancing would strand a lone heading away from its content
    right = [left.pop()!, ...right]
  }
  lacc = new Accumulator()
  const racc = new Accumulator()
  rebuildAccumulator(lacc, left, ctx.heights)
  rebuildAccumulator(racc, right, ctx.heights)
  const newHeight = Math.max(lacc.used + (left.length ? lacc.lastMb : 0.0), racc.used + (right.length ? racc.lastMb : 0.0))
  if (newHeight > reg.height() + 0.5) {
    // the source-order redistribution would be taller than the current placement
    // (typically a floated figure followed by long text): keep the current placement
    return
  }
  reg.left = left
  reg.right = right
  reg.leftAcc = lacc
  reg.rightAcc = racc
  reg.leftFull = true
}

/** Concatenate all blocks, merging continued tables/code with their predecessor.
 *
 * Slide formats turn every h2 into a page title and drop the heading block, so a titled
 * page that is not a continuation gets its h2 back here; the page right after the cover
 * carries the document title, which the h1 already provides. */
export function flattenForReflow(pages: PageJson[]): Block[] {
  const blocks: Block[] = []
  let prevKind: string | null = null
  for (const page of pages) {
    if (page.kind === 'source') continue
    if (page.kind === 'content' && page.title && !page.continued && prevKind !== 'cover') {
      blocks.push({ type: 'heading', level: 2, text: page.title })
    }
    prevKind = page.kind
    for (const b of page.blocks) {
      const prev = blocks[blocks.length - 1]
      if (b.continued && prev && prev.type === b.type) {
        if (b.type === 'table') {
          prev.rows = [...prev.rows, ...b.rows]
          continue
        }
        if (b.type === 'code') {
          prev.lines = [...prev.lines, ...b.lines]
          continue
        }
      }
      const nb = { ...b }
      delete nb.continued
      blocks.push(nb as Block)
    }
  }
  return blocks
}
