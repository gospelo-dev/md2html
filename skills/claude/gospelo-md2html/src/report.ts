// Report output: stdout summary and --report JSON.

import { writeFileSync } from 'node:fs'
import { fixed, jsonDumps, pyRound } from './py.ts'
import type { Metrics } from './scale.ts'

export interface VerifyPage {
  id: string
  mode: string
  contentHeightPx: number
  usedPx: number
  overflowPx: number
  figureOverflowPx: number
  titleTruncated: boolean
  blocks: Array<Record<string, any>>
  figure: Record<string, any> | null
}

export type SpillEntry = { from: string; to: string; blocks: string[] }

export function buildReport(
  metrics: Metrics,
  columns: string,
  verify: VerifyPage[],
  spills: SpillEntry[],
  warnings: string[],
  notes?: Record<string, unknown> | null,
): Record<string, any> {
  const pages = verify.map((p) => {
    const remaining = Math.max(0, p.contentHeightPx - p.usedPx)
    const entry: Record<string, any> = {
      id: p.id,
      layoutMode: p.mode,
      usedPx: p.usedPx,
      remainingPx: remaining,
      remainingLines: Math.floor(remaining / metrics.linePx),
      overflowPx: p.overflowPx,
      figure: p.figure ?? null,
      blocks: p.blocks,
      warnings: [] as string[],
    }
    if (p.titleTruncated) entry.warnings.push('header title truncated')
    if (p.figureOverflowPx) entry.warnings.push(`figure column overflows by ${p.figureOverflowPx}px`)
    const fig = p.figure
    if (fig && fig.scale !== undefined && fig.scale !== null && fig.scale < 0.5) {
      entry.warnings.push(`figure ${fig.id} scaled to ${fixed(fig.scale, 2)}; text may be too small`)
    }
    for (const b of p.blocks) {
      if (b.scale !== undefined && b.scale !== null && b.scale < 0.5) {
        entry.warnings.push(`figure ${b.id} scaled to ${fixed(b.scale, 2)}; text may be too small`)
      }
    }
    return entry
  })
  const report: Record<string, any> = {
    layout: {
      page: metrics.fmt.id,
      fontSizePx: pyRound(metrics.F, 2),
      columns,
      contentHeightPx: pyRound(metrics.contentHPx),
      contentWidthPx: pyRound(metrics.contentWPx),
      textColumnWidthPx: columns === 'split' ? pyRound(metrics.textColPx) : pyRound(metrics.contentWPx),
      lineHeightPx: pyRound(metrics.linePx, 2),
    },
    pageCount: pages.length,
    pages,
    spills,
    warnings,
  }
  if (notes) report.import = notes
  return report
}

export function writeReport(report: unknown, path: string): void {
  writeFileSync(path, jsonDumps(report) + '\n', 'utf-8')
}

const padEnd = (s: string, n: number): string => s.padEnd(n)
const padStart = (s: string | number, n: number): string => String(s).padStart(n)

export function printSummary(report: Record<string, any>, label: string): void {
  const lay = report.layout
  console.log(`[${label}] ${lay.page} font ${lay.fontSizePx}px columns=${lay.columns} pages=${report.pageCount}`)
  for (const p of report.pages) {
    let line =
      `  ${padEnd(p.id, 8)} ${padEnd(p.layoutMode, 12)} used ${padStart(p.usedPx, 5)}px  ` +
      `remaining ${padStart(p.remainingPx, 5)}px (${p.remainingLines} lines)`
    if (p.overflowPx) line += `  OVERFLOW ${p.overflowPx}px`
    console.log(line)
    for (const w of p.warnings) console.log(`           warning: ${w}`)
  }
  for (const s of report.spills) console.log(`  spill: ${s.from} -> ${s.to} blocks=${s.blocks.join(',')}`)
  for (const w of report.warnings) console.log(`  warning: ${w}`)
  const imp = report.import
  if (imp) {
    for (const [k, v] of Object.entries(imp)) {
      const empty = v === 0 || (Array.isArray(v) && v.length === 0)
      if (!empty) console.log(`  import ${k}: ${Array.isArray(v) ? pyList(v as string[]) : v}`)
    }
  }
}

/** Python's str() of a list of strings, as the Python version printed it. */
function pyList(items: string[]): string {
  return '[' + items.map((s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ') + ']'
}
