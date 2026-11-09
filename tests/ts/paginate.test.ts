// Pagination rules with fixed heights, no browser (port of tests/test_paginate.py).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BlockHeight,
  type BlockHeightInit,
  flattenForReflow,
  paginate,
  type PaginateContext,
  relayoutPages,
  spillPages,
} from '../../skills/claude/gospelo-md2html/src/paginate.ts'

const LINE = 24.0

export function bh(height: number, marginTop = 0, marginBottom = 0, extra: Partial<BlockHeightInit> = {}): BlockHeight {
  return new BlockHeight({ height, marginTop, marginBottom, ...extra })
}

function ctx(
  opts: { capacity?: number; slide?: boolean; columns?: string; col?: Record<string, BlockHeight>; single?: Record<string, BlockHeight> } = {},
): PaginateContext {
  const single = opts.single ?? {}
  const col = opts.col ?? single
  return {
    isSlide: opts.slide ?? false,
    columns: opts.columns ?? 'single',
    capacity: opts.capacity ?? 500,
    linePx: LINE,
    heights: { ...col },
    heightsSingle: { ...single },
    docTitle: 'Doc',
    warnings: [],
    spanOverride: {},
    colBox: null,
    bandBox: null,
  }
}

const ids = (blocks: any[]): string[] => blocks.map((b) => b.id)

test('blocks flow until capacity', () => {
  const blocks = []
  const heights: Record<string, BlockHeight> = {}
  for (let i = 0; i < 6; i++) {
    blocks.push({ type: 'paragraph', text: 'a b c', id: `b${i}` })
    heights[`b${i}`] = bh(100, 0, 10)
  }
  const pages = paginate(blocks, ctx({ capacity: 350, single: heights }))
  assert.deepEqual(pages.map((p) => p.blocks.length), [3, 3])
})

test('heading keeps with next', () => {
  const blocks = [
    { type: 'paragraph', text: 'x', id: 'b0' },
    { type: 'heading', level: 3, text: 'H', id: 'b1' },
    { type: 'paragraph', text: 'y', id: 'b2' },
  ]
  const heights = { b0: bh(400, 0, 10), b1: bh(30, 20, 5), b2: bh(200, 0, 10) }
  const pages = paginate(blocks, ctx({ capacity: 500, single: heights }))
  assert.deepEqual(ids(pages[0]!.blocks), ['b0'])
  assert.deepEqual(ids(pages[1]!.blocks), ['b1', 'b2'])
})

test('heading follows a block moved whole', () => {
  const blocks = [
    { type: 'paragraph', text: 'x', id: 'b0' },
    { type: 'heading', level: 2, text: 'H', id: 'b1' },
    { type: 'table', header: ['h'], rows: [['1'], ['2'], ['3'], ['4']], id: 'b2' },
  ]
  const heights = { b0: bh(300, 0, 10), b1: bh(30, 20, 5), b2: bh(30 + 4 * 40, 0, 10, { thead: 30, rows: [40, 40, 40, 40] }) }
  const pages = paginate(blocks, ctx({ capacity: 450, single: heights }))
  assert.deepEqual(ids(pages[0]!.blocks), ['b0'])
  assert.deepEqual(ids(pages[1]!.blocks), ['b1', 'b2'])
})

test('heading reserves full figure height in single mode', () => {
  const blocks = [
    { type: 'paragraph', text: 'x', id: 'b0' },
    { type: 'heading', level: 3, text: 'H', id: 'b1' },
    { type: 'image', src: 'a.png', alt: '', id: 'b2' },
  ]
  const heights = { b0: bh(200, 0, 10), b1: bh(30, 20, 5), b2: bh(300, 0, 10) }
  const pages = paginate(blocks, ctx({ capacity: 400, single: heights }))
  assert.deepEqual(ids(pages[1]!.blocks), ['b1', 'b2'])
})

test('table splits by rows with min three', () => {
  const rows = Array.from({ length: 10 }, (_, i) => [String(i)])
  const table = { type: 'table', header: ['h'], rows, id: 't' }
  const heights = { t: bh(30 + 10 * 40, 0, 10, { thead: 30, rows: Array(10).fill(40), lineHeight: 20 }) }
  const pages = paginate([table], ctx({ capacity: 300, single: heights }))
  assert.deepEqual(pages[0]!.blocks[0]!.rows, rows.slice(0, 6))
  assert.equal(pages[1]!.blocks[0]!.continued, true)
  assert.deepEqual(pages[1]!.blocks[0]!.rows, rows.slice(6))
})

test('table is not split when it fits on a fresh page', () => {
  const filler = { type: 'paragraph', text: 'p', id: 'p' }
  const table = { type: 'table', header: ['h'], rows: [['1'], ['2'], ['3'], ['4']], id: 't' }
  const heights = { p: bh(300, 0, 10), t: bh(30 + 4 * 40, 0, 10, { thead: 30, rows: [40, 40, 40, 40] }) }
  const pages = paginate([filler, table], ctx({ capacity: 400, single: heights }))
  assert.equal(pages.length, 2)
  assert.ok(!('continued' in pages[1]!.blocks[0]!))
})

test('code under 16 lines is not split', () => {
  const code = { type: 'code', lang: null, lines: Array(10).fill('x'), id: 'c' }
  const filler = { type: 'paragraph', text: 'p', id: 'p' }
  const heights = { p: bh(300, 0, 10), c: bh(10 * 20 + 20, 0, 10, { lines: Array(10).fill(20), padding: 20 }) }
  const pages = paginate([filler, code], ctx({ capacity: 400, single: heights }))
  assert.equal(pages.length, 2)
  assert.equal(pages[1]!.blocks[0]!.lines.length, 10)
})

test('ordered list continues numbering', () => {
  const lst = { type: 'list', ordered: true, items: Array.from({ length: 6 }, (_, i) => ({ text: String(i) })), id: 'l' }
  const heights = { l: bh(6 * 50, 0, 10, { items: Array(6).fill(50) }) }
  const pages = paginate([lst], ctx({ capacity: 200, single: heights }))
  // 3 items (150px) fit under capacity 200 minus the 10px bottom margin; the tail starts at item 4
  assert.deepEqual(pages[0]!.blocks[0]!.items.map((i: any) => i.text), ['0', '1', '2'])
  assert.equal(pages[1]!.blocks[0]!.start, 4)
})

test('slide h2 becomes title and figure goes to slot', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Deck', id: 'b0' },
    { type: 'heading', level: 2, text: 'Sec', id: 'b1' },
    { type: 'paragraph', text: 'p', id: 'b2' },
    { type: 'mermaid', source: 'graph LR; A-->B', id: 'b3' },
    { type: 'mermaid', source: 'graph LR; C-->D', id: 'b4' },
  ]
  const heights = { b2: bh(50, 0, 10), b3: bh(200, 0, 10), b4: bh(200, 0, 10) }
  const pages = paginate(blocks, ctx({ capacity: 500, slide: true, columns: 'split', single: heights }))
  assert.equal(pages[0]!.kind, 'cover')
  assert.equal(pages[1]!.title, 'Sec')
  assert.equal(pages[1]!.figure!.id, 'b3')
  assert.ok(pages[1]!.blocks.every((b) => b.type !== 'heading' || b.level !== 2))
  assert.equal(pages[2]!.continued, true)
  assert.equal(pages[2]!.figure!.id, 'b4')
})

test('single committed page rejects late figure', () => {
  const blocks = [
    { type: 'paragraph', text: 'wide', id: 'b0' },
    { type: 'mermaid', source: 'graph LR; A-->B', id: 'b1' },
  ]
  const col = { b0: bh(600, 0, 10), b1: bh(100, 0, 10) }
  const single = { b0: bh(300, 0, 10), b1: bh(100, 0, 10) }
  const pages = paginate(blocks, ctx({ capacity: 500, columns: 'split', col, single }))
  assert.equal(pages[0]!.figure, null)
  assert.ok(pages[0]!.singleCommitted)
  assert.equal(pages[1]!.figure!.id, 'b1')
})

test('spill keeps page ids and adds suffix', () => {
  const page = {
    id: 'p05',
    kind: 'content',
    title: 'T',
    continued: false,
    blocks: [
      { type: 'paragraph', text: 'a', id: 'p05-b0' },
      { type: 'paragraph', text: 'b', id: 'p05-b1' },
    ],
  }
  const heights = { 'p05-b0': bh(300, 0, 10), 'p05-b1': bh(300, 0, 10) }
  const [newPages, spills] = spillPages([page], () => ctx({ capacity: 400, single: heights }))
  assert.deepEqual(newPages.map((p) => p.id), ['p05', 'p05-2'])
  assert.equal(newPages[1]!.continued, true)
  assert.equal(newPages[1]!.title, 'T')
  assert.equal(spills[0]!.source, 'p05')
  assert.equal(spills[0]!.target, 'p05-2')
})

test('reflow merges continued tables', () => {
  const pages = [
    { id: 'p1', kind: 'content', title: null, continued: false, blocks: [{ type: 'table', header: ['h'], rows: [['1']] }] },
    { id: 'p2', kind: 'content', title: null, continued: false, blocks: [{ type: 'table', header: ['h'], rows: [['2']], continued: true }] },
  ]
  const flat = flattenForReflow(pages)
  assert.equal(flat.length, 1)
  assert.deepEqual(flat[0]!.rows, [['1'], ['2']])
})

test('reflow restores slide section headings', () => {
  // slides: h2 became the page title and was dropped from the blocks; the page after the
  // cover carries the document title (from the h1) and continuation pages repeat the title
  const para = { type: 'paragraph', text: 'x' }
  const pages = [
    { id: 'p01', kind: 'cover', title: null, continued: false, blocks: [{ type: 'heading', level: 1, text: 'Doc' }] },
    { id: 'p02', kind: 'content', title: 'Doc', continued: false, blocks: [para] },
    { id: 'p03', kind: 'content', title: '1. Intro', continued: false, blocks: [para] },
    { id: 'p04', kind: 'content', title: '1. Intro', continued: true, blocks: [para] },
    { id: 'p05', kind: 'content', title: '2. Next', continued: false, blocks: [para] },
  ]
  const flat = flattenForReflow(pages)
  assert.deepEqual(
    flat.map((b) => [b.type, b.text]),
    [
      ['heading', 'Doc'],
      ['paragraph', 'x'],
      ['heading', '1. Intro'],
      ['paragraph', 'x'],
      ['paragraph', 'x'],
      ['heading', '2. Next'],
      ['paragraph', 'x'],
    ],
  )
  assert.equal(flat[2]!.level, 2)
  // portrait documents keep h2 as blocks and have no page titles: nothing is added
  assert.deepEqual(flattenForReflow([{ id: 'p1', kind: 'content', title: null, continued: false, blocks: [para] }]), [para])
})

test('relayout keeps each page once', () => {
  // p26-2 was pushed out of p26 by the verify pass; both are re-laid out in the same pass and
  // both overflow. p26-2 used to be taken in as a continuation of p26 and then added again
  const page = (pid: string, ...blocks: any[]): any => ({ id: pid, kind: 'content', title: 'T', continued: true, blocks })
  const heights = Object.fromEntries([0, 1, 2, 3].map((i) => [`b${i}`, bh(300, 0, 10)]))
  const paras = [0, 1, 2, 3].map((i) => ({ type: 'paragraph', text: 'x', id: `b${i}` }))
  const current = [page('p26', paras[0], paras[1]), page('p26-2', paras[2], paras[3]), page('p27', { type: 'paragraph', text: 'y', id: 'c' })]
  const spill = (pages: any[], existing: Set<string>) =>
    spillPages(pages, () => ctx({ capacity: 500, single: heights }), existing)
  const out = relayoutPages(current, (p) => p.id !== 'p27', spill)
  assert.deepEqual(out.map((p) => p.id), ['p26', 'p26-3', 'p26-2', 'p26-2-2', 'p27'])
  assert.deepEqual(out.map((p) => ids(p.blocks)), [['b0'], ['b1'], ['b2'], ['b3'], ['c']])
})
