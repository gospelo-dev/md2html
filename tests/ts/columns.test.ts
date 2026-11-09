// Column options: --gutter, per-page splitRatio / gutter overrides, and the
// `<!-- layout: ... -->` section comment in the Markdown. No browser.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as blocksMod from '../../skills/claude/gospelo-md2html/src/blocks.ts'
import { getFormat } from '../../skills/claude/gospelo-md2html/src/formats.ts'
import { LayoutError, layoutToDict } from '../../skills/claude/gospelo-md2html/src/layout.ts'
import { effectiveLayout, pageMetrics, renderPage } from '../../skills/claude/gospelo-md2html/src/render.ts'
import { buildMetrics, DEFAULT_GUTTER, parseGutter } from '../../skills/claude/gospelo-md2html/src/scale.ts'
import {
  parseLayoutComment,
  remapPageOverrides,
  runs,
  sectionSettings,
} from '../../skills/claude/gospelo-md2html/src/sections.ts'
import { ctxFor, layoutOf } from './helpers.ts'

const F = 18.6667 // 14pt
const slide = () => buildMetrics(getFormat('16x9'), null, 1.25, null, 'right', 0.5)

// --- gutter ----------------------------------------------------------------------

test('gutter lengths: em is the body font size', () => {
  assert.equal(parseGutter('2em', F), 2 * F)
  assert.equal(parseGutter('40px', F), 40)
  assert.ok(Math.abs(parseGutter('10mm', F) - 37.795) < 0.01)
  assert.ok(Math.abs(parseGutter('30pt', F) - 40) < 0.01)
  assert.throws(() => parseGutter('wide', F), RangeError)
  assert.throws(() => parseGutter('-1em', F), RangeError)
})

test('the default gutter is 2em, and documents record the gutter they used', () => {
  assert.equal(DEFAULT_GUTTER, '2em')
  const m = slide()
  assert.ok(Math.abs(m.gutterPx - 2 * m.F) < 1e-9)
  assert.equal(layoutToDict(layoutOf()).gutter, null)
  assert.equal(effectiveLayout(layoutOf()).gutter, '2em')
  assert.equal(effectiveLayout(layoutOf({ gutter: '30px' })).gutter, '30px')
})

test('a wider gutter narrows the columns', () => {
  const m = slide()
  const wide = buildMetrics(getFormat('16x9'), null, 1.25, null, 'right', 0.5, '4em')
  assert.ok(wide.col2Px < m.col2Px && wide.textColPx < m.textColPx)
  assert.equal(Math.round((m.col2Px - wide.col2Px) * 2), Math.round(2 * m.F))
})

test('a gutter wider than a fifth of the content width is an error', () => {
  assert.throws(() => buildMetrics(getFormat('16x9'), null, 1.25, null, 'right', 0.5, '300px'), /wider than 20%/)
  assert.throws(() => layoutOf({ gutter: 'big' }), LayoutError)
})

// --- page overrides --------------------------------------------------------------

test('page overrides are checked wherever the layout comes from', () => {
  assert.throws(() => layoutOf({}, { overrides: { p02: { splitRatio: 0.3 } } }), /splitRatio/)
  assert.throws(() => layoutOf({}, { overrides: { p02: { gutter: 'x' } } }), /gutter/)
  assert.throws(() => layoutOf({}, { overrides: { p02: { figureSide: 'top' } } }), /figureSide/)
  layoutOf({}, { overrides: { p02: { splitRatio: 0.4, gutter: '3em', figureSide: 'left' } } })
})

test("a page's split ratio and gutter give it its own metrics and section variables", () => {
  const layout = layoutOf({ page: '16x9' }, { overrides: { p02: { columns: 'split', splitRatio: 0.4, gutter: '3em' } } })
  const ctx = ctxFor(layout)
  assert.equal(pageMetrics('p01', ctx), ctx.metrics)
  const pm = pageMetrics('p02', ctx)
  assert.equal(pm.splitRatio, 0.4)
  assert.ok(Math.abs(pm.gutterPx - 3 * ctx.metrics.F) < 1e-9)
  const page = (id: string) => ({
    id,
    kind: 'content',
    title: 'T',
    continued: false,
    blocks: [{ id: `${id}-b0`, type: 'paragraph', text: 'x' }],
  })
  assert.match(renderPage(page('p02'), ctx, 2, 2, 'D', null), /<section class="page" data-page-id="p02" data-mode="single" style="--gutter: 56\.000px; --text-fr: 0\.8fr; --figure-fr: 1\.2fr;">/)
  assert.ok(!renderPage(page('p01'), ctx, 1, 2, 'D', null).includes('style="--gutter'))
})

// --- the layout comment ------------------------------------------------------------

const parse = (md: string) => sectionSettings(blocksMod.parseBlocks(md, false, new blocksMod.ImportNotes()))

test('a layout comment after a heading lays out that section', () => {
  const md =
    '# Deck\n\n## A\n\na\n\n## B\n<!-- layout: columns=single split-ratio=0.4 gutter=3em figure-side=left -->\n\nb\n\n### B.1\n\nb1\n\n## C\n\nc\n'
  const { blocks, settings } = parse(md)
  assert.ok(!blocks.some((b) => b.type === 'layout'))
  const at = (text: string) => settings[blocks.findIndex((b) => b.text === text)]
  assert.equal(at('a'), null)
  assert.deepEqual(at('B'), { columns: 'single', splitRatio: 0.4, gutter: '3em', figureSide: 'left' })
  assert.deepEqual(at('b1'), at('B')) // a lower heading stays in the section
  assert.equal(at('C'), null) // the next heading of the same level ends it
  assert.deepEqual(
    runs(blocks, settings).map((r) => r.blocks.map((b) => b.text)),
    [['Deck', 'A', 'a'], ['B', 'b', 'B.1', 'b1'], ['C', 'c']],
  )
})

test('an inner section overrides the outer one, and the outer resumes after it', () => {
  const md = '## A\n<!-- layout: columns=single -->\n\na\n\n### A.1\n<!-- layout: columns=split -->\n\na1\n\n### A.2\n\na2\n'
  const { blocks, settings } = parse(md)
  const at = (text: string) => settings[blocks.findIndex((b) => b.text === text)]
  assert.deepEqual(at('a'), { columns: 'single' })
  assert.deepEqual(at('a1'), { columns: 'split' })
  assert.deepEqual(at('a2'), { columns: 'single' })
})

test('misplaced or malformed layout comments stop', () => {
  assert.throws(() => parse('text\n\n<!-- layout: columns=single -->\n'), /right after a heading/)
  assert.throws(() => parse('## A\n<!-- layout: columns=single -->\n<!-- layout: gutter=2em -->\n'), /one per heading/)
  assert.throws(() => parse('## A\n\nsee <!-- layout: columns=single --> here\n'), /inside a paragraph/)
  assert.throws(() => parseLayoutComment('columns=wide', 'h'), /columns/)
  assert.throws(() => parseLayoutComment('colour=red', 'h'), /unknown key 'colour'/)
  assert.throws(() => parseLayoutComment('split-ratio=0.9', 'h'), /splitRatio/)
  assert.throws(() => parseLayoutComment('columns', 'h'), /not key=value/)
  assert.throws(() => parseLayoutComment('', 'h'), /sets nothing/)
})

test('renumbering moves page overrides to the new ids and drops stale ones', () => {
  const overrides = { p03: { columns: 'single' }, 'p03-2': { columns: 'single' }, p09: { gutter: '3em' }, 'p03-b1': { span: 2 } }
  const out = remapPageOverrides(overrides, new Map([['p03', 'p03'], ['p03-2', 'p04'], ['p05', 'p06']]))
  assert.deepEqual(out, { 'p03-b1': { span: 2 }, p03: { columns: 'single' }, p04: { columns: 'single' } })
})
