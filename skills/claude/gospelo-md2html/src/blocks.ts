// Markdown -> block list.
//
// Pre-processing on the raw text handles <details> (Mermaid rescue first, then
// drop/expand) and the pagebreak comment. markdown-it then yields a token
// stream that is folded into top-level blocks matching the content schema.

import { md, type Token } from './markdown.ts'
import { rstrip, strip } from './py.ts'

export type Block = Record<string, any> & { type: string }
export type Item = { text: string; children?: Item[]; childrenOrdered?: boolean }

const DETAILS_RE = /<details>([\s\S]*?)<\/details>[ \t]*\n?/gi
const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i
const MERMAID_FENCE_RE = /^```mermaid[^\n]*\n([\s\S]*?)\n```\s*$/
const DIAGRAM_IMG_RE = /(?:^|\n)!\[[^\]]*\]\(([^)]+)\)[ \t]*\n\s*$/
const PAGEBREAK = '<!-- pagebreak -->'

export class ImportNotes {
  droppedDetails: string[] = []
  expandedDetails = 0
  rescuedMermaid = 0
  discardedImages: string[] = []
  htmlBlocks = 0
  ignoredHr = 0
  /** blocks (code, table, quote ...) inside a nested list item: a nested item cannot hold them */
  droppedListBlocks: string[] = []

  toDict(): Record<string, unknown> {
    return {
      droppedDetails: this.droppedDetails,
      expandedDetails: this.expandedDetails,
      rescuedMermaid: this.rescuedMermaid,
      discardedImages: this.discardedImages,
      htmlBlocks: this.htmlBlocks,
      ignoredHr: this.ignoredHr,
      droppedListBlocks: this.droppedListBlocks,
    }
  }
}

export function preprocessMarkdown(text: string, detailsMode: string, notes: ImportNotes): string {
  const repl = (inner0: string): string => {
    let inner = inner0
    let summary = ''
    const sm = SUMMARY_RE.exec(inner)
    if (sm) {
      summary = strip(sm[1]!)
      inner = inner.slice(0, sm.index) + inner.slice(sm.index + sm[0].length)
    }
    const stripped = strip(inner)
    const fm = MERMAID_FENCE_RE.exec(stripped)
    if (fm) {
      notes.rescuedMermaid += 1
      return '\n```mermaid\n' + fm[1] + '\n```\n'
    }
    if (detailsMode === 'drop') {
      notes.droppedDetails.push([...stripped].slice(0, 40).join('').replace(/\n/g, ' '))
      return '\n'
    }
    notes.expandedDetails += 1
    const head = summary ? `\n#### ${summary}\n\n` : '\n'
    return head + stripped + '\n'
  }

  const out: string[] = []
  let last = 0
  for (const m of text.matchAll(DETAILS_RE)) {
    let before = text.slice(last, m.index)
    const replacement = repl(m[1]!)
    if (replacement.startsWith('\n```mermaid')) {
      // a rendered PNG right before the fold is the same diagram: discard it
      const im = DIAGRAM_IMG_RE.exec(before)
      if (im) {
        notes.discardedImages.push(im[1]!)
        before = before.slice(0, im.index) + '\n'
      }
    }
    out.push(before, replacement)
    last = m.index! + m[0].length
  }
  out.push(text.slice(last))
  return out.join('')
}

// --------------------------------------------------------------------------
// token folding

export function parseBlocks(text: string, hrBreak: boolean, notes: ImportNotes): Block[] {
  return fold(md.parse(text, {}), hrBreak, notes)
}

function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean)
}

function fold(tokens: Token[], hrBreak: boolean, notes: ImportNotes): Block[] {
  const blocks: Block[] = []
  let i = 0
  const n = tokens.length
  while (i < n) {
    const tok = tokens[i]!
    const t = tok.type
    if (t === 'heading_open') {
      const inline = tokens[i + 1]!
      blocks.push({ type: 'heading', level: parseInt(tok.tag[1]!, 10), text: strip(inline.content) })
      i += 3
    } else if (t === 'paragraph_open') {
      blocks.push(paragraphBlock(tokens[i + 1]!))
      i += 3
    } else if (t === 'bullet_list_open' || t === 'ordered_list_open') {
      const j = findClose(tokens, i)
      blocks.push(...listBlocks(tokens.slice(i, j + 1), hrBreak, notes))
      i = j + 1
    } else if (t === 'table_open') {
      const j = findClose(tokens, i)
      blocks.push(tableBlock(tokens.slice(i, j + 1)))
      i = j + 1
    } else if (t === 'fence') {
      const info = strip(tok.info || '')
      const first = words(info)[0]
      if (first === 'mermaid') {
        blocks.push({ type: 'mermaid', source: rstrip(tok.content, '\n') })
      } else {
        blocks.push({ type: 'code', lang: info ? first! : null, lines: rstrip(tok.content, '\n').split('\n') })
      }
      i += 1
    } else if (t === 'code_block') {
      blocks.push({ type: 'code', lang: null, lines: rstrip(tok.content, '\n').split('\n') })
      i += 1
    } else if (t === 'blockquote_open') {
      const j = findClose(tokens, i)
      const parts = tokens.slice(i, j).filter((tk) => tk.type === 'inline').map((tk) => strip(tk.content))
      blocks.push({ type: 'quote', text: parts.join('\n\n') })
      i = j + 1
    } else if (t === 'html_block') {
      const content = strip(tok.content)
      if (content === PAGEBREAK) {
        blocks.push({ type: 'pagebreak' })
      } else {
        notes.htmlBlocks += 1
        blocks.push({ type: 'html', html: content })
      }
      i += 1
    } else if (t === 'hr') {
      if (hrBreak) blocks.push({ type: 'pagebreak' })
      else notes.ignoredHr += 1
      i += 1
    } else {
      i += 1
    }
  }
  return blocks
}

function findClose(tokens: Token[], i: number): number {
  let depth = 0
  for (let j = i; j < tokens.length; j++) {
    depth += tokens[j]!.nesting
    if (depth === 0) return j
  }
  throw new RangeError('unbalanced token stream')
}

function paragraphBlock(inline: Token): Block {
  const children = inline.children ?? []
  const meaningful = children.filter((c) => !(c.type === 'text' && !strip(c.content)))
  if (meaningful.length === 1 && meaningful[0]!.type === 'image') {
    const img = meaningful[0]!
    return { type: 'image', src: String(img.attrGet('src') ?? ''), alt: img.content || '' }
  }
  return { type: 'paragraph', text: strip(inline.content) }
}

// Block-level content a list item cannot hold: an item keeps inline text and nested lists only.
const ITEM_BREAKERS = new Set(['fence', 'code_block', 'table_open', 'blockquote_open', 'html_block', 'hr', 'heading_open'])
const LIST_OPENS = new Set(['bullet_list_open', 'ordered_list_open'])

/** Fold a top-level list. A code block, table, quote or other block inside an item ends
 * the list at that item: the item's text stays in the list, the item's remaining content
 * follows as top-level blocks, and the next items continue in a new list that keeps the
 * numbering. Dropping such content would lose commands written under numbered steps. */
function listBlocks(tokens: Token[], hrBreak: boolean, notes: ImportNotes): Block[] {
  const ordered = tokens[0]!.type === 'ordered_list_open'
  let start = ordered ? listStart(tokens[0]!) : 1
  const out: Block[] = []
  let current: Item[] = []
  for (const inner of itemSpans(tokens.slice(1, -1))) {
    const [item, rest] = itemOf(inner, ordered, false, notes)
    current.push(item)
    if (rest.length) {
      out.push(list(ordered, current, start))
      start += current.length
      current = []
      out.push(...fold(rest, hrBreak, notes))
    }
  }
  if (current.length) out.push(list(ordered, current, start))
  return out
}

function list(ordered: boolean, items: Item[], start: number): Block {
  const block: Block = { type: 'list', ordered, items }
  if (ordered && start !== 1) block.start = start
  return block
}

function listStart(tok: Token): number {
  const value = tok.attrGet('start')
  return value !== null ? parseInt(String(value), 10) : 1
}

function* itemSpans(tokens: Token[]): Generator<Token[]> {
  let i = 0
  while (i < tokens.length) {
    if (tokens[i]!.type !== 'list_item_open') {
      i += 1
      continue
    }
    const j = findClose(tokens, i)
    yield tokens.slice(i + 1, j)
    i = j + 1
  }
}

/** [item, rest]. `rest` is the token run from the first block the item cannot hold to
 * the end of the item (top-level items only; empty when there is none). */
function itemOf(inner: Token[], parentOrdered: boolean, nested: boolean, notes: ImportNotes): [Item, Token[]] {
  const texts: string[] = []
  const children: Item[] = []
  let childrenOrdered: boolean | null = null
  let rest: Token[] = []
  let k = 0
  while (k < inner.length) {
    const tk = inner[k]!
    if (ITEM_BREAKERS.has(tk.type)) {
      if (!nested) {
        rest = inner.slice(k)
        break
      }
      // a nested item has no place to put the block: report it instead of losing it silently
      const end = tk.nesting === 1 ? findClose(inner, k) : k
      notes.droppedListBlocks.push(describe(inner.slice(k, end + 1)))
      k = end + 1
    } else if (tk.type === 'paragraph_open') {
      texts.push(strip(inner[k + 1]!.content))
      k += 3
    } else if (LIST_OPENS.has(tk.type)) {
      const m = findClose(inner, k)
      const subOrdered = tk.type === 'ordered_list_open'
      if (childrenOrdered === null) childrenOrdered = subOrdered
      children.push(...nestedItems(inner.slice(k + 1, m), subOrdered, notes))
      k = m + 1
    } else if (tk.type === 'inline') {
      texts.push(strip(tk.content))
      k += 1
    } else {
      k += 1
    }
  }
  const item: Item = { text: texts.join(' ') }
  if (children.length) {
    item.children = children
    if (childrenOrdered !== parentOrdered) item.childrenOrdered = childrenOrdered!
  }
  return [item, rest]
}

function nestedItems(tokens: Token[], ordered: boolean, notes: ImportNotes): Item[] {
  return [...itemSpans(tokens)].map((inner) => itemOf(inner, ordered, true, notes)[0])
}

function describe(tokens: Token[]): string {
  const tk = tokens[0]!
  const text = tk.content || (tokens.find((t) => t.type === 'inline')?.content ?? '')
  const kind = tk.type.endsWith('_open') ? tk.type.slice(0, -'_open'.length) : tk.type
  return `${kind}: ${[...strip(text)].slice(0, 40).join('')}`.replace(/\n/g, ' ')
}

function tableBlock(tokens: Token[]): Block {
  let header: string[] = []
  const align: string[] = []
  const rows: string[][] = []
  let inHead = false
  let row: string[] | null = null
  for (const tk of tokens) {
    if (tk.type === 'thead_open') inHead = true
    else if (tk.type === 'thead_close') inHead = false
    else if (tk.type === 'tr_open') row = []
    else if (tk.type === 'tr_close') {
      if (inHead) header = row ?? []
      else rows.push(row ?? [])
      row = null
    } else if (tk.type === 'th_open' || tk.type === 'td_open') {
      if (inHead) align.push(alignFromStyle(String(tk.attrGet('style') ?? '')))
    } else if (tk.type === 'inline' && row !== null) {
      row.push(strip(tk.content))
    }
  }
  const block: Block = { type: 'table', header, rows }
  if (align.some((a) => a !== 'left')) block.align = align
  return block
}

function alignFromStyle(style: string): string {
  for (const a of ['center', 'right']) if (style.includes(a)) return a
  return 'left'
}

export function docTitleFromBlocks(blocks: Block[], fallback: string): string {
  for (const b of blocks) if (b.type === 'heading' && b.level === 1) return b.text
  return fallback
}
