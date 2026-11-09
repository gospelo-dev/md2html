// Page layout written in the Markdown, per section.
//
// A heading followed directly by
//
//   <!-- layout: columns=single split-ratio=0.4 gutter=2em figure-side=left -->
//
// lays out that heading's section (up to the next heading of the same or a higher
// level) with those settings. They are the page-level layout overrides (columns,
// splitRatio, gutter, figureSide). A page never mixes two layouts: where the layout
// changes, a new page starts. After pagination the settings are recorded as the
// overrides of the pages the section produced, so `build` keeps them.

import { LAYOUT_COMMENT_RE, type Block } from './blocks.ts'
import { LayoutError, validateOverrides } from './layout.ts'
import { repr, strip } from './py.ts'

export type PageSettings = Record<string, unknown>

/** Comment key -> layout override key. */
const KEYS: Record<string, string> = {
  columns: 'columns',
  'split-ratio': 'splitRatio',
  gutter: 'gutter',
  'figure-side': 'figureSide',
}

/** The settings of a `<!-- layout: ... -->` comment body ("columns=single gutter=2em"). */
export function parseLayoutComment(body: string, where: string): PageSettings {
  const settings: PageSettings = {}
  const words = strip(body).split(/\s+/).filter(Boolean)
  if (!words.length) throw new LayoutError(`${where}: the layout comment sets nothing (expected e.g. columns=single)`)
  for (const word of words) {
    const m = /^([a-z-]+)=(\S+)$/.exec(word)
    if (!m) throw new LayoutError(`${where}: ${repr(word)} in the layout comment is not key=value`)
    const key = KEYS[m[1]!]
    if (key === undefined) {
      throw new LayoutError(`${where}: unknown key ${repr(m[1])} in the layout comment (expected ${Object.keys(KEYS).join(', ')})`)
    }
    if (key in settings) throw new LayoutError(`${where}: ${repr(m[1])} is set twice in the layout comment`)
    settings[key] = key === 'splitRatio' ? Number(m[2]) : m[2]
  }
  validateOverrides({ [where]: settings }, 'the Markdown')
  return settings
}

/** Remove the layout markers from `blocks` and give every remaining block the settings of
 * the innermost section that holds it (null: the document's layout). A marker must come
 * right after a heading; anything else is an error, as is a layout comment written
 * inside a paragraph (where it would be ignored). */
export function sectionSettings(blocks: Block[]): { blocks: Block[]; settings: Array<PageSettings | null> } {
  const out: Block[] = []
  const settings: Array<PageSettings | null> = []
  // open sections, outermost first
  const open: Array<{ level: number; settings: PageSettings }> = []
  let lastWasMarker = false
  for (const b of blocks) {
    if (b.type === 'layout') {
      const prev = out[out.length - 1]
      if (!prev || prev.type !== 'heading' || lastWasMarker) {
        const after = lastWasMarker ? 'another layout comment' : prev ? `a ${prev.type} block` : 'the start of the document'
        throw new LayoutError(`a layout comment must come right after a heading, one per heading (found after ${after})`)
      }
      // the heading itself belongs to the section it opens
      const s = parseLayoutComment(b.settings as string, `heading ${repr(prev.text)}`)
      open.push({ level: prev.level as number, settings: s })
      settings[settings.length - 1] = s
      lastWasMarker = true
      continue
    }
    lastWasMarker = false
    if (b.type === 'heading') {
      while (open.length && open[open.length - 1]!.level >= (b.level as number)) open.pop()
    }
    if ((b.type === 'paragraph' || b.type === 'quote') && /<!--\s*layout:/.test(b.text as string)) {
      throw new LayoutError(
        `a layout comment inside a paragraph is ignored by Markdown; put it on its own line right after a heading: ${repr((b.text as string).slice(0, 60))}`,
      )
    }
    out.push(b)
    settings.push(open.length ? open[open.length - 1]!.settings : null)
  }
  return { blocks: out, settings }
}

export function settingsKey(s: PageSettings | null): string {
  if (s === null) return ''
  return JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]))
}

/** Consecutive blocks with the same settings, in order. */
export function runs(blocks: Block[], settings: Array<PageSettings | null>): Array<{ blocks: Block[]; settings: PageSettings | null }> {
  const out: Array<{ blocks: Block[]; settings: PageSettings | null }> = []
  blocks.forEach((b, i) => {
    const s = settings[i] ?? null
    const last = out[out.length - 1]
    if (last && settingsKey(last.settings) === settingsKey(s)) last.blocks.push(b)
    else out.push({ blocks: [b], settings: s })
  })
  return out
}

/** Page ids as md2html writes them (p05, p05-2); other override keys are block ids. */
export const PAGE_ID_RE = /^p\d+(?:-\d+)*$/

/** The overrides with page-level entries moved to the pages' new ids (`pageIds`: old ->
 * new). Page entries for ids that no longer exist are dropped, so they cannot land on
 * another page that now has that id; block entries are kept. */
export function remapPageOverrides(
  overrides: Record<string, Record<string, unknown>>,
  pageIds: Map<string, string>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (!PAGE_ID_RE.test(key)) out[key] = value
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!PAGE_ID_RE.test(key)) continue
    const to = pageIds.get(key)
    if (to !== undefined) out[to] = { ...(out[to] ?? {}), ...value }
  }
  return out
}
