// Layout JSON and CLI option merging. Layout values never live in the content.
// CLI options win over the layout file. Unknown keys are an error (no silent
// defaults).

import { readFileSync } from 'node:fs'
import { isObject, repr } from './py.ts'

export class LayoutError extends Error {}

type Kind = 'string' | 'string?' | 'boolean' | 'number' | 'object'

const LAYOUT_KEYS: Record<string, Kind> = {
  page: 'string',
  fontSize: 'string',
  fontFamily: 'string?',
  codeFontFamily: 'string?',
  embedFonts: 'boolean',
  titleScale: 'number',
  headerTitle: 'string',
  columns: 'string',
  figureSide: 'string',
  splitRatio: 'number',
  details: 'string',
  mermaidLib: 'string',
  mermaidVersion: 'string?',
  hrBreak: 'boolean',
  imageScale: 'number',
  embedImages: 'boolean',
  date: 'string?',
  css: 'string?',
  overrides: 'object',
}

export const PAGE_OVERRIDE_KEYS = new Set(['columns', 'figureSide', 'splitRatio'])
export const BLOCK_OVERRIDE_KEYS = new Set(['maxHeightRatio', 'span']) // span: 1 | 2 (two-column layout)

/** The only way diagrams are written: as SVG drawn by mermaid-arch. */
export const MERMAID_LIB = 'prerender'

export interface LayoutValues {
  page: string
  fontSize: string | null
  fontFamily: string | null // CSS font-family list for body text; null = base.css default stack
  codeFontFamily: string | null // same for code and inline code
  embedFonts: boolean // embed subsets of the vendored BIZ UD fonts used by the stacks
  titleScale: number
  headerTitle: string
  columns: string | null
  figureSide: string
  splitRatio: number
  details: string
  mermaidLib: string // always "prerender"; kept so documents say how their diagrams were written
  mermaidVersion: string | null // null = the Mermaid that mermaid-arch vendors; written as the effective one
  hrBreak: boolean
  imageScale: number
  embedImages: boolean
  date: string | null // null = today; "none" = hidden
  css: string | null
  overrides: Record<string, Record<string, unknown>>
}

export class Layout implements LayoutValues {
  page = 'a4'
  fontSize: string | null = null
  fontFamily: string | null = null
  codeFontFamily: string | null = null
  embedFonts = true
  titleScale = 1.25
  headerTitle = 'section'
  columns: string | null = null
  figureSide = 'right'
  splitRatio = 0.5
  details = 'drop'
  mermaidLib = MERMAID_LIB
  mermaidVersion: string | null = null
  hrBreak = false
  imageScale = 1.0
  embedImages = false
  date: string | null = null
  css: string | null = null
  overrides: Record<string, Record<string, unknown>> = {}

  pageOverride(pageId: string): Record<string, unknown> {
    const o = this.overrides[pageId] ?? {}
    return Object.fromEntries(Object.entries(o).filter(([k]) => PAGE_OVERRIDE_KEYS.has(k)))
  }

  blockOverride(blockId: string): Record<string, unknown> {
    const o = this.overrides[blockId] ?? {}
    return Object.fromEntries(Object.entries(o).filter(([k]) => BLOCK_OVERRIDE_KEYS.has(k)))
  }

  spanOverrides(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(this.overrides)) {
      if (isObject(v) && (v.span === 1 || v.span === 2)) out[k] = v.span
    }
    return out
  }
}

function typeOk(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'string': return typeof value === 'string'
    case 'string?': return typeof value === 'string' || value === null
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number'
    case 'object': return isObject(value)
  }
}

export function loadLayoutFile(path: string): Record<string, unknown> {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    throw new LayoutError(`layout file not found: ${path}`)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new LayoutError(`layout file is not valid JSON: ${path}: ${(e as Error).message}`)
  }
  if (!isObject(data)) throw new LayoutError(`layout file must be a JSON object: ${path}`)
  for (const [key, value] of Object.entries(data)) {
    const kind = LAYOUT_KEYS[key]
    if (kind === undefined) throw new LayoutError(`unknown layout key ${repr(key)} in ${path}`)
    if (!typeOk(kind, value)) throw new LayoutError(`layout key ${repr(key)} has wrong type in ${path}`)
  }
  validateOverrides((data.overrides ?? {}) as Record<string, unknown>, path)
  return data
}

function validateOverrides(overrides: Record<string, unknown>, path: string): void {
  for (const [target, values] of Object.entries(overrides)) {
    if (!isObject(values)) throw new LayoutError(`overrides[${repr(target)}] must be an object in ${path}`)
    for (const k of Object.keys(values)) {
      if (!PAGE_OVERRIDE_KEYS.has(k) && !BLOCK_OVERRIDE_KEYS.has(k)) {
        throw new LayoutError(`unknown override key ${repr(k)} for ${repr(target)} in ${path}`)
      }
    }
    if ('span' in values && values.span !== 1 && values.span !== 2) {
      throw new LayoutError(`override span for ${repr(target)} must be 1 or 2 in ${path}`)
    }
    if ('columns' in values && !['two', 'split', 'single'].includes(values.columns as string)) {
      throw new LayoutError(`override columns for ${repr(target)} must be two, split or single in ${path}`)
    }
  }
}

/** Merge, lowest priority first: `base` (layout embedded in an input document),
 * the layout file, then CLI values. CLI values that are undefined/null are ignored. */
export function buildLayout(
  layoutPath: string | null,
  cli: Partial<LayoutValues>,
  base: Record<string, unknown> | null,
  mermaidVersion: string,
): Layout {
  const layout = new Layout()
  const set = layout as unknown as Record<string, unknown>
  if (base) {
    for (const [key, value] of Object.entries(base)) {
      if (!(key in LAYOUT_KEYS)) throw new LayoutError(`unknown layout key ${repr(key)} in embedded layout`)
      set[key] = value
    }
  }
  if (layoutPath !== null) {
    for (const [key, value] of Object.entries(loadLayoutFile(layoutPath))) set[key] = value
  }
  for (const [key, value] of Object.entries(cli)) {
    if (value === undefined || value === null) continue
    if (!(key in LAYOUT_KEYS)) throw new LayoutError(`internal: unknown layout field ${repr(key)}`)
    set[key] = value
  }
  check(layout, mermaidVersion)
  return layout
}

/** The effective layout as layout-JSON keys (embedded into generated documents). */
export function layoutToDict(layout: Layout): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(LAYOUT_KEYS)) {
    const value = (layout as unknown as Record<string, unknown>)[key]
    if (key === 'overrides' && Object.keys(value as object).length === 0) continue
    out[key] = value
  }
  return out
}

function check(layout: Layout, mermaidVersion: string): void {
  if (!['section', 'doc'].includes(layout.headerTitle) && !layout.headerTitle.startsWith('fixed:')) {
    throw new LayoutError(`invalid header title mode ${repr(layout.headerTitle)}`)
  }
  if (!['drop', 'expand'].includes(layout.details)) {
    throw new LayoutError(`invalid details mode ${repr(layout.details)}`)
  }
  for (const [name, value] of [['fontFamily', layout.fontFamily], ['codeFontFamily', layout.codeFontFamily]] as const) {
    if (value !== null && (!value.trim() || /[<>{};]/.test(value))) {
      throw new LayoutError(
        `invalid ${name} ${repr(value)}: expected a CSS font-family list such as "'Noto Sans JP', sans-serif"`,
      )
    }
  }
  if (layout.mermaidLib !== MERMAID_LIB) {
    // embed / link put mermaid.min.js into the document; diagrams are now always drawn by
    // mermaid-arch at build time, so a document asking for them is stopped, not rewritten
    throw new LayoutError(
      `mermaidLib ${repr(layout.mermaidLib)} is no longer supported: diagrams are drawn by mermaid-arch ` +
        `and written into the document as SVG. Rebuild with --mermaid-lib ${MERMAID_LIB}`,
    )
  }
  if (layout.mermaidVersion !== null) {
    if (!/^\d+\.\d+\.\d+$/.test(layout.mermaidVersion)) {
      throw new LayoutError(`invalid mermaid version ${repr(layout.mermaidVersion)}: expected MAJOR.MINOR.PATCH`)
    }
    if (layout.mermaidVersion !== mermaidVersion) {
      throw new LayoutError(
        `this document was paginated with Mermaid ${layout.mermaidVersion}; this md2html draws diagrams with ` +
          `Mermaid ${mermaidVersion} (from mermaid-arch). Diagram sizes, and so the pages, may change. ` +
          `Rebuild with --mermaid-version ${mermaidVersion} to accept that (Mermaid ${mermaidVersion} lays out ` +
          `flowcharts with elk unless a diagram sets layout: dagre)`,
      )
    }
  }
  if (layout.imageScale <= 0) throw new LayoutError('image scale must be positive')
  if (layout.date !== null && layout.date !== 'none' && !/^\d{4}-\d{2}-\d{2}$/.test(layout.date)) {
    throw new LayoutError(`invalid date ${repr(layout.date)}: expected YYYY-MM-DD or none`)
  }
}
