// Small helpers that reproduce the Python version's number and text formatting,
// so the TS port writes the same HTML and reports as scripts/md2html (Python).

/** Python f"{x:.Nf}" (round half to even on the binary value, like printf). */
export function fixed(x: number, digits: number): string {
  // toFixed rounds the exact binary value the same way CPython's formatting does
  const s = x.toFixed(digits)
  return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s
}

/** Python str() of a value that Python keeps as a float (1.0 -> "1.0"). */
export function pyFloat(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`
  return String(x)
}

/** Python round(x, n) for n >= 0: half to even on the decimal string. */
export function pyRound(x: number, n = 0): number {
  const m = 10 ** n
  const y = x * m
  const r = Math.round(y)
  // Math.round rounds .5 up; Python rounds the exact binary value half to even
  if (Math.abs(y % 1) === 0.5 && r % 2 !== 0) return (r - 1) / m
  return r / m
}

/** Python json.dumps(obj, ensure_ascii=False, indent=2). */
export function jsonDumps(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

/** Python html.escape(s, quote=True). */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** Python repr() of a str, as used in error messages ('...'). */
export function repr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return String(v)
  if (typeof v !== 'string') return JSON.stringify(v)
  const quote = v.includes("'") && !v.includes('"') ? '"' : "'"
  let out = ''
  for (const c of v) {
    if (c === '\\') out += '\\\\'
    else if (c === quote) out += '\\' + c
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else out += c
  }
  return quote + out + quote
}

/** str.strip() with Python's whitespace set (close enough for Markdown text). */
export function strip(s: string): string {
  return s.replace(/^\s+|\s+$/g, '')
}

export function rstrip(s: string, chars?: string): string {
  if (chars === undefined) return s.replace(/\s+$/, '')
  let end = s.length
  while (end > 0 && chars.includes(s[end - 1]!)) end--
  return s.slice(0, end)
}

export function lstrip(s: string): string {
  return s.replace(/^\s+/, '')
}

/** A module-level counter like itertools.count(1). */
export function counter(start = 1): () => number {
  let n = start
  return () => n++
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
