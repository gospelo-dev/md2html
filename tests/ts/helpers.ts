// Shared helpers for the TS tests.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mermaidVersion } from '../../skills/claude/gospelo-md2html/src/assets.ts'
import { makeSourcePage } from '../../skills/claude/gospelo-md2html/src/content.ts'
import { getFormat } from '../../skills/claude/gospelo-md2html/src/formats.ts'
import { buildLayout, type Layout, type LayoutValues } from '../../skills/claude/gospelo-md2html/src/layout.ts'
import type { RenderContext } from '../../skills/claude/gospelo-md2html/src/render.ts'
import { buildMetrics } from '../../skills/claude/gospelo-md2html/src/scale.ts'

export const SKILL = join(import.meta.dirname, '..', '..', 'skills', 'claude', 'gospelo-md2html')
export const CLI = join(SKILL, 'scripts', 'md2html.mjs')

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'md2html-test-'))
}

export function layoutOf(cli: Partial<LayoutValues> = {}, base: Record<string, unknown> | null = null): Layout {
  return buildLayout(null, cli, base, mermaidVersion())
}

export function ctxFor(layout: Layout, opts: Partial<RenderContext> = {}): RenderContext {
  const metrics = buildMetrics(getFormat(layout.page), layout.fontSize, layout.titleScale, layout.columns, layout.figureSide, layout.splitRatio)
  return {
    metrics,
    layout,
    imageBase: '.',
    htmlDir: tmp(),
    embedImages: false,
    svgs: new Map(),
    codeHtml: null,
    fontCss: '',
    ...opts,
  }
}

export function sampleDoc(blocks: any[] = [{ id: 'p01-b0', type: 'paragraph', text: 'x' }]): [any, any] {
  const page = { id: 'p01', kind: 'content', title: null, continued: false, blocks }
  const doc = { version: 1, meta: { title: 'T', date: null, source: null }, pages: [makeSourcePage('# T'), page] }
  return [doc, page]
}
