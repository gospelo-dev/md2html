// The markdown-it instance shared by block parsing and inline rendering.
//
// The Python version used markdown-it-py's "gfm-like" preset with linkify off:
// CommonMark with raw HTML allowed, plus tables and strikethrough. markdown-it
// (JS) has no such preset, so it is built here from "commonmark".

import MarkdownIt, { type Token as MdToken } from 'markdown-it'

export const md = new MarkdownIt('commonmark', { html: true, linkify: false, typographer: false })
md.enable(['table', 'strikethrough'])

export type Token = MdToken

/** The inline children of `text` (parsed as one inline run). */
export function inlineTokens(text: string): Token[] {
  const top = md.parseInline(text, {})
  return top[0]?.children ?? []
}
