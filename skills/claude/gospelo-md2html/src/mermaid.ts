// Mermaid diagrams, drawn by mermaid-arch as SVG.
//
// md2html does not run Mermaid itself. Every ```mermaid block, with or without
// AWS icons, is drawn by mermaid-arch in its own page of md2html's browser, and
// the SVG is written into the measurement pages and the document. The AWS icon
// pack mermaid-arch builds from the user's zip never leaves mermaid-arch: only
// the drawn SVG reaches md2html (AWS permits the icons as part of diagrams).
//
// The page mermaid-arch draws in gets the same fonts as the document (the
// embedded BIZ UD subsets, and Font Awesome for fa: labels), so the label sizes
// Mermaid measures there hold in the document.

import { BuildError, createRenderer, type Renderer } from '@gospelo/mermaid-arch'
import { mermaidVersion } from './assets.ts'
import type { Block } from './blocks.ts'
import { DEFAULT_BODY_STACK } from './fonts.ts'
import type { Layout } from './layout.ts'
import type { Browser } from './measure.ts'
import { mermaidFontSize } from './render.ts'
import type { Metrics } from './scale.ts'

/** Element id of the n-th diagram of a document: `${ID_PREFIX}-${n}`. */
export const ID_PREFIX = 'md2html-mermaid'

/** A mermaid-arch error with the md2html blocks its "diagram N" refers to. */
export class DiagramError extends Error {
  override readonly cause: BuildError
  readonly blockIds: string[]

  constructor(cause: BuildError, blockIds: string[]) {
    super(cause.message)
    this.cause = cause
    this.blockIds = blockIds
  }

  text(): string {
    const map = this.blockIds.map((id, i) => `  diagram ${i + 1} = block ${id}`).join('\n')
    return `${this.cause.text()}\nDiagrams are the document's mermaid blocks, in order:\n${map}`
  }
}

// --------------------------------------------------------------------------
// layout names
//
// Mermaid draws a diagram that asks for a layout it does not have with dagre and
// only logs a warning. md2html does not fall back: a diagram that names an
// unknown layout stops the build before anything is drawn.

/** The layouts Mermaid 12.3.0 registers (dagre, swimlane, cose-bilkent, and ELK,
 * which Mermaid 12 bundles). tests/ts/mermaid.test.ts checks this list against the
 * installed mermaid.min.js, so a Mermaid update that changes it fails the tests. */
export const MERMAID_LAYOUTS = [
  'dagre',
  'swimlane',
  'cose-bilkent',
  'elk',
  'elk.stress',
  'elk.force',
  'elk.mrtree',
  'elk.sporeOverlap',
  'elk.box',
  'elk.rectpacking',
] as const

const FRONT_MATTER_RE = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const DIRECTIVE_RE = /%%\{([\s\S]*?)\}%%/g
const LAYOUT_KEY_RE = /["']?\b(layout|defaultRenderer)["']?\s*:\s*["']?([\w.-]+)/g
const FLOWCHART_ELK_RE = /^\s*flowchart-elk\b/m

/** The layout names a diagram asks for, in its front matter, %%{init}%% directives, or
 * as `flowchart-elk`. Labels and other text are not read, so a node named
 * "layout: x" is not mistaken for a request. */
export function requestedLayouts(source: string): string[] {
  const parts: string[] = []
  const fm = FRONT_MATTER_RE.exec(source)
  if (fm) parts.push(fm[1]!)
  for (const m of source.matchAll(DIRECTIVE_RE)) parts.push(m[1]!)
  const names: string[] = []
  for (const part of parts) for (const m of part.matchAll(LAYOUT_KEY_RE)) names.push(m[2]!)
  const body = fm ? source.slice(fm[0].length) : source
  if (FLOWCHART_ELK_RE.test(body.replace(DIRECTIVE_RE, ''))) names.push('elk')
  return names
}

export class LayoutRequestError extends Error {}

/** Stop when a diagram names a layout Mermaid does not have (it would be drawn with dagre). */
export function checkLayouts(blocks: Block[], mermaidVersion: string): void {
  const known = new Set<string>(MERMAID_LAYOUTS)
  const bad: string[] = []
  for (const b of blocks) {
    if (b.type !== 'mermaid') continue
    for (const name of requestedLayouts(b.source as string)) {
      if (!known.has(name)) bad.push(`block ${b.id} asks for layout '${name}'`)
    }
  }
  if (bad.length) {
    throw new LayoutRequestError(
      `${bad.join('; ')}, which Mermaid ${mermaidVersion} does not have; Mermaid would draw it with dagre instead. ` +
        `Use one of: ${MERMAID_LAYOUTS.join(', ')}`,
    )
  }
}

// --------------------------------------------------------------------------

export interface DiagramOptions {
  iconsZip: string | null
  /** @font-face rules for the drawing page (the document's embedded font subsets). */
  fontCss: string
  /** Whether any diagram has fa: icons in its labels. */
  fontAwesome: boolean
}

export class Diagrams {
  private renderer: Renderer | null = null
  /** source -> SVGs drawn for its occurrences, in document order */
  private drawn = new Map<string, string[]>()

  private readonly browser: Browser
  private readonly options: DiagramOptions
  private readonly metrics: Metrics
  private readonly layout: Layout

  constructor(browser: Browser, options: DiagramOptions, metrics: Metrics, layout: Layout) {
    this.browser = browser
    this.options = options
    this.metrics = metrics
    this.layout = layout
  }

  /** The SVG for every mermaid block of `blocks` (block id -> SVG). `blocks` are in
   * document order; the n-th mermaid block is drawn with id md2html-mermaid-n. A
   * diagram is drawn again only when the set of diagrams changed. */
  async svgsFor(blocks: Block[]): Promise<Map<string, string>> {
    const mermaid = blocks.filter((b) => b.type === 'mermaid')
    const out = new Map<string, string>()
    if (!mermaid.length) return out
    const needed = new Map<string, number>()
    for (const b of mermaid) needed.set(b.source, (needed.get(b.source) ?? 0) + 1)
    const sameSet =
      needed.size === this.drawn.size && [...needed].every(([src, n]) => (this.drawn.get(src)?.length ?? -1) === n)
    if (!sameSet) await this.draw(mermaid)
    const used = new Map<string, number>()
    for (const b of mermaid) {
      const k = used.get(b.source) ?? 0
      used.set(b.source, k + 1)
      out.set(b.id, this.drawn.get(b.source)![k]!)
    }
    return out
  }

  private async draw(mermaid: Block[]): Promise<void> {
    if (this.renderer === null) {
      this.renderer = createRenderer({
        browser: this.browser.browser,
        iconsZip: this.options.iconsZip,
        css: this.options.fontCss,
        fontAwesome: this.options.fontAwesome,
      })
    }
    checkLayouts(mermaid, mermaidVersion())
    let images
    try {
      ;({ images } = await this.renderer.render(
        mermaid.map((b) => b.source as string),
        { formats: ['svg'], idPrefix: ID_PREFIX, mermaidConfig: this.mermaidConfig() },
      ))
    } catch (e) {
      if (e instanceof BuildError) throw new DiagramError(e, mermaid.map((b) => b.id))
      throw e
    }
    this.drawn = new Map()
    mermaid.forEach((b, i) => {
      const svg = images[i]?.svg
      if (svg === undefined) throw new Error(`internal: mermaid-arch returned no SVG for block ${b.id}`)
      const list = this.drawn.get(b.source) ?? []
      list.push(svg)
      this.drawn.set(b.source, list)
    })
  }

  /** The look the Python version gave Mermaid in the page (theme "base", the body font
   * at 90% of the body size). The font list goes here, not into a diagram's
   * %%{init}%%: Mermaid drops a fontFamily with commas or quotes from there. */
  private mermaidConfig(): Record<string, unknown> {
    return {
      theme: 'base',
      securityLevel: 'loose',
      themeVariables: {
        fontSize: mermaidFontSize(this.metrics),
        fontFamily: this.layout.fontFamily || DEFAULT_BODY_STACK,
      },
    }
  }

  async close(): Promise<void> {
    if (this.renderer !== null) await this.renderer.close()
    this.renderer = null
  }
}
