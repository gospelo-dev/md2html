// Content validation, page-0 restore, inline splitting and Markdown import
// (port of tests/test_content_and_inline.py).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as blocksMod from '../../skills/claude/gospelo-md2html/src/blocks.ts'
import {
  ContentError,
  envelopeScript,
  extractFromHtml,
  getSourceMarkdown,
  makeEnvelope,
  makeSourcePage,
  validateContent,
} from '../../skills/claude/gospelo-md2html/src/content.ts'
import { plainText, splitInline } from '../../skills/claude/gospelo-md2html/src/inline.ts'
import { renderBlock, type RenderContext } from '../../skills/claude/gospelo-md2html/src/render.ts'
import { parseFontSize } from '../../skills/claude/gospelo-md2html/src/scale.ts'

const doc = (pages: any[]): any => ({ version: 1, meta: { title: 'T', date: null, source: null }, pages })
const page = (kw: Record<string, unknown> = {}): any => ({ id: 'p01', kind: 'content', title: null, continued: false, blocks: [], ...kw })

test('valid minimal document', () => {
  validateContent(doc([page({ blocks: [{ type: 'paragraph', text: 'hi' }] })]))
})

test('unknown block type is rejected', () => {
  assert.throws(() => validateContent(doc([page({ blocks: [{ type: 'widget' }] })])), ContentError)
})

test('table row length must match header', () => {
  assert.throws(() => validateContent(doc([page({ blocks: [{ type: 'table', header: ['a', 'b'], rows: [['1']] }] })])), ContentError)
})

test('markdown block only on source page', () => {
  assert.throws(() => validateContent(doc([page({ blocks: [{ type: 'markdown', text: 'x' }] })])), ContentError)
  validateContent(doc([makeSourcePage('# x'), page({ id: 'p02', blocks: [{ type: 'paragraph', text: 'y' }] })]))
})

test('source page must be first', () => {
  assert.throws(
    () => validateContent(doc([page({ blocks: [{ type: 'paragraph', text: 'y' }] }), { ...makeSourcePage('# x'), id: 'p99' }])),
    ContentError,
  )
})

test('restore round trip through html', () => {
  const md = '# Title\n\n<script>alert(1)</script>\n\nbody'
  const d = doc([makeSourcePage(md), page({ id: 'p02', blocks: [{ type: 'paragraph', text: 'y' }] })])
  const html = '<html><head>' + envelopeScript(makeEnvelope(d, { page: 'a4' })) + '</head><body></body></html>'
  const [got, layout] = extractFromHtml(html)
  assert.equal(getSourceMarkdown(got), md)
  assert.deepEqual(layout, { page: 'a4' })
})

test('font size units', () => {
  assert.ok(Math.abs(parseFontSize('11pt') - 14.6667) < 0.01)
  assert.equal(parseFontSize('14px'), 14)
  assert.throws(() => parseFontSize('large'), RangeError)
})

test('split inline keeps formatting', () => {
  const text = 'This is **bold text** and `code` here'
  const idx = plainText(text).indexOf('text')
  assert.deepEqual(splitInline(text, idx), ['This is **bold**', '**text** and `code` here'])
})

test('split inline never cuts inside code', () => {
  const [head, tail] = splitInline('abc `def ghi` jkl', 6)!
  assert.equal(head, 'abc')
  assert.ok(tail.startsWith('`def ghi`'))
})

test('split inline closes and reopens a link', () => {
  const text = 'see [the long link text](https://example.com/x) now'
  const idx = plainText(text).indexOf('link')
  assert.deepEqual(splitInline(text, idx), ['see [the long](https://example.com/x)', '[link text](https://example.com/x) now'])
})

test('import rescues mermaid from details and drops png', () => {
  const md =
    '# Doc\n\n![diagram](images/x.png)\n\n<details><summary>Mermaid source</summary>\n\n' +
    '```mermaid\ngraph LR\n  A --> B\n```\n\n</details>\n\n<details><summary>Other</summary>\n\nhidden\n\n</details>\n\ntext\n'
  const notes = new blocksMod.ImportNotes()
  const text = blocksMod.preprocessMarkdown(md, 'drop', notes)
  const blocks = blocksMod.parseBlocks(text, false, notes)
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'mermaid', 'paragraph'])
  assert.equal(blocks[1]!.source, 'graph LR\n  A --> B')
  assert.equal(notes.rescuedMermaid, 1)
  assert.deepEqual(notes.discardedImages, ['images/x.png'])
  assert.deepEqual(notes.droppedDetails, ['hidden'])
})

test('import tables, lists and pagebreak', () => {
  const md = '| a | b |\n| --- | ---: |\n| 1 | 2 |\n\n- x\n  - y\n- z\n\n<!-- pagebreak -->\n\n1. one\n2. two\n'
  const blocks = blocksMod.parseBlocks(md, false, new blocksMod.ImportNotes())
  assert.deepEqual(blocks[0], { type: 'table', header: ['a', 'b'], rows: [['1', '2']], align: ['left', 'right'] })
  assert.deepEqual(blocks[1], { type: 'list', ordered: false, items: [{ text: 'x', children: [{ text: 'y' }] }, { text: 'z' }] })
  assert.deepEqual(blocks[2], { type: 'pagebreak' })
  assert.equal(blocks[3]!.ordered, true)
  assert.deepEqual(blocks[3]!.items.map((i: any) => i.text), ['one', 'two'])
})

test('code block in a list item ends the list there', () => {
  const md = '1. first\n\n   ```bash\n   git fetch origin\n   git pull\n   ```\n\n   after the code\n\n2. second\n3. third\n'
  const notes = new blocksMod.ImportNotes()
  assert.deepEqual(blocksMod.parseBlocks(md, false, notes), [
    { type: 'list', ordered: true, items: [{ text: 'first' }] },
    { type: 'code', lang: 'bash', lines: ['git fetch origin', 'git pull'] },
    { type: 'paragraph', text: 'after the code' },
    { type: 'list', ordered: true, items: [{ text: 'second' }, { text: 'third' }], start: 2 },
  ])
  assert.deepEqual(notes.droppedListBlocks, [])
})

test('content after a code block in an item keeps its own kind', () => {
  const md = '6. step\n\n   ```bash\n   make gate\n   ```\n\n   - note a\n   - note b\n\n7. next\n'
  const blocks = blocksMod.parseBlocks(md, false, new blocksMod.ImportNotes())
  assert.deepEqual(blocks.map((b) => b.type), ['list', 'code', 'list', 'list'])
  assert.deepEqual(blocks[0], { type: 'list', ordered: true, items: [{ text: 'step' }], start: 6 })
  assert.deepEqual(blocks[2], { type: 'list', ordered: false, items: [{ text: 'note a' }, { text: 'note b' }] })
  assert.equal(blocks[3]!.start, 7)
})

test('ordered list keeps its start number', () => {
  assert.deepEqual(blocksMod.parseBlocks('3. three\n4. four\n', false, new blocksMod.ImportNotes()), [
    { type: 'list', ordered: true, items: [{ text: 'three' }, { text: 'four' }], start: 3 },
  ])
})

test('bullet children of a numbered item are recorded', () => {
  const blocks = blocksMod.parseBlocks('1. step\n   - note\n2. step two\n   1. sub\n', false, new blocksMod.ImportNotes())
  const items = blocks[0]!.items
  // differs from the parent: recorded. Same as the parent: omitted
  assert.deepEqual(items[0], { text: 'step', children: [{ text: 'note' }], childrenOrdered: false })
  assert.deepEqual(items[1], { text: 'step two', children: [{ text: 'sub' }] })
})

test('code block in a nested item is reported', () => {
  const notes = new blocksMod.ImportNotes()
  const blocks = blocksMod.parseBlocks('- top\n  - nested\n\n    ```\n    x\n    ```\n', false, notes)
  assert.deepEqual(blocks[0]!.items[0].children, [{ text: 'nested' }])
  assert.deepEqual(notes.droppedListBlocks, ['fence: x'])
})

test('children use their own list kind', () => {
  const item = { text: 'step', children: [{ text: 'note' }], childrenOrdered: false }
  const html = renderBlock(
    { type: 'list', ordered: true, items: [item, { text: 'b', children: [{ text: 'c' }] }] },
    null as unknown as RenderContext,
    'single',
  )
  assert.ok(html.startsWith('<ol '))
  assert.ok(html.endsWith('><li data-item="0">step<ul><li>note</li></ul></li><li data-item="1">b<ol><li>c</li></ol></li></ol>'))
})

test('childrenOrdered is validated', () => {
  const withItem = (item: unknown): any => doc([page({ blocks: [{ type: 'list', ordered: true, items: [item] }] })])
  validateContent(withItem({ text: 'a', children: [{ text: 'b' }], childrenOrdered: false }))
  assert.throws(() => validateContent(withItem({ text: 'a', childrenOrdered: false })), ContentError)
  assert.throws(() => validateContent(withItem({ text: 'a', children: [{ text: 'b' }], childrenOrdered: 'no' })), ContentError)
})
