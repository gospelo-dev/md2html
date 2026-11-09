// Gospelo Document envelope: embedding, escaping, head-only reading, rejection of other
// files (port of tests/test_embed.py).
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import {
  ContentError,
  DOC_SCRIPT_ID,
  defaultHtmlPath,
  embedJson,
  envelopeScript,
  extractFromHtml,
  loadDocument,
  makeEnvelope,
  makeSourcePage,
  MIGRATION_URL,
  readHead,
  saveDocument,
  SIGNATURE,
} from '../../skills/claude/gospelo-md2html/src/content.ts'
import { Layout, layoutToDict } from '../../skills/claude/gospelo-md2html/src/layout.ts'
import { layoutOf, tmp } from './helpers.ts'

const HEAD_CHUNK = 64 * 1024

function sampleDoc(): any {
  return {
    version: 1,
    meta: { title: 'T', date: '2026-09-20', source: 'a.md', lang: 'ja' },
    pages: [
      makeSourcePage('# T\n\n<script>x</script>\n'),
      {
        id: 'p01',
        kind: 'content',
        title: null,
        continued: false,
        blocks: [{ type: 'paragraph', text: 'a </script> b <b> & c' }],
        extras: { reviewed: true },
      },
    ],
  }
}

const wrap = (env: unknown, filler = ''): string =>
  '<!DOCTYPE html>\n' + SIGNATURE + '\n<html data-gospelo-document="1"><head>\n' + envelopeScript(env) + '\n<style>body{}</style></head><body>' + filler + '</body></html>'

test('embed escapes markup and round trips', () => {
  const doc = sampleDoc()
  const env = makeEnvelope(doc, { page: '16x9' })
  const text = embedJson(env)
  assert.ok(!text.includes('</script') && !text.includes('<') && !text.includes('>') && !text.includes('&'))
  assert.equal(env.format, 'gospelo-document')
  assert.equal(env.version, 1)
  assert.ok(env.generator.startsWith('gospelo-md2html'))
  const [got, layout] = extractFromHtml(wrap(env))
  assert.deepEqual(got.pages, doc.pages)
  assert.deepEqual(got.meta, doc.meta)
  assert.deepEqual(layout, { page: '16x9' })
})

test('layout round trip and CLI precedence', () => {
  const layout = Object.assign(new Layout(), { page: '16x9', fontSize: '14pt', overrides: { p05: { columns: 'single' } } })
  const [, got] = extractFromHtml(wrap(makeEnvelope(sampleDoc(), layoutToDict(layout))))
  const merged = layoutOf({ fontSize: '12pt', page: undefined }, got)
  assert.equal(merged.page, '16x9')
  assert.equal(merged.fontSize, '12pt')
  assert.deepEqual(merged.overrides, { p05: { columns: 'single' } })
})

test('readHead stops before the tail', () => {
  const env = makeEnvelope(sampleDoc(), { page: 'a4' })
  const path = join(tmp(), 'doc.gospelo.html')
  writeFileSync(path, wrap(env, '<!-- ' + 'x'.repeat(3 * HEAD_CHUNK) + ' -->'), 'utf-8')
  const head = readHead(path)
  assert.ok(head.endsWith('</script>') && head.length < HEAD_CHUNK && !head.includes('xxxx'))
  const [doc, layout] = loadDocument(path)
  assert.deepEqual(layout, { page: 'a4' })
  assert.equal(doc.pages[1]!.blocks[0]!.id, 'p01-b0')
})

test('readHead reads an envelope that crosses the first chunk', () => {
  const doc = sampleDoc()
  doc.pages[0].blocks[0].text = '# T\n\n' + '本文'.repeat(HEAD_CHUNK) // multi-byte text across chunk boundaries
  const path = join(tmp(), 'big.gospelo.html')
  writeFileSync(path, wrap(makeEnvelope(doc, { page: 'a4' })), 'utf-8')
  const [got] = loadDocument(path)
  assert.equal(got.pages[0]!.blocks[0]!.text, doc.pages[0].blocks[0].text)
})

test('sidecar JSON round trip', () => {
  const dir = tmp()
  const path = join(dir, 'doc.gospelo.json')
  saveDocument(sampleDoc(), { page: 'a3' }, path)
  const env = JSON.parse(readFileSync(path, 'utf-8'))
  assert.equal(env.format, 'gospelo-document')
  assert.deepEqual(env.layout, { page: 'a3' })
  const [doc, layout] = loadDocument(path)
  assert.equal(doc.meta.title, 'T')
  assert.deepEqual(layout, { page: 'a3' })
  assert.equal(basename(defaultHtmlPath(path)), 'doc.gospelo.html')
  assert.equal(basename(defaultHtmlPath(join(dir, 'notes.md'))), 'notes.gospelo.html')
})

test('legacy and foreign files are rejected with the migration URL', () => {
  const dir = tmp()
  const legacy = join(dir, 'old.html')
  writeFileSync(
    legacy,
    '<!DOCTYPE html>\n<html lang="ja" data-mermaid-font-size="12.6px"><head></head><body>' +
      '<script type="application/json" id="md2html-content">{}</script></body></html>',
  )
  assert.throws(() => loadDocument(legacy), (e: Error) => e instanceof ContentError && e.message.includes('earlier md2html release') && e.message.includes(MIGRATION_URL))
  assert.throws(() => extractFromHtml('<html><body>no envelope here</body></html>'), (e: Error) => e.message.includes(MIGRATION_URL))
  const bare = join(dir, 'content.json')
  writeFileSync(bare, JSON.stringify(sampleDoc()))
  assert.throws(() => loadDocument(bare), /not a Gospelo Document/)
})

test('unsupported version and unknown keys are rejected', () => {
  let env = makeEnvelope(sampleDoc(), {})
  env.version = 2
  assert.throws(() => extractFromHtml(wrap(env)), /unsupported/)
  env = makeEnvelope(sampleDoc(), {})
  env.pages[1].mystery = 1
  assert.throws(() => extractFromHtml(wrap(env)), /unknown key/)
  assert.equal(DOC_SCRIPT_ID, 'gospelo-document')
})
