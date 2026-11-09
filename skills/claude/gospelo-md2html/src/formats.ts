// Page format definitions (references/page_formats.md). All dimensions are in
// millimetres. Top and bottom margins are always equal.

export const MM_TO_PX = 96.0 / 25.4 // Chromium: 1mm = 3.7795px
export const PT_TO_PX = 96.0 / 72.0

export type Columns = 'two' | 'split' | 'single'

export interface PageFormat {
  id: string
  widthMm: number
  heightMm: number
  marginVMm: number
  marginHMm: number
  defaultFontPt: number
  isSlide: boolean
  /** "two" (left column, then right) | "split" (figure + text) | "single" */
  defaultColumns: Columns
}

function fmt(id: string, w: number, h: number, mv: number, mh: number, pt: number, slide: boolean, cols: Columns): PageFormat {
  return { id, widthMm: w, heightMm: h, marginVMm: mv, marginHMm: mh, defaultFontPt: pt, isSlide: slide, defaultColumns: cols }
}

export const FORMATS: Record<string, PageFormat> = {
  a4: fmt('a4', 210.0, 297.0, 18.0, 18.0, 11.0, false, 'single'),
  'a4-landscape': fmt('a4-landscape', 297.0, 210.0, 16.0, 20.0, 11.0, false, 'two'),
  a3: fmt('a3', 297.0, 420.0, 22.0, 22.0, 12.0, false, 'single'),
  'a3-landscape': fmt('a3-landscape', 420.0, 297.0, 20.0, 24.0, 12.0, false, 'two'),
  '16x9': fmt('16x9', 338.6667, 190.5, 10.0, 12.0, 14.0, true, 'two'),
  '4x3': fmt('4x3', 254.0, 190.5, 10.0, 12.0, 14.0, true, 'two'),
}

export const PAGE_IDS = Object.keys(FORMATS)

export function getFormat(pageId: string): PageFormat {
  const f = FORMATS[pageId]
  if (!f) {
    throw new RangeError(`unknown page format: '${pageId}' (expected one of ${PAGE_IDS.join(', ')})`)
  }
  return f
}
