// PPTX assembly, no browser: slide size, one picture per page, link hotspots,
// transparent text layer (port of tests/test_pptx.py; the XML is read directly).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { assemblePptx, type PptxOptions, type SlideData } from '../../skills/claude/gospelo-md2html/src/pptx.ts'
import { SKILL, tmp } from './helpers.ts'

// the npm packages are installed in the skill, not at the repository root
const { strFromU8, unzipSync } = createRequire(join(SKILL, 'package.json'))('fflate') as typeof import('fflate')

// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')

const slides = (): SlideData[] => [
  {
    id: 'p01',
    image: PNG,
    imageFormat: 'png',
    links: [{ href: 'https://example.com/?a=1&b=2', rect: [0.1, 0.2, 0.3, 0.05] }],
    lines: [{ text: 'Hello <&>', size: 0.03, rect: [0.1, 0.1, 0.2, 0.04] }],
  },
  { id: 'p02', image: PNG, imageFormat: 'png', links: [], lines: [] },
]

const opts = (o: Partial<PptxOptions>): PptxOptions => ({ dpi: 200, imageFormat: 'png', jpegQuality: 92, textLayer: false, linkHotspots: true, ...o })

function files(path: string): Record<string, string> {
  const z = unzipSync(readFileSync(path))
  return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, k.endsWith('.png') ? '' : strFromU8(v)]))
}

test('deck has one picture per page and the page size', () => {
  const out = join(tmp(), 'deck.pptx')
  const counts = assemblePptx(slides(), 338.6667, 190.5, out, opts({ linkHotspots: true, textLayer: false }))
  assert.deepEqual(counts, { slides: 2, links: 1, textLines: 0 })
  const f = files(out)
  assert.ok(Object.keys(f)[0] === '[Content_Types].xml')
  assert.ok(f['ppt/presentation.xml']!.includes(`<p:sldSz cx="${Math.round(338.6667 * 36000)}" cy="${Math.round(190.5 * 36000)}"/>`))
  assert.equal(f['ppt/presentation.xml']!.match(/<p:sldId /g)!.length, 2)
  const s1 = f['ppt/slides/slide1.xml']!
  assert.equal(s1.match(/<p:pic>/g)!.length, 1)
  assert.ok(s1.includes(`<a:ext cx="${Math.round(338.6667 * 36000)}" cy="${Math.round(190.5 * 36000)}"/>`))
  assert.ok(s1.includes('<a:hlinkClick r:id="rId3"/>'))
  assert.ok(s1.includes(`<a:off x="${Math.trunc(0.1 * Math.round(338.6667 * 36000))}"`))
  const rels = f['ppt/slides/_rels/slide1.xml.rels']!
  assert.ok(rels.includes('Target="https://example.com/?a=1&amp;b=2" TargetMode="External"'))
  assert.ok(f['[Content_Types].xml']!.includes('<Default Extension="png" ContentType="image/png"/>'))
})

test('text layer is transparent and not proofed', () => {
  const out = join(tmp(), 'deck.pptx')
  const counts = assemblePptx(slides(), 210, 297, out, opts({ textLayer: true, linkHotspots: false }))
  assert.equal(counts.textLines, 1)
  assert.equal(counts.links, 0)
  const s1 = files(out)['ppt/slides/slide1.xml']!
  assert.ok(s1.includes('<a:t>Hello &lt;&amp;&gt;</a:t>'))
  assert.ok(s1.includes('noProof="1"'))
  assert.ok(s1.includes('<a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr>'))
  // 0.03 of a 297mm page is about 25pt
  const sz = Number(/sz="(\d+)"/.exec(s1)![1])
  assert.ok(Math.abs(sz / 100 - (0.03 * 297 * 72) / 25.4) < 0.5)
})
