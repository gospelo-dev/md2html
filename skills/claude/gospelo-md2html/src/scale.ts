// Typography scale and derived page metrics. Everything derives from the body
// font size F (px) and the page format. The only mm values that survive into
// CSS are the paper size and margins.

import { MM_TO_PX, PT_TO_PX, type Columns, type PageFormat } from './formats.ts'
import { fixed, pyFloat, pyRound, repr } from './py.ts'

const SIZE_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|px|mm)\s*$/

export const TITLE_BAND_FACTOR = 2.0 // header band = title size x 2.0
export const FOOTER_MAX_BODY_RATIO = 0.75 // footer <= 0.75 F
export const FOOTER_MAX_MARGIN_RATIO = 0.36 // footer <= 0.36 M
export const SAFETY = 0.98 // fill pages up to 98% (measured heights)
export const IMAGE_RATIO_SINGLE = 0.6 // figure height cap in single-column pages
export const IMAGE_RATIO_SPLIT = 1.0 // figure column: full height available

/** The font size in CSS px. Accepts pt, px, mm. Throws on anything else. */
export function parseFontSize(value: string): number {
  const m = SIZE_RE.exec(value)
  if (!m) throw new RangeError(`invalid --font-size ${repr(value)}: expected e.g. 11pt, 14px, 3.5mm`)
  const num = parseFloat(m[1]!)
  const unit = m[2]
  if (num <= 0) throw new RangeError(`invalid --font-size ${repr(value)}: must be positive`)
  if (unit === 'pt') return num * PT_TO_PX
  if (unit === 'mm') return num * MM_TO_PX
  return num
}

/** The gap between columns when none is given: 2 x the body font size (it was 1.5 x
 * before 0.8). Generated documents record the gutter they used (layout.gutter). */
export const DEFAULT_GUTTER = '2em'
/** The widest gap allowed, as a fraction of the content width. */
export const MAX_GUTTER_RATIO = 0.2

const GUTTER_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(em|px|mm|pt)\s*$/

/** A column gap in CSS px for body font size F. Accepts em (x F), px, mm, pt. */
export function parseGutter(value: string, F: number): number {
  const m = GUTTER_RE.exec(value)
  if (!m) throw new RangeError(`invalid gutter ${repr(value)}: expected e.g. 2.5em, 40px, 10mm, 30pt`)
  const num = parseFloat(m[1]!)
  switch (m[2]) {
    case 'em':
      return num * F
    case 'mm':
      return num * MM_TO_PX
    case 'pt':
      return num * PT_TO_PX
    default:
      return num
  }
}

export type FigureMode = 'split' | 'col' | 'single'

export class Metrics {
  readonly fmt: PageFormat
  readonly F: number // body font px
  readonly titleScale: number
  readonly columns: Columns // document default
  readonly figureSide: 'left' | 'right'
  readonly splitRatio: number // text column fraction
  readonly gutterPx: number // gap between columns (split and two)

  constructor(
    fmt: PageFormat,
    F: number,
    titleScale: number,
    columns: Columns,
    figureSide: 'left' | 'right',
    splitRatio: number,
    gutterPx: number,
  ) {
    this.fmt = fmt
    this.F = F
    this.titleScale = titleScale
    this.columns = columns
    this.figureSide = figureSide
    this.splitRatio = splitRatio
    this.gutterPx = gutterPx
  }

  // ---- paper
  get pageWPx(): number { return this.fmt.widthMm * MM_TO_PX }
  get pageHPx(): number { return this.fmt.heightMm * MM_TO_PX }
  get marginVPx(): number { return this.fmt.marginVMm * MM_TO_PX }
  get marginHPx(): number { return this.fmt.marginHMm * MM_TO_PX }

  // ---- typography
  get lineHeight(): number { return this.fmt.isSlide ? 1.5 : 1.6 }
  get linePx(): number { return this.F * this.lineHeight }
  get titleSizePx(): number { return this.F * this.titleScale }
  get headerBandPx(): number { return this.fmt.isSlide ? this.titleSizePx * TITLE_BAND_FACTOR : 0.0 }
  get headerGapPx(): number { return this.fmt.isSlide ? this.F : 0.0 }
  get footerSizePx(): number {
    return Math.min(FOOTER_MAX_BODY_RATIO * this.F, FOOTER_MAX_MARGIN_RATIO * this.marginVPx)
  }
  get footerBandPx(): number { return this.marginVPx }
  get tableScale(): number { return this.fmt.isSlide ? 0.85 : 0.9 }
  get codeScale(): number {
    // half-width columns need the small size; full-width code on portrait paper stays readable
    return this.columns === 'two' ? 0.6 : 0.85
  }

  // ---- content box
  get contentWPx(): number { return this.pageWPx - 2 * this.marginHPx }
  get contentHPx(): number {
    return this.pageHPx - this.marginVPx - this.footerBandPx - this.headerBandPx - this.headerGapPx
  }
  get textColPx(): number { return (this.contentWPx - this.gutterPx) * this.splitRatio }
  get figureColPx(): number { return (this.contentWPx - this.gutterPx) * (1.0 - this.splitRatio) }
  /** Width of one column in the two-column layout (left, then right). */
  get col2Px(): number { return (this.contentWPx - this.gutterPx) / 2.0 }

  /** [W, H, r] for figure sizing in the given page mode. */
  figureBox(mode: FigureMode, ratioOverride?: number | null): [number, number, number] {
    // a figure that fills a column must still fit the pagination capacity (content height x SAFETY)
    const usableH = this.contentHPx * SAFETY - 1.0
    if (mode === 'split') return [this.figureColPx, usableH, IMAGE_RATIO_SPLIT]
    if (mode === 'col') return [this.col2Px, usableH, IMAGE_RATIO_SPLIT]
    const r = ratioOverride === undefined || ratioOverride === null ? IMAGE_RATIO_SINGLE : ratioOverride
    return [this.contentWPx, this.contentHPx, r]
  }

  /** These metrics with a page's own split ratio and gutter (layout overrides). */
  withColumns(splitRatio: number, gutterPx: number): Metrics {
    return new Metrics(this.fmt, this.F, this.titleScale, this.columns, this.figureSide, splitRatio, gutterPx)
  }

  /** Whether the column widths differ from `other` (so text must be measured again). */
  sameColumns(other: Metrics): boolean {
    return this.splitRatio === other.splitRatio && this.gutterPx === other.gutterPx
  }

  /** The column variables a page sets on its own <section> when they differ from the document's. */
  columnVars(): string {
    const textFr = pyRound(this.splitRatio * 2, 3)
    const figureFr = pyRound((1.0 - this.splitRatio) * 2, 3)
    return `--gutter: ${fixed(this.gutterPx, 3)}px; --text-fr: ${pyFloat(textFr)}fr; --figure-fr: ${pyFloat(figureFr)}fr;`
  }

  cssVars(): string {
    const f = this.fmt
    const textFr = pyRound(this.splitRatio * 2, 3)
    const figureFr = pyRound((1.0 - this.splitRatio) * 2, 3)
    const lines = [
      `--page-w: ${pyFloat(f.widthMm)}mm;`,
      `--page-h: ${pyFloat(f.heightMm)}mm;`,
      `--margin-v: ${pyFloat(f.marginVMm)}mm;`,
      `--margin-h: ${pyFloat(f.marginHMm)}mm;`,
      `--font-size: ${fixed(this.F, 3)}px;`,
      `--line-height: ${pyFloat(this.lineHeight)};`,
      `--title-size: ${fixed(this.titleSizePx, 3)}px;`,
      `--header-band: ${fixed(this.headerBandPx, 3)}px;`,
      `--header-gap: ${fixed(this.headerGapPx, 3)}px;`,
      `--footer-size: ${fixed(this.footerSizePx, 3)}px;`,
      `--footer-band: ${fixed(this.footerBandPx, 3)}px;`,
      `--content-w: ${fixed(this.contentWPx, 3)}px;`,
      `--content-h: ${fixed(this.contentHPx, 3)}px;`,
      `--gutter: ${fixed(this.gutterPx, 3)}px;`,
      `--text-fr: ${pyFloat(textFr)}fr;`,
      `--figure-fr: ${pyFloat(figureFr)}fr;`,
      `--table-scale: ${pyFloat(this.tableScale)};`,
      `--code-scale: ${pyFloat(this.codeScale)};`,
    ]
    return ':root {\n  ' + lines.join('\n  ') + '\n}\n'
  }
}

export function buildMetrics(
  fmt: PageFormat,
  fontSize: string | null,
  titleScale: number,
  columns: string | null,
  figureSide: string,
  splitRatio: number,
  gutter: string | null = null,
): Metrics {
  const F = fontSize ? parseFontSize(fontSize) : fmt.defaultFontPt * PT_TO_PX
  const cols = columns ?? fmt.defaultColumns
  if (cols !== 'two' && cols !== 'split' && cols !== 'single') {
    throw new RangeError(`invalid columns ${repr(cols)}: expected two, split or single`)
  }
  if (figureSide !== 'left' && figureSide !== 'right') {
    throw new RangeError(`invalid figure side ${repr(figureSide)}: expected left or right`)
  }
  checkSplitRatio(splitRatio)
  if (titleScale <= 0) throw new RangeError(`invalid title scale ${titleScale}`)
  const m = new Metrics(fmt, F, titleScale, cols, figureSide, splitRatio, 0)
  return m.withColumns(splitRatio, checkedGutter(gutter ?? DEFAULT_GUTTER, F, m.contentWPx))
}

export function checkSplitRatio(splitRatio: number): void {
  if (!(splitRatio >= 0.4 && splitRatio <= 0.6)) {
    throw new RangeError(`invalid split ratio ${splitRatio}: expected 0.4 to 0.6`)
  }
}

/** The gutter in px, or an error when it is negative or wider than MAX_GUTTER_RATIO of the content. */
export function checkedGutter(value: string, F: number, contentWPx: number): number {
  const px = parseGutter(value, F)
  const max = contentWPx * MAX_GUTTER_RATIO
  if (px > max) {
    throw new RangeError(
      `invalid gutter ${repr(value)}: ${fixed(px, 1)}px is wider than ${MAX_GUTTER_RATIO * 100}% of the content width ` +
        `(${fixed(max, 1)}px of ${fixed(contentWPx, 1)}px)`,
    )
  }
  return px
}
