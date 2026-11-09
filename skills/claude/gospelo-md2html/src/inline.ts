// Inline Markdown: rendering and line-level splitting.
//
// Text in the content stays inline Markdown. Splitting a paragraph at a
// measured line boundary works on the inline token stream: plain-text offsets
// (as the browser's textContent counts them, in UTF-16 units) are mapped back
// to tokens, open spans are closed/reopened, and both halves are re-serialised
// to Markdown. Unknown token types disable splitting (the caller then moves
// the whole paragraph).

import { inlineTokens, md } from './markdown.ts'
import { lstrip, rstrip } from './py.ts'

const ESCAPE_CHARS = '\\*_`[]<~'

/** The parts of a markdown-it token this module reads and writes. */
interface Tok {
  type: string
  content: string
  attrGet(name: string): string | number | null
}

export function renderInline(text: string): string {
  return md.renderInline(text)
}

/** The textContent the browser will produce for renderInline(text). */
export function plainText(text: string): string {
  let out = ''
  for (const tok of inlineTokens(text)) {
    if (tok.type === 'text' || tok.type === 'code_inline') out += tok.content
    else if (tok.type === 'softbreak') out += '\n'
  }
  return out
}

function escapeText(s: string): string {
  let out = ''
  for (const c of s) out += ESCAPE_CHARS.includes(c) ? '\\' + c : c
  return out
}

function longestRun(s: string, ch: string): number {
  let best = 0
  let run = 0
  for (const c of s) {
    if (c === ch) {
      run++
      if (run > best) best = run
    } else run = 0
  }
  return best
}

function serialize(tokens: Tok[]): string | null {
  let out = ''
  // markdown-it keeps href on link_open only; the Python version read it from link_close and
  // so wrote "[text]()" for every link in a split paragraph
  const hrefs: Array<string | number | null> = []
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text':
        out += escapeText(tok.content)
        break
      case 'code_inline': {
        const fence = '`'.repeat(longestRun(tok.content, '`') + 1)
        out += fence + tok.content + fence
        break
      }
      case 'strong_open':
      case 'strong_close':
        out += '**'
        break
      case 'em_open':
      case 'em_close':
        out += '*'
        break
      case 's_open':
      case 's_close':
        out += '~~'
        break
      case 'link_open':
        hrefs.push(tok.attrGet('href'))
        out += '['
        break
      case 'link_close': {
        const href = hrefs.length ? hrefs.pop() : tok.attrGet('href')
        out += `](${href ?? ''})`
        break
      }
      case 'image':
        out += `![${tok.content}](${tok.attrGet('src') ?? ''})`
        break
      case 'softbreak':
        out += ' '
        break
      case 'hardbreak':
        out += '  \n'
        break
      default:
        return null
    }
  }
  return out
}

const OPEN_TO_CLOSE: Record<string, string> = {
  strong_open: 'strong_close',
  em_open: 'em_close',
  s_open: 's_close',
  link_open: 'link_close',
}
const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE))

function simpleToken(type: string, content: string, href: string | number | null = null): Tok {
  return { type, content, attrGet: (name: string) => (name === 'href' ? href : null) }
}

/** Split inline Markdown so that the head holds the first `offset` plain
 * characters. Returns [head, tail] or null when splitting is not safe. */
export function splitInline(text: string, offset: number): [string, string] | null {
  const tokens: Tok[] = inlineTokens(text)
  let pos = 0
  let splitIdx: number | null = null
  let splitInToken = 0
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    const length = tok.type === 'text' || tok.type === 'code_inline' ? tok.content.length : tok.type === 'softbreak' ? 1 : 0
    if (pos + length >= offset && length > 0) {
      splitIdx = i
      splitInToken = offset - pos
      break
    }
    pos += length
  }
  if (splitIdx === null) return null
  const tok = tokens[splitIdx]!
  let headTokens: Tok[]
  let tailTokens: Tok[]
  if (tok.type === 'code_inline' || tok.type === 'softbreak') {
    // never split inside code; cut at the token boundary instead
    headTokens = tokens.slice(0, splitIdx)
    tailTokens = tok.type === 'softbreak' ? tokens.slice(splitIdx + 1) : tokens.slice(splitIdx)
  } else {
    const headText = rstrip(tok.content.slice(0, splitInToken))
    const tailText = lstrip(tok.content.slice(splitInToken))
    headTokens = [...tokens.slice(0, splitIdx), ...(headText ? [simpleToken('text', headText)] : [])]
    tailTokens = [...(tailText ? [simpleToken('text', tailText)] : []), ...tokens.slice(splitIdx + 1)]
  }
  // close open spans in head, reopen them in tail
  const stack: Tok[] = []
  for (const t of headTokens) {
    if (t.type in OPEN_TO_CLOSE) stack.push(t)
    else if (CLOSERS.has(t.type) && stack.length) stack.pop()
  }
  // a closing link needs the href of the link it closes
  const closers = [...stack].reverse().map((t) => simpleToken(OPEN_TO_CLOSE[t.type]!, '', t.attrGet('href')))
  let head = serialize([...headTokens, ...closers])
  let tail = serialize([...stack, ...tailTokens])
  if (head === null || tail === null) return null
  head = rstrip(head)
  tail = lstrip(tail)
  if (!head || !tail) return null
  return [head, tail]
}
