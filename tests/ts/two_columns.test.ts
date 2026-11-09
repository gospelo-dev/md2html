// Two-column pagination with fixed heights, no browser (port of tests/test_two_columns.py).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BlockHeight, type BlockHeightInit, isWide, paginate, type PaginateContext, type Page, spillPages } from '../../skills/claude/gospelo-md2html/src/paginate.ts'

const LINE = 24.0
const COL_BOX: [number, number] = [400.0, 490.0] // one column: 400px wide, up to 490px tall
const BAND_BOX: [number, number] = [830.0, 300.0] // full width: 830px wide, up to 300px tall

const bh = (height: number, marginTop = 0, marginBottom = 0, extra: Partial<BlockHeightInit> = {}): BlockHeight =>
  new BlockHeight({ height, marginTop, marginBottom, ...extra })

function ctx(heights: Record<string, BlockHeight>, capacity = 500, slide = false, span: Record<string, number> = {}): PaginateContext {
  return {
    isSlide: slide,
    columns: 'two',
    capacity,
    linePx: LINE,
    heights: { ...heights },
    heightsSingle: { ...heights },
    docTitle: 'Doc',
    warnings: [],
    spanOverride: span,
    colBox: COL_BOX,
    bandBox: BAND_BOX,
  }
}

const para = (i: number, h: number): [any, BlockHeight] => [{ type: 'paragraph', text: `p${i}`, id: `b${i}` }, bh(h, 0, 10)]
const layoutOf = (page: Page): any[] => page.toJson()._layout as any[]
const ids = (page: Page): string[] => page.toJson().blocks.map((b) => b.id)

function paras(n: number, h: number): [any[], Record<string, BlockHeight>] {
  const blocks = []
  const heights: Record<string, BlockHeight> = {}
  for (let i = 0; i < n; i++) {
    const [b, hh] = para(i, h)
    blocks.push(b)
    heights[b.id] = hh
  }
  return [blocks, heights]
}

test('fills left column then right', () => {
  const [blocks, heights] = paras(6, 100)
  const pages = paginate(blocks, ctx(heights, 350))
  assert.equal(pages.length, 1)
  assert.deepEqual(ids(pages[0]!), ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'])
  const [cols] = layoutOf(pages[0]!)
  assert.equal(cols.kind, 'cols')
  assert.deepEqual(cols.left, [0, 1, 2])
  assert.deepEqual(cols.right, [3, 4, 5])
})

test('overflow of the right column starts a continuation page', () => {
  const [blocks, heights] = paras(8, 100)
  const pages = paginate(blocks, ctx(heights, 350), 'T')
  assert.deepEqual(pages.map((p) => p.toJson().blocks.length), [6, 2])
  assert.equal(pages[1]!.continued, true)
  assert.equal(pages[1]!.title, 'T')
})

test('wide table becomes a band and takes its heading along', () => {
  const heading = { type: 'heading', level: 3, text: 'H', id: 'h' }
  const table = { type: 'table', header: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3', '4']], id: 't' }
  const [p0, h0] = para(0, 100)
  const heights = { h: bh(30, 20, 5), t: bh(80, 0, 10, { thead: 30, rows: [50] }), b0: h0 }
  const c = ctx(heights)
  assert.ok(isWide(table, c))
  const pages = paginate([p0, heading, table], c)
  const layout = layoutOf(pages[0]!)
  assert.deepEqual(layout.map((s) => s.kind), ['cols', 'wide', 'wide'])
  assert.deepEqual(ids(pages[0]!), ['b0', 'h', 't'])
  assert.equal(layout[1].index, 1)
  assert.equal(layout[2].index, 2)
})

test('narrow table stays in the columns', () => {
  const table = { type: 'table', header: ['a', 'b', 'c'], rows: [['1', '2', '3']], id: 't' }
  assert.ok(!isWide(table, ctx({ t: bh(80, 0, 10, { thead: 30, rows: [50] }) })))
})

test('figure becomes a band when that renders it larger', () => {
  const wide = { type: 'mermaid', source: 'graph LR; A-->B', id: 'w' }
  const tall = { type: 'mermaid', source: 'graph TB; A-->B', id: 't' }
  const heights = {
    w: bh(200, 0, 10, { intrinsicW: 800, intrinsicH: 400 }), // column 0.5, band 0.75
    t: bh(490, 0, 10, { intrinsicW: 400, intrinsicH: 600 }), // column 0.82, band 0.5
  }
  const c = ctx(heights)
  assert.ok(isWide(wide, c))
  assert.ok(!isWide(tall, c))
})

test('span override forces a band or a column', () => {
  const [p0, h0] = para(0, 100)
  const heights: Record<string, BlockHeight> = { b0: h0 }
  assert.ok(isWide(p0, ctx(heights, 500, false, { b0: 2 })))
  const code = { type: 'code', lang: null, lines: ['x'], id: 'c' }
  heights.c = bh(40, 0, 10, { lines: [20], padding: 20 })
  assert.ok(!isWide(code, ctx(heights, 500, false, { c: 1 })))
})

test('figure floats to the empty right column and text keeps flowing left', () => {
  const heading = { type: 'heading', level: 3, text: 'H', id: 'h' }
  const fig = { type: 'mermaid', source: 'graph TB; A-->B', id: 'f' }
  const lst = { type: 'list', ordered: false, items: [{ text: 'x' }], id: 'l' }
  const heights = { h: bh(30, 20, 5), f: bh(460, 0, 10, { intrinsicW: 100, intrinsicH: 300 }), l: bh(120, 0, 10) }
  const pages = paginate([heading, fig, lst], ctx(heights, 500))
  assert.equal(pages.length, 1)
  assert.deepEqual(ids(pages[0]!), ['h', 'f', 'l'])
  const [cols] = layoutOf(pages[0]!)
  assert.deepEqual(cols.left, [0, 2])
  assert.deepEqual(cols.right, [1])
})

test('balancing never makes the region taller', () => {
  const heading = { type: 'heading', level: 3, text: 'H', id: 'h' }
  const fig = { type: 'mermaid', source: 'graph TB; A-->B', id: 'f' }
  const l1 = { type: 'list', ordered: false, items: [{ text: 'x' }], id: 'l1' }
  const l2 = { type: 'list', ordered: false, items: [{ text: 'y' }], id: 'l2' }
  const h2 = { type: 'heading', level: 2, text: 'Next', id: 'h2' }
  const [p1, hp1] = para(1, 50)
  const heights = {
    h: bh(30, 20, 5),
    f: bh(460, 0, 10, { intrinsicW: 100, intrinsicH: 300 }),
    l1: bh(120, 0, 10),
    l2: bh(200, 0, 10),
    h2: bh(30, 20, 5),
    b1: hp1,
  }
  const pages = paginate([heading, fig, l1, l2, h2, p1], ctx(heights, 500, true))
  const [cols] = layoutOf(pages[0]!)
  assert.deepEqual(cols.left, [0, 2, 3])
  assert.deepEqual(cols.right, [1])
  assert.ok(heights.f.outer <= 500)
  assert.equal(pages[1]!.title, 'Next')
})

test('page end is not balanced: left column fills first', () => {
  const [blocks, heights] = paras(6, 100)
  const [cols] = layoutOf(paginate(blocks, ctx(heights, 500))[0]!)
  assert.deepEqual(cols.left, [0, 1, 2, 3])
  assert.deepEqual(cols.right, [4, 5])
})

test('balancing does not strand a lone heading', () => {
  const heading = { type: 'heading', level: 3, text: 'H', id: 'h' }
  const code = { type: 'code', lang: 'json', lines: ['x', 'x', 'x', 'x'], id: 'c' }
  const table = { type: 'table', header: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3', '4']], id: 't' }
  const heights = {
    h: bh(30, 20, 5),
    c: bh(250, 10, 20, { lines: [60, 60, 60, 60], padding: 10 }),
    t: bh(80, 0, 10, { thead: 30, rows: [50] }),
  }
  const [cols, band] = layoutOf(paginate([heading, code, table], ctx(heights, 500))[0]!)
  assert.equal(band.kind, 'wide')
  assert.deepEqual(cols.left, [0, 1])
  assert.deepEqual(cols.right, [])
})

test('short region is not balanced', () => {
  const [p0, h0] = para(0, 60)
  const [p1, h1] = para(1, 60)
  const [cols] = layoutOf(paginate([p0, p1], ctx({ b0: h0, b1: h1 }, 500))[0]!)
  assert.deepEqual(cols.left, [0, 1])
  assert.deepEqual(cols.right, [])
})

test('spill page keeps layout and unique continuation ids', () => {
  const page = {
    id: 'p05',
    kind: 'content',
    title: 'T',
    continued: false,
    blocks: [0, 1, 2].map((i) => ({ type: 'paragraph', text: 'abc'[i]!, id: `p05-b${i}` })),
  }
  const heights = Object.fromEntries([0, 1, 2].map((i) => [`p05-b${i}`, bh(300, 0, 10)]))
  const [newPages, spills] = spillPages([page], () => ctx(heights, 400), new Set(['p05-2']))
  assert.deepEqual(newPages.map((p) => p.id), ['p05', 'p05-3'])
  const seg = newPages[0]!._layout![0] as { left: number[]; right: number[] }
  assert.deepEqual(seg.left, [0])
  assert.deepEqual(seg.right, [1])
  assert.deepEqual(spills[0]!.blocks, ['p05-b2'])
})
