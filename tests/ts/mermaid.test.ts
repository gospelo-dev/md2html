// Diagrams drawn by mermaid-arch: the layout only allows prerender and the Mermaid
// version mermaid-arch draws with, and the drawn SVG is what the document gets
// (replaces tests/test_prerender.py and tests/test_mermaid_vendor.py).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mermaidVersion } from '../../skills/claude/gospelo-md2html/src/assets.ts'
import { Layout, LayoutError, layoutToDict } from '../../skills/claude/gospelo-md2html/src/layout.ts'
import { effectiveLayout, RenderError, renderDocument } from '../../skills/claude/gospelo-md2html/src/render.ts'
import { ctxFor, layoutOf, sampleDoc } from './helpers.ts'

const SRC = 'flowchart LR\n  A --> B'
const blocks = [
  { id: 'p01-b0', type: 'paragraph', text: 'x' },
  { id: 'p01-b1', type: 'mermaid', source: SRC },
]

test('Mermaid comes from mermaid-arch', () => {
  assert.match(mermaidVersion(), /^12\.\d+\.\d+$/)
})

test('prerender is the only mode', () => {
  assert.equal(new Layout().mermaidLib, 'prerender')
  assert.throws(() => layoutOf({ mermaidLib: 'embed' }), (e: Error) => e instanceof LayoutError && e.message.includes('--mermaid-lib prerender'))
  assert.throws(() => layoutOf({}, { mermaidLib: 'link' }), LayoutError)
  // the command-line value wins over a document's, so the suggested option fixes the document
  assert.equal(layoutOf({ mermaidLib: 'prerender' }, { mermaidLib: 'embed' }).mermaidLib, 'prerender')
})

test('a document paginated with another Mermaid stops with the option that accepts the change', () => {
  const v = mermaidVersion()
  assert.throws(
    () => layoutOf({}, { mermaidVersion: '11.12.2' }),
    (e: Error) => e instanceof LayoutError && e.message.includes('Mermaid 11.12.2') && e.message.includes(`--mermaid-version ${v}`),
  )
  assert.equal(layoutOf({ mermaidVersion: v }, { mermaidVersion: '11.12.2' }).mermaidVersion, v)
  assert.throws(() => layoutOf({ mermaidVersion: 'latest' }), LayoutError)
})

test('the effective layout records the version and the mode', () => {
  const eff = effectiveLayout(layoutOf())
  assert.equal(eff.mermaidVersion, mermaidVersion())
  assert.equal(eff.mermaidLib, 'prerender')
  assert.equal(layoutToDict(layoutOf()).mermaidVersion, null)
})

test('the drawn SVG replaces the source; no library is written', () => {
  const [doc, page] = sampleDoc(blocks)
  const svg = '<svg id="md2html-mermaid-1" viewBox="0 0 100 50" width="100" height="50"><g/></svg>'
  const html = renderDocument(doc, [page], ctxFor(layoutOf({ page: 'a4' }), { svgs: new Map([['p01-b1', svg]]) }), null)
  assert.ok(html.includes(svg))
  assert.ok(!html.includes('<pre class="mermaid">'))
  assert.ok(!html.includes('data-mermaid-version="') && !html.includes('mermaid.min.js'))
  assert.ok(html.includes(`"mermaidVersion": "${mermaidVersion()}"`))
  assert.ok(html.includes('flowchart LR')) // the source stays in the envelope
})

test('a diagram without a drawing is an error, not a placeholder', () => {
  const [doc, page] = sampleDoc(blocks)
  assert.throws(() => renderDocument(doc, [page], ctxFor(layoutOf()), null), RenderError)
})

test('Font Awesome is added only for fa: labels', () => {
  const [doc, page] = sampleDoc([{ id: 'p01-b0', type: 'mermaid', source: 'flowchart LR\n  a[fa:fa-user U]' }])
  const svg = '<svg id="md2html-mermaid-1" viewBox="0 0 10 10"></svg>'
  const html = renderDocument(doc, [page], ctxFor(layoutOf(), { svgs: new Map([['p01-b0', svg]]) }), null)
  assert.ok(html.includes('Font Awesome'))
  const [doc2, page2] = sampleDoc(blocks)
  const html2 = renderDocument(doc2, [page2], ctxFor(layoutOf(), { svgs: new Map([['p01-b1', svg]]) }), null)
  assert.ok(!html2.includes('Font Awesome'))
})
