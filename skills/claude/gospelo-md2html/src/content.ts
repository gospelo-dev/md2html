// Gospelo Document I/O and content validation (docs/spec/gospelo-document.md).
//
// A document is one envelope object: format, version, generator, meta, layout,
// pages. It is stored either inside a .gospelo.html file (script
// id="gospelo-document", first thing in <head>) or as a .gospelo.json sidecar.
// Internally the tool works on the content part (version, meta, pages) and a
// layout dict; the envelope exists only at the file boundary.
//
// Validation is a self-contained minimal check (required keys, types, enums and
// the page-0 rules). It never fills in defaults for missing data.

import { closeSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { Block, Item } from './blocks.ts'
import { esc, isObject, jsonDumps, repr } from './py.ts'
import { VERSION } from './version.ts'

export const FORMAT = 'gospelo-document'
export const SCHEMA_VERSION = 1
export const GENERATOR = `gospelo-md2html ${VERSION}`
export const DOC_SCRIPT_ID = 'gospelo-document'
export const SIGNATURE = `<!-- ${FORMAT} ${SCHEMA_VERSION} -->`
export const HTML_SUFFIX = '.gospelo.html'
export const JSON_SUFFIX = '.gospelo.json'
export const MIGRATION_URL = 'https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION.md'

const HEAD_CHUNK = 64 * 1024 // the envelope must start within the first chunk

export const PAGE_KINDS = ['source', 'cover', 'content'] as const

export interface Page {
  id: string
  kind: string
  title: string | null
  continued: boolean
  blocks: Block[]
  extras?: Record<string, unknown>
  _layout?: Segment[]
  [key: string]: unknown
}

export type Segment = { kind: 'cols'; left: number[]; right: number[] } | { kind: 'wide'; index: number }

export interface Doc {
  version: number
  meta: { title: string; date: string | null; source: string | null; lang?: string; extras?: Record<string, unknown> }
  pages: Page[]
  extras?: Record<string, unknown>
}

type Kind = 'int' | 'str' | 'str?' | 'list' | 'bool'
// type -> {key: [kind, required]}
const BLOCK_SPEC: Record<string, Record<string, [Kind, boolean]>> = {
  heading: { level: ['int', true], text: ['str', true] },
  paragraph: { text: ['str', true] },
  list: { ordered: ['bool', true], items: ['list', true], start: ['int', false] },
  table: { header: ['list', true], rows: ['list', true], align: ['list', false], continued: ['bool', false] },
  code: { lang: ['str?', true], lines: ['list', true], continued: ['bool', false] },
  image: { src: ['str', true], alt: ['str', true], caption: ['str?', false] },
  mermaid: { source: ['str', true] },
  quote: { text: ['str', true] },
  html: { html: ['str', true] },
  markdown: { text: ['str', true] },
  pagebreak: {},
}

export const FIGURE_TYPES = new Set(['image', 'mermaid'])

export class ContentError extends Error {}

function kindOk(kind: Kind, v: unknown): boolean {
  switch (kind) {
    case 'int': return typeof v === 'number' && Number.isInteger(v)
    case 'str': return typeof v === 'string'
    case 'str?': return typeof v === 'string' || v === null
    case 'list': return Array.isArray(v)
    case 'bool': return typeof v === 'boolean'
  }
}

// --------------------------------------------------------------------------
// paths

export function isHtmlPath(path: string): boolean {
  const ext = extname(path).toLowerCase()
  return ext === '.html' || ext === '.htm'
}

/** <name>.gospelo.html next to `path` (input Markdown or sidecar JSON). */
export function defaultHtmlPath(path: string): string {
  let name = basename(path)
  const lower = name.toLowerCase()
  const suffix = [JSON_SUFFIX, HTML_SUFFIX].find((s) => lower.endsWith(s))
  if (suffix) name = name.slice(0, -suffix.length)
  else {
    const ext = extname(name)
    name = ext ? name.slice(0, -ext.length) : name
  }
  return join(dirname(path), name + HTML_SUFFIX)
}

// --------------------------------------------------------------------------
// envelope <-> (content, layout)

/** The Gospelo Document object for `doc` (content part) and an effective layout dict. */
export function makeEnvelope(doc: Doc, layout: Record<string, unknown>, pages?: Page[]): Record<string, any> {
  const srcPage = doc.pages.length && doc.pages[0]!.kind === 'source' ? doc.pages[0]! : null
  const body = pages !== undefined ? [...pages] : doc.pages.filter((p) => p.kind !== 'source')
  const env: Record<string, any> = {
    format: FORMAT,
    version: SCHEMA_VERSION,
    generator: GENERATOR,
    meta: { ...doc.meta },
    layout: { ...layout },
    pages: [...(srcPage ? [srcPage] : []), ...body],
  }
  if (doc.extras && Object.keys(doc.extras).length) env.extras = doc.extras
  return stripRuntimeIds(env as { pages: Page[] })
}

/** Validate the envelope shell and return [content doc, layout dict]. */
export function splitEnvelope(env: unknown, where: string): [Doc, Record<string, unknown>] {
  if (!isObject(env) || env.format !== FORMAT) {
    throw new ContentError(
      `${where}: not a Gospelo Document (no "format": "${FORMAT}"). ` +
        `Files written by earlier md2html releases must be converted first: ${MIGRATION_URL}`,
    )
  }
  if (env.version !== SCHEMA_VERSION) {
    throw new ContentError(`${where}: unsupported ${FORMAT} version ${repr(env.version)} (this tool reads ${SCHEMA_VERSION})`)
  }
  for (const key of Object.keys(env)) {
    if (!['format', 'version', 'generator', 'meta', 'layout', 'pages', 'extras'].includes(key)) {
      throw new ContentError(`${where}: unknown top-level key ${repr(key)}`)
    }
  }
  if ('generator' in env && typeof env.generator !== 'string') {
    throw new ContentError(`${where}: generator must be a string`)
  }
  const layout = env.layout
  if (!isObject(layout)) throw new ContentError(`${where}: layout must be an object`)
  const doc: Record<string, unknown> = { version: SCHEMA_VERSION, meta: env.meta, pages: env.pages }
  if ('extras' in env) doc.extras = env.extras
  validateContent(doc, where)
  return [doc as unknown as Doc, layout]
}

// --------------------------------------------------------------------------
// load / save

/** [content doc with block ids assigned, layout dict] from a .gospelo.html or .gospelo.json. */
export function loadDocument(path: string): [Doc, Record<string, unknown>] {
  let env: unknown
  if (isHtmlPath(path)) {
    env = envelopeFromHtml(readHead(path), path)
  } else {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      throw new ContentError(`document not found: ${path}`)
    }
    try {
      env = JSON.parse(text)
    } catch (e) {
      throw new ContentError(`document is not valid JSON: ${path}: ${(e as Error).message}`)
    }
  }
  const [doc, layout] = splitEnvelope(env, path)
  assignBlockIds(doc)
  return [doc, layout]
}

/** Write the sidecar form (.gospelo.json). */
export function saveDocument(doc: Doc, layout: Record<string, unknown>, path: string): void {
  writeFileSync(path, jsonDumps(makeEnvelope(doc, layout)) + '\n', 'utf-8')
}

/** Block ids are computed at load time; do not persist the generated ones.
 * Runtime keys (leading underscore) on pages are dropped as well. */
export function stripRuntimeIds<T extends { pages: Page[] }>(doc: T): T {
  const copy = JSON.parse(JSON.stringify(doc)) as T
  for (const page of copy.pages) {
    for (const key of Object.keys(page)) if (key.startsWith('_')) delete page[key]
    for (const block of page.blocks) {
      if (block._generated_id) {
        delete block.id
        delete block._generated_id
      }
    }
  }
  return copy
}

export function assignBlockIds(doc: Doc): void {
  for (const page of doc.pages) {
    page.blocks.forEach((block, i) => {
      if (!('id' in block)) {
        block.id = `${page.id}-b${i}`
        block._generated_id = true
      }
    })
  }
}

// --------------------------------------------------------------------------
// HTML container: embed and extract

/** JSON safe to place inside <script type="application/json">: '<', '>' and '&'
 * are escaped so no '</script' or comment sequence can appear. */
export function embedJson(obj: unknown): string {
  return jsonDumps(obj).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

export function envelopeScript(env: unknown): string {
  return `<script type="application/json" id="${DOC_SCRIPT_ID}">\n` + embedJson(env) + '\n</script>'
}

const OPEN_TAG = `<script type="application/json" id="${DOC_SCRIPT_ID}">`
const CLOSE_TAG = '</script>'

/** Read `path` only as far as the end of the envelope block. */
export function readHead(path: string): string {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    throw new ContentError(`document not found: ${path}`)
  }
  try {
    const chunks: Buffer[] = []
    const buf = Buffer.alloc(HEAD_CHUNK)
    let text = ''
    let start = -1
    for (;;) {
      const n = readSync(fd, buf, 0, HEAD_CHUNK, null)
      if (n > 0) chunks.push(Buffer.from(buf.subarray(0, n)))
      // decode everything read so far: a chunk boundary may split a UTF-8 sequence
      text = Buffer.concat(chunks).toString('utf-8')
      if (start < 0) {
        start = text.indexOf(OPEN_TAG)
        if (start < 0) {
          if (chunks.length === 1 || n === 0) notGospelo(text, path)
        }
      }
      if (start >= 0) {
        const end = text.indexOf(CLOSE_TAG, start + OPEN_TAG.length)
        if (end >= 0) return text.slice(0, end + CLOSE_TAG.length)
      }
      if (n === 0) throw new ContentError(`${path}: the ${DOC_SCRIPT_ID} block is not terminated`)
    }
  } finally {
    closeSync(fd)
  }
}

function notGospelo(head: string, where: string): never {
  // pre-1 md2html output: the envelope blocks sat after the Mermaid library, but the
  // <html> tag (always inside the first chunk) carried this attribute from the start
  const legacy = head.includes('data-mermaid-font-size=') || head.includes('id="md2html-content"') || head.includes('id="page-0"')
  const hint = legacy
    ? 'it was written by an earlier md2html release; convert it first: '
    : 'it was not generated by md2html build, or the block was removed. Conversion notes: '
  throw new ContentError(`${where}: no <script id="${DOC_SCRIPT_ID}"> envelope found; ${hint}${MIGRATION_URL}`)
}

/** [content doc, layout dict] from the text of a .gospelo.html (or its head). */
export function extractFromHtml(htmlText: string, where = 'html'): [Doc, Record<string, unknown>] {
  return splitEnvelope(envelopeFromHtml(htmlText, where), where)
}

function envelopeFromHtml(text: string, where: string): unknown {
  const start = text.indexOf(OPEN_TAG)
  if (start < 0) notGospelo(text, where)
  const end = text.indexOf(CLOSE_TAG, start + OPEN_TAG.length)
  if (end < 0) throw new ContentError(`${where}: the ${DOC_SCRIPT_ID} block is not terminated`)
  try {
    return JSON.parse(text.slice(start + OPEN_TAG.length, end))
  } catch (e) {
    throw new ContentError(`${where}: embedded ${DOC_SCRIPT_ID} JSON is not valid: ${(e as Error).message}`)
  }
}

// --------------------------------------------------------------------------
// validation

export function validateContent(doc: unknown, where = 'content'): void {
  if (!isObject(doc)) throw new ContentError(`${where}: top level must be an object`)
  if (doc.version !== SCHEMA_VERSION) {
    throw new ContentError(`${where}: version must be ${SCHEMA_VERSION} (got ${repr(doc.version)})`)
  }
  const meta = doc.meta
  if (!isObject(meta)) throw new ContentError(`${where}: meta must be an object`)
  if (typeof meta.title !== 'string') throw new ContentError(`${where}: meta.title must be a string`)
  if (!(typeof meta.date === 'string' || meta.date === null || meta.date === undefined)) {
    throw new ContentError(`${where}: meta.date must be a string or null`)
  }
  if (!(typeof meta.source === 'string' || meta.source === null || meta.source === undefined)) {
    throw new ContentError(`${where}: meta.source must be a string or null`)
  }
  if ('lang' in meta && (typeof meta.lang !== 'string' || !meta.lang)) {
    throw new ContentError(`${where}: meta.lang must be a non-empty string`)
  }
  for (const key of Object.keys(meta)) {
    if (!['title', 'date', 'source', 'lang', 'extras'].includes(key)) {
      throw new ContentError(`${where}: meta has unknown key ${repr(key)}`)
    }
  }
  if ('extras' in meta && !isObject(meta.extras)) throw new ContentError(`${where}: meta.extras must be an object`)
  if ('extras' in doc && !isObject(doc.extras)) throw new ContentError(`${where}: extras must be an object`)
  const pages = doc.pages
  if (!Array.isArray(pages) || !pages.length) throw new ContentError(`${where}: pages must be a non-empty array`)
  const seen = new Set<string>()
  pages.forEach((page, idx) => {
    validatePage(page, idx, where)
    if (seen.has(page.id)) throw new ContentError(`${where}: duplicate page id ${repr(page.id)}`)
    seen.add(page.id)
  })
  if (!pages.some((p) => p.kind !== 'source')) {
    throw new ContentError(`${where}: at least one cover or content page is required`)
  }
}

function validatePage(page: unknown, idx: number, where: string): void {
  const loc = `${where}: pages[${idx}]`
  if (!isObject(page)) throw new ContentError(`${loc} must be an object`)
  for (const key of ['id', 'kind', 'title', 'continued', 'blocks']) {
    if (!(key in page)) throw new ContentError(`${loc} is missing ${repr(key)}`)
  }
  for (const key of Object.keys(page)) {
    if (!['id', 'kind', 'title', 'continued', 'blocks', 'extras'].includes(key) && !key.startsWith('_')) {
      throw new ContentError(`${loc} has unknown key ${repr(key)}`)
    }
  }
  if (typeof page.id !== 'string' || !page.id) throw new ContentError(`${loc}.id must be a non-empty string`)
  if (!(PAGE_KINDS as readonly unknown[]).includes(page.kind)) {
    throw new ContentError(`${loc}.kind must be one of ('source', 'cover', 'content')`)
  }
  if (!(typeof page.title === 'string' || page.title === null)) throw new ContentError(`${loc}.title must be a string or null`)
  if (typeof page.continued !== 'boolean') throw new ContentError(`${loc}.continued must be a boolean`)
  if (!Array.isArray(page.blocks)) throw new ContentError(`${loc}.blocks must be an array`)
  if ('extras' in page && !isObject(page.extras)) throw new ContentError(`${loc}.extras must be an object`)
  if (page.kind === 'source') {
    if (idx !== 0) throw new ContentError(`${loc}: a source page must be pages[0]`)
    if (page.blocks.length !== 1 || page.blocks[0]?.type !== 'markdown') {
      throw new ContentError(`${loc}: a source page must contain exactly one markdown block`)
    }
  }
  page.blocks.forEach((block: unknown, bIdx: number) => validateBlock(block, `${loc}.blocks[${bIdx}]`, page.kind as string))
}

function validateBlock(block: unknown, loc: string, pageKind: string): void {
  if (!isObject(block)) throw new ContentError(`${loc} must be an object`)
  const btype = block.type as string
  const spec = BLOCK_SPEC[btype]
  if (typeof btype !== 'string' || spec === undefined) {
    throw new ContentError(`${loc}.type ${repr(btype)} is not a known block type`)
  }
  if (btype === 'markdown' && pageKind !== 'source') {
    throw new ContentError(`${loc}: markdown blocks are only allowed on the source page`)
  }
  if ('id' in block && (typeof block.id !== 'string' || !block.id)) throw new ContentError(`${loc}.id must be a non-empty string`)
  for (const [key, [kind, required]] of Object.entries(spec)) {
    if (!(key in block)) {
      if (required) throw new ContentError(`${loc} (${btype}) is missing ${repr(key)}`)
      continue
    }
    if (!kindOk(kind, block[key])) throw new ContentError(`${loc}.${key} has wrong type for ${btype}`)
  }
  for (const key of Object.keys(block)) {
    if (!(key in spec) && !['type', 'id', '_generated_id'].includes(key)) {
      throw new ContentError(`${loc} (${btype}) has unknown key ${repr(key)}`)
    }
  }
  if (btype === 'heading' && !((block.level as number) >= 1 && (block.level as number) <= 4)) {
    throw new ContentError(`${loc}: heading level must be 1 to 4`)
  }
  if (btype === 'list') validateItems(block.items, loc)
  if (btype === 'table') {
    const header = block.header as unknown[]
    const ncols = header.length
    if (ncols === 0 || !header.every((h) => typeof h === 'string')) {
      throw new ContentError(`${loc}: table header must be a non-empty array of strings`)
    }
    ;(block.rows as unknown[]).forEach((row, rIdx) => {
      if (!Array.isArray(row) || !row.every((c) => typeof c === 'string')) {
        throw new ContentError(`${loc}.rows[${rIdx}] must be an array of strings`)
      }
      if (row.length !== ncols) throw new ContentError(`${loc}.rows[${rIdx}] has ${row.length} cells, header has ${ncols}`)
    })
    if ('align' in block) {
      const align = block.align as unknown[]
      if (align.length !== ncols || !align.every((a) => a === 'left' || a === 'center' || a === 'right')) {
        throw new ContentError(`${loc}.align must list left/center/right for each column`)
      }
    }
  }
  if (btype === 'code' && !(block.lines as unknown[]).every((l) => typeof l === 'string')) {
    throw new ContentError(`${loc}.lines must be an array of strings`)
  }
}

function validateItems(items: unknown, loc: string): void {
  if (!Array.isArray(items)) throw new ContentError(`${loc}.items must be an array`)
  if (!items.length) throw new ContentError(`${loc}.items must not be empty`)
  items.forEach((item: unknown, i: number) => {
    if (!isObject(item) || typeof item.text !== 'string') {
      throw new ContentError(`${loc}.items[${i}] must be an object with a text string`)
    }
    for (const key of Object.keys(item)) {
      if (!['text', 'children', 'childrenOrdered'].includes(key)) {
        throw new ContentError(`${loc}.items[${i}] has unknown key ${repr(key)}`)
      }
    }
    if ('childrenOrdered' in item) {
      if (typeof item.childrenOrdered !== 'boolean') throw new ContentError(`${loc}.items[${i}].childrenOrdered must be a boolean`)
      if (!('children' in item)) throw new ContentError(`${loc}.items[${i}].childrenOrdered requires children`)
    }
    if ('children' in item) validateItems(item.children, `${loc}.items[${i}]`)
  })
}

// --------------------------------------------------------------------------
// page 0 (source backup) and restore

export function makeSourcePage(markdownText: string): Page {
  return { id: 'p00', kind: 'source', title: null, continued: false, blocks: [{ type: 'markdown', text: markdownText }] }
}

export function getSourceMarkdown(doc: Doc): string | null {
  const first = doc.pages[0]!
  return first.kind === 'source' ? (first.blocks[0]!.text as string) : null
}

export function contentPages(doc: Doc): Page[] {
  return doc.pages.filter((p) => p.kind !== 'source')
}

/** The original Markdown (pages[0]) of a .gospelo.html or .gospelo.json. */
export function restoreMarkdown(path: string): string {
  const [doc] = loadDocument(path)
  const src = getSourceMarkdown(doc)
  if (src === null) throw new ContentError(`${path}: this document has no page 0 source backup`)
  return src
}

export function htmlAttr(value: string): string {
  return esc(value)
}

export type { Item }
