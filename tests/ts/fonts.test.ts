// Custom font stacks and the embedded BIZ UD font subsets (port of tests/test_fonts.py).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { baseCss } from '../../skills/claude/gospelo-md2html/src/assets.ts'
import * as fonts from '../../skills/claude/gospelo-md2html/src/fonts.ts'
import { Layout, LayoutError, layoutToDict } from '../../skills/claude/gospelo-md2html/src/layout.ts'
import { renderDocument } from '../../skills/claude/gospelo-md2html/src/render.ts'
import { ctxFor, layoutOf, sampleDoc } from './helpers.ts'

function render(layout: Layout, fontCss = ''): string {
  const [doc, page] = sampleDoc()
  return renderDocument(doc, [page], ctxFor(layout, { fontCss }), null)
}

test('base.css uses variables with default stacks', () => {
  const css = baseCss()
  assert.ok(css.includes('var(--font-family, -apple-system'))
  assert.ok(css.includes("var(--code-font-family, 'SFMono-Regular'"))
  assert.ok(css.includes(`var(--font-family, ${fonts.DEFAULT_BODY_STACK})`))
  assert.ok(css.includes(`var(--code-font-family, ${fonts.DEFAULT_CODE_STACK})`))
})

test('default layout emits no font override', () => {
  const html = render(layoutOf({ page: 'a4' }))
  assert.ok(!html.includes('--font-family:') && !html.includes('--code-font-family:'))
})

test('custom fonts are emitted and recorded', () => {
  const layout = layoutOf({ fontFamily: "'Noto Sans JP', sans-serif", codeFontFamily: "'JetBrains Mono', monospace" })
  const html = render(layout)
  assert.ok(html.includes("--font-family: 'Noto Sans JP', sans-serif;"))
  assert.ok(html.includes("--code-font-family: 'JetBrains Mono', monospace;"))
  const d = layoutToDict(layout)
  assert.equal(d.fontFamily, "'Noto Sans JP', sans-serif")
  assert.equal(d.codeFontFamily, "'JetBrains Mono', monospace")
  assert.equal(layoutOf({ fontFamily: null }, d).fontFamily, "'Noto Sans JP', sans-serif")
})

test('font family rejects markup', () => {
  assert.throws(() => layoutOf({ fontFamily: 'x</style><script>' }), LayoutError)
  assert.throws(() => layoutOf({ codeFontFamily: '   ' }), LayoutError)
})

test('vendored fonts exist with license', () => {
  for (const f of ['BIZUDPGothic-Regular.woff2', 'BIZUDPGothic-Bold.woff2', 'BIZUDGothic-Regular.woff2', 'BIZUDGothic-Bold.woff2']) {
    assert.ok(existsSync(join(fonts.FONT_DIR, f)), f)
  }
  assert.ok(readFileSync(join(fonts.FONT_DIR, 'OFL.txt'), 'utf-8').includes('SIL OPEN FONT LICENSE'))
})

test('faces follow the stacks', () => {
  const faces = (body: string | null, code: string | null) =>
    fonts.facesToEmbed(body, code).map(([f, roles]) => [f.family, f.weight, roles])
  assert.deepEqual(faces(null, null), [
    ['BIZ UDPGothic', 400, ['body']],
    ['BIZ UDPGothic', 700, ['bold']],
    ['BIZ UDGothic', 400, ['code']],
  ])
  assert.deepEqual(faces("'BIZ UDGothic', sans-serif", null), [
    ['BIZ UDGothic', 400, ['body', 'code']],
    ['BIZ UDGothic', 700, ['bold']],
  ])
  assert.deepEqual(faces("'Noto Sans JP', sans-serif", 'Menlo, monospace'), [])
})

test('subset is a small woff2 that grows with the text', async () => {
  const layout = layoutOf()
  const small = await fonts.fontFaceCss({ body: '日本語 abc', bold: '', code: '' }, layout.fontFamily, layout.codeFontFamily)
  const large = await fonts.fontFaceCss({ body: '日本語 abc' + '英語漢字仮名混在文章'.repeat(5), bold: '', code: '' }, null, null)
  const first = (css: string) => Buffer.from(/base64,([^)]+)\)/.exec(css)![1]!, 'base64')
  assert.equal(first(small).subarray(0, 4).toString('latin1'), 'wOF2')
  assert.ok(first(small).length < 20_000)
  assert.ok(first(large).length > first(small).length)
})

test('character sets route text to the faces that render it', () => {
  const blocks = [
    { type: 'heading', level: 2, text: '見出し' },
    { type: 'paragraph', text: '本文 **強調** `コード`' },
    { type: 'table', header: ['列'], rows: [['値']] },
    { type: 'list', ordered: false, items: [{ text: '項', children: [{ text: '子' }] }] },
    { type: 'code', lang: null, lines: ["print('挨拶')"] },
    { type: 'mermaid', source: 'graph LR; A[図]-->B' },
  ]
  const sets = fonts.characterSets(blocks, ['題'], '固定')
  for (const ch of '見出し本文強調列値項子図題固定続き0123456789/') assert.ok(sets.body.includes(ch), ch)
  for (const ch of '見出し強調列題固定続き') assert.ok(sets.bold.includes(ch), ch)
  for (const ch of '本文値項子') assert.ok(!sets.bold.includes(ch), ch)
  for (const ch of "コード挨拶print(')続き") assert.ok(sets.code.includes(ch), ch)
  assert.ok(!sets.code.includes('見') && !sets.body.includes('コ'))
})

test('font face is embedded and measured with', async () => {
  const layout = layoutOf({ page: 'a4' })
  const [, page] = sampleDoc([{ id: 'p01-b0', type: 'paragraph', text: '埋め込み' }])
  const css = await fonts.embeddedFontCss(page.blocks, ['T'], layout)
  assert.equal(css.match(/@font-face/g)!.length, 3)
  assert.ok(css.includes("font-family: 'BIZ UDPGothic'; font-weight: 700"))
  assert.ok(css.includes("font-family: 'BIZ UDGothic'; font-weight: 400"))
  assert.ok(css.includes('url(data:font/woff2;base64,'))
  const html = render(layout, css)
  assert.ok(html.indexOf('@font-face') < html.indexOf('--page-w:'))
  assert.ok(html.indexOf('--page-w:') < html.indexOf('</style>'))
  assert.ok(!render(layout, '').includes('@font-face'))
})

test('embedFonts off emits nothing', async () => {
  const [, page] = sampleDoc()
  const layout = layoutOf({ embedFonts: false })
  assert.equal(await fonts.embeddedFontCss(page.blocks, [], layout), '')
  assert.equal(layoutToDict(layout).embedFonts, false)
  const other = layoutOf({ fontFamily: 'Arial, sans-serif', codeFontFamily: 'Menlo, monospace' })
  assert.equal(await fonts.embeddedFontCss(page.blocks, [], other), '')
})
