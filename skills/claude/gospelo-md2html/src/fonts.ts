// Embedded web fonts: subsets of the vendored BIZ UD fonts covering the
// characters a document uses, written as @font-face data URIs into the
// document head (and into the page mermaid-arch draws diagrams in).
//
// Why: the same glyphs then render identically on every machine (viewer and
// builder alike, so pagination is reproducible), and Chromium embeds the glyf
// TrueType subsets into the PDF at a few hundred KB. Only the vendored families
// that appear in the effective font stacks are embedded; a custom --font-family
// that names another font is not embedded (it must exist on the viewer's machine).
//
// Each face is subset to the characters that can actually reach it: the regular
// body face gets every character, the bold body face only what base.css renders
// bold (headings, table headers, strong spans, page titles), and a family named
// in the code stack gets only what code blocks and inline code contain. A family
// in the code stack is embedded at weight 400 only; bold code is synthesised.
//
// The Python version subset with fontTools; this one uses harfbuzz (subset-font).
// The glyphs and their advances are the same, so text measures the same; the
// woff2 bytes differ.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import subsetFont from 'subset-font'
import { AssetError, VENDOR } from './assets.ts'
import type { Block, Item } from './blocks.ts'
import type { Layout } from './layout.ts'
import { inlineTokens } from './markdown.ts'

export const FONT_DIR = join(VENDOR, 'fonts', 'bizud')

// base.css keeps the same lists as its var() fallbacks (tests assert they match)
export const DEFAULT_BODY_STACK =
  "-apple-system, 'Helvetica Neue', 'BIZ UDPGothic', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif"
export const DEFAULT_CODE_STACK = "'SFMono-Regular', Menlo, 'BIZ UDGothic', 'Noto Sans Mono CJK JP', monospace"

// characters the chrome (header, footer, continuation notes) can show whatever the content
const ALWAYS = '0123456789 /()（続き）.-:'
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('')

type Role = 'body' | 'bold' | 'code'

interface VendoredFont {
  family: string
  weight: number
  file: string
}

const VENDORED: VendoredFont[] = [
  { family: 'BIZ UDPGothic', weight: 400, file: 'BIZUDPGothic-Regular.woff2' },
  { family: 'BIZ UDPGothic', weight: 700, file: 'BIZUDPGothic-Bold.woff2' },
  { family: 'BIZ UDGothic', weight: 400, file: 'BIZUDGothic-Regular.woff2' },
  { family: 'BIZ UDGothic', weight: 700, file: 'BIZUDGothic-Bold.woff2' },
]

// --------------------------------------------------------------------------
// which characters reach which face

/** [kind, text] runs of an inline-Markdown string: kind is body, bold or code. */
export function inlineRuns(text: string): Array<[Role, string]> {
  const runs: Array<[Role, string]> = []
  let strong = 0
  for (const tok of inlineTokens(text)) {
    if (tok.type === 'strong_open') strong++
    else if (tok.type === 'strong_close') strong--
    else if (tok.type === 'code_inline') runs.push(['code', tok.content])
    else if (tok.type === 'text') runs.push([strong ? 'bold' : 'body', tok.content])
    else if (tok.type === 'html_inline') {
      runs.push(['body', tok.content])
      runs.push(['bold', tok.content])
    }
  }
  return runs
}

/** Text per face role for a document: body (everything), bold, code. */
export function characterSets(blocks: Iterable<Block>, titles: Iterable<string>, extra = ''): Record<Role, string> {
  // code gets ALWAYS too: a split code block carries its "(続き)" note inside <pre class="code">
  const parts: Record<Role, string[]> = { body: [ALWAYS, extra], bold: [ALWAYS, extra], code: [ASCII, ALWAYS] }
  const inline = (text: string, bold = false): void => {
    for (const [kind, s] of inlineRuns(text)) parts[bold && kind === 'body' ? 'bold' : kind].push(s)
  }
  const items = (lst: Item[]): void => {
    for (const it of lst) {
      inline(it.text)
      if (it.children?.length) items(it.children)
    }
  }
  for (const t of titles) parts.bold.push(t)
  for (const b of blocks) {
    const t = b.type
    if (t === 'heading') inline(b.text, true)
    else if (t === 'paragraph' || t === 'quote') inline(b.text)
    else if (t === 'list') items(b.items)
    else if (t === 'table') {
      for (const h of b.header) inline(h, true)
      for (const row of b.rows) for (const c of row) inline(c)
    } else if (t === 'code') parts.code.push(b.lines.join('\n'))
    else if (t === 'mermaid') {
      // diagram labels use the body font; some diagram types set labels bold
      parts.body.push(b.source)
      parts.bold.push(b.source)
    } else if (t === 'image') inline(b.caption || b.alt)
    else if (t === 'html' || t === 'markdown') {
      const raw = b.html || b.text || ''
      for (const k of Object.keys(parts) as Role[]) parts[k].push(raw)
    }
  }
  const body = parts.body.join('') + parts.bold.join('') // the regular face covers bold text too
  return { body, bold: parts.bold.join(''), code: parts.code.join('') }
}

// --------------------------------------------------------------------------
// subsetting and CSS

/** [face, roles] pairs: a family in the body stack gets 400 for body text and 700 for
 * bold text; a family in the code stack gets 400 for code text. Roles merge when both apply. */
export function facesToEmbed(fontFamily: string | null, codeFontFamily: string | null): Array<[VendoredFont, Role[]]> {
  const bodyStack = fontFamily || DEFAULT_BODY_STACK
  const codeStack = codeFontFamily || DEFAULT_CODE_STACK
  const out: Array<[VendoredFont, Role[]]> = []
  for (const f of VENDORED) {
    const roles: Role[] = []
    if (bodyStack.includes(f.family)) roles.push(f.weight === 400 ? 'body' : 'bold')
    if (codeStack.includes(f.family) && f.weight === 400) roles.push('code')
    if (roles.length) out.push([f, roles])
  }
  return out
}

// every name record is kept, as fontTools did with name_IDs=["*"]
const ALL_NAME_IDS = Array.from({ length: 256 }, (_, i) => i)

async function subsetWoff2(path: string, text: string): Promise<Buffer> {
  if (!existsSync(path)) throw new AssetError(`required asset is missing: ${path}`)
  return subsetFont(readFileSync(path), text, {
    targetFormat: 'woff2',
    noHinting: true,
    preserveNameIds: ALL_NAME_IDS,
    // BIZ UD carries a 'meta' table the Python version dropped; drop it here too
    dropTables: ['meta'],
  })
}

/** @font-face rules (data URIs) for the vendored faces the stacks use, each subset to its roles' text. */
export async function fontFaceCss(
  texts: Record<Role, string>,
  fontFamily: string | null,
  codeFontFamily: string | null,
): Promise<string> {
  const rules: string[] = []
  for (const [f, roles] of facesToEmbed(fontFamily, codeFontFamily)) {
    const text = roles.map((r) => texts[r]).join('')
    const data = (await subsetWoff2(join(FONT_DIR, f.file), text)).toString('base64')
    rules.push(
      `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: normal; ` +
        `font-display: block; src: url(data:font/woff2;base64,${data}) format('woff2'); }`,
    )
  }
  return rules.join('\n') + (rules.length ? '\n' : '')
}

/** The CSS to put in the head, or '' when embedding is off or no vendored family is in the stacks. */
export async function embeddedFontCss(blocks: Iterable<Block>, titles: Iterable<string>, layout: Layout, extra = ''): Promise<string> {
  if (!layout.embedFonts) return ''
  if (!facesToEmbed(layout.fontFamily, layout.codeFontFamily).length) return ''
  return fontFaceCss(characterSets(blocks, titles, extra), layout.fontFamily, layout.codeFontFamily)
}
