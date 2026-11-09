// End to end through the bundled CLI (scripts/md2html.mjs): import, build, restore,
// diagrams drawn by mermaid-arch in md2html's browser. Needs chrome-headless-shell
// (md2html setup installs it).
//
// The AWS icon test runs only when MD2HTML_TEST_ICONS_ZIP names an AWS icon package
// zip: the icons are not part of the repository.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { CLI, tmp } from './helpers.ts'

function md2html(...args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

const MD = `# Deck

## Diagram

\`\`\`mermaid
flowchart TB
  a[fa:fa-user Start] --> b[日本語のラベル]
  b --> c[End]
\`\`\`

A paragraph with a [link](https://example.com/).
`

test('import, build with PDF and PPTX, restore', () => {
  const dir = tmp()
  const md = join(dir, 'deck.md')
  writeFileSync(md, MD)
  const html = join(dir, 'deck.gospelo.html')
  let r = md2html('import', md, '--page', '16x9', '--date', '2026-01-01')
  assert.equal(r.code, 0, r.out)
  const text = readFileSync(html, 'utf-8')
  assert.ok(text.includes('<svg id="md2html-mermaid-1"'))
  assert.ok(!text.includes('<pre class="mermaid">'))
  assert.ok(text.includes('Font Awesome'))
  assert.match(text, /"mermaidVersion": "12\.\d+\.\d+"/)

  r = md2html('build', html, '--pdf', join(dir, 'deck.pdf'), '--pptx', join(dir, 'deck.pptx'))
  assert.equal(r.code, 0, r.out)
  assert.equal(readFileSync(join(dir, 'deck.pdf')).subarray(0, 5).toString(), '%PDF-')
  assert.match(r.out, /wrote .*deck\.pptx \(2 slides, 1 links\)/)

  r = md2html('restore', html, '-o', join(dir, 'back.md'))
  assert.equal(r.code, 0, r.out)
  assert.equal(readFileSync(join(dir, 'back.md'), 'utf-8'), MD)
})

test('code is highlighted at build time and Shiki is not shipped', () => {
  const dir = tmp()
  const md = join(dir, 'code.md')
  writeFileSync(md, '# C\n\n```json\n{"a": 1}\n```\n\n```bash\necho hi\n```\n')
  for (const cmd of [['import', md], ['build', join(dir, 'code.gospelo.html')]]) {
    const r = md2html(...cmd)
    assert.equal(r.code, 0, r.out)
    const text = readFileSync(join(dir, 'code.gospelo.html'), 'utf-8')
    assert.equal(text.match(/data-highlighted="true"/g)?.length, 2, cmd[0])
    assert.ok(!text.includes('data-shiki-version'), cmd[0])
  }
})

test('aws: icons without --icons-zip stop with the fix', () => {
  const dir = tmp()
  const md = join(dir, 'aws.md')
  writeFileSync(md, '# A\n\n```mermaid\nflowchart LR\n  fn@{ icon: "aws:lambda", label: "Handler" }\n```\n')
  const r = md2html('import', md)
  assert.equal(r.code, 1)
  assert.match(r.out, /no AWS icon zip was given/)
  assert.match(r.out, /--icons-zip/)
  assert.match(r.out, /diagram 1 = block b1/)
})

test('a document paginated with Mermaid 11 is stopped, and the suggested option rebuilds it', () => {
  const dir = tmp()
  const md = join(dir, 'd.md')
  writeFileSync(md, '# D\n\ntext\n')
  const html = join(dir, 'd.gospelo.html')
  assert.equal(md2html('import', md).code, 0)
  writeFileSync(html, readFileSync(html, 'utf-8').replace(/"mermaidVersion": "[^"]+"/, '"mermaidVersion": "11.12.2"'))
  const r = md2html('build', html)
  assert.equal(r.code, 1)
  const fix = /--mermaid-version (\S+)/.exec(r.out)
  assert.ok(fix, r.out)
  assert.equal(md2html('build', html, '--mermaid-version', fix[1]!).code, 0)
})

test('the ELK fixture draws every way of asking for ELK, and an unknown layout stops', () => {
  const dir = tmp()
  const html = join(dir, 'elk.gospelo.html')
  let r = md2html('import', join(import.meta.dirname, '..', 'fixtures', 'elk_flowchart.md'), '-o', html)
  assert.equal(r.code, 0, r.out)
  const text = readFileSync(html, 'utf-8')
  for (let n = 1; n <= 5; n++) assert.ok(text.includes(`<svg id="md2html-mermaid-${n}"`), `diagram ${n}`)
  const md = join(dir, 'bad.md')
  writeFileSync(md, '# B\n\n```mermaid\n---\nconfig:\n  layout: elk.bogus\n---\nflowchart TD\n  A --> B\n```\n')
  r = md2html('import', md)
  assert.equal(r.code, 1)
  assert.match(r.out, /asks for layout 'elk\.bogus'.*dagre instead/)
})

test('usage errors exit with 2', () => {
  const elk = md2html('setup', '--elk')
  assert.equal(elk.code, 2)
  assert.match(elk.out, /no longer needed: Mermaid 12 includes the ELK layout/)
  assert.equal(md2html('import').code, 2)
  assert.equal(md2html('build', 'x.html', '--page', 'b5').code, 2)
  assert.equal(md2html('nonsense').code, 2)
})

const ZIP = process.env.MD2HTML_TEST_ICONS_ZIP
test('aws: icons are drawn into the document, without the icon pack', { skip: ZIP ? false : 'set MD2HTML_TEST_ICONS_ZIP' }, () => {
  const dir = tmp()
  const md = join(dir, 'aws.md')
  writeFileSync(md, '# A\n\n```mermaid\nflowchart LR\n  fn@{ icon: "aws:lambda", form: "square", label: "Handler" }\n  db@{ icon: "aws:dynamodb", form: "square", label: "Table" }\n  fn --> db\n```\n')
  const r = md2html('import', md, '--icons-zip', ZIP!)
  assert.equal(r.code, 0, r.out)
  const text = readFileSync(join(dir, 'aws.gospelo.html'), 'utf-8')
  assert.ok(text.includes('md2html-mermaid-1-icon-'))
  assert.ok(!text.includes('"prefix":"aws"') && !text.includes('"prefix": "aws"'))
})
