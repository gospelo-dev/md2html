// Browser-side assets: base CSS, figures.js, vendored Shiki, and Font Awesome
// (from mermaid-arch). Missing vendor files are an error.
//
// Mermaid is not vendored: diagrams are drawn by mermaid-arch with the mermaid
// package npm installs (its bundle contains elkjs, EPL-2.0, which is kept out of
// the repository), and written into the document as SVG.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fontAwesome, installedMermaid } from '@gospelo/mermaid-arch'

// src/assets.ts and the bundled scripts/md2html.mjs both sit one level below the skill
export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REFERENCES = join(SKILL_DIR, 'references')
export const VENDOR = join(REFERENCES, 'vendor')

const SHIKI_DIR = join(VENDOR, 'shiki')
const BASE_CSS = join(REFERENCES, 'base.css')
const FIGURES_JS = join(REFERENCES, 'figures.js')

const VERSION_RE = /^\d+\.\d+\.\d+$/

export class AssetError extends Error {}

function read(path: string): string {
  if (!existsSync(path) || !statSync(path).isFile()) throw new AssetError(`required asset is missing: ${path}`)
  return readFileSync(path, 'utf-8')
}

export function baseCss(): string {
  return read(BASE_CSS)
}

export function figuresJs(): string {
  return read(FIGURES_JS)
}

function versionKey(v: string): number[] {
  return v.split('.').map((x) => parseInt(x, 10))
}

function compareVersions(a: string, b: string): number {
  const ka = versionKey(a)
  const kb = versionKey(b)
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0)
    if (d) return d
  }
  return 0
}

// --------------------------------------------------------------------------
// Mermaid (drawn by mermaid-arch)

/** The Mermaid version mermaid-arch draws with (the installed mermaid package, checked
 * by mermaid-arch); documents record it as layout.mermaidVersion. */
export function mermaidVersion(): string {
  return installedMermaid().version
}

// --------------------------------------------------------------------------
// Shiki (per-version vendoring)

export function shikiVersions(): string[] {
  if (!existsSync(SHIKI_DIR)) return []
  return readdirSync(SHIKI_DIR)
    .filter((name) => VERSION_RE.test(name) && existsSync(join(SHIKI_DIR, name, 'shiki.min.js')))
    .sort(compareVersions)
}

export function shikiScriptTag(): string {
  const versions = shikiVersions()
  const version = versions[versions.length - 1]
  if (version === undefined) return ''
  const text = read(join(SHIKI_DIR, version, 'shiki.min.js'))
  return `<script data-shiki-version="${version}">\n${text}\n</script>`
}

// --------------------------------------------------------------------------
// Font Awesome and page chrome

/** Font Awesome as mermaid-arch ships it (fonts as data: URLs). The same CSS is loaded
 * into the page mermaid-arch draws diagrams in, so fa: labels measure the same. */
export function fontawesomeStyleTag(): string {
  return '<style>\n' + fontAwesome().css + '\n</style>'
}

export function pageNumberScript(): string {
  return (
    '<script>\n' +
    "document.addEventListener('DOMContentLoaded', function () {\n" +
    "  var pages = document.querySelectorAll('.page');\n" +
    '  pages.forEach(function (p, i) {\n' +
    "    var el = p.querySelector('.page-number');\n" +
    "    if (el) { el.textContent = (i + 1) + ' / ' + pages.length; }\n" +
    '  });\n' +
    '});\n' +
    '</script>'
  )
}
