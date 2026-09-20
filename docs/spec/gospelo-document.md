# Gospelo Document format, version 1 (draft)

A Gospelo Document is a paginated document (A4, A3, 16:9, 4:3) whose complete, editable content travels inside a single HTML file. The file opens in any browser, can be edited by changing a JSON object near the top, and can be rebuilt by `gospelo-md2html` from that object alone. This document defines the container, the envelope object, and the rules readers and writers must follow.

Key words MUST, SHOULD and MAY are used in the RFC 2119 sense. The JSON Schema is `gospelo-document.schema.json` next to this file.

Status: draft 1, 2026-09-21. The current `gospelo-md2html` output differs from this draft; section 9 lists the differences.

## 1. Forms

The format follows glTF in having a single-file form, a sidecar form, and a reserved package form.

| Form | Extension | Media type | Content |
| --- | --- | --- | --- |
| Single file | `.gospelo.html` | `text/html` | HTML container with the envelope embedded (section 3). The distributed artifact. |
| Sidecar | `.gospelo.json` | `application/json` | The envelope alone (section 4). Optional; for editing and diffs outside the HTML. |
| Package | `.gospelo` | reserved | Reserved for a ZIP containing a single file plus external images. Not defined in version 1. |

The envelope object is identical in the single-file and sidecar forms. Converting between them adds or removes the HTML container and nothing else.

## 2. Terms

- **Envelope**: the JSON object that holds format identification, metadata, layout and pages.
- **Source page**: `pages[0]` with `kind: "source"`, carrying the original Markdown as one `markdown` block.
- **Rendered pages**: the `<section class="page">` elements in the HTML body. They are derived from the envelope and are not part of the editable data.
- **Reader**: software that loads the envelope. **Writer**: software that produces a Gospelo Document.

## 3. Container (single-file form)

### 3.1 Structure

```html
<!DOCTYPE html>
<!-- gospelo-document 1 -->
<html lang="ja" data-gospelo-document="1">
<head>
<meta charset="UTF-8">
<title>...</title>
<script type="application/json" id="gospelo-document">
{ ...envelope... }
</script>
<style>...</style>
</head>
<body>
<section class="page" data-page-id="p01">...</section>
...
<script>...figures.js...</script>
<script>...page numbering...</script>
<script>...mermaid.min.js (when the document has Mermaid blocks)...</script>
</body>
</html>
```

### 3.2 Rules

1. The file MUST be valid HTML5 encoded in UTF-8.
2. Line 1 MUST be `<!DOCTYPE html>` and line 2 MUST be the comment `<!-- gospelo-document 1 -->`. This lets a reader identify the format from the first 64 bytes regardless of the file extension.
3. The `<html>` element MUST carry `data-gospelo-document="1"` and SHOULD carry `lang` equal to `meta.lang`.
4. The envelope MUST be embedded exactly once as `<script type="application/json" id="gospelo-document">` inside `<head>`, before any `<style>` element and before any other `<script>` element. A reader MAY stop reading the file at the first `</script>` after that opening tag.
5. Inside the envelope block every `<` MUST be written as `<`. Consequently the sequence `</script` cannot occur inside the block and the first `</script>` after the opening tag is its end. Writers SHOULD also escape `>` as `>` and `&` as `&`.
6. Large static assets (the Mermaid library, `figures.js`, page numbering) MUST be placed at the end of `<body>`, after the rendered pages.
7. Rendered pages MUST be regenerated from the envelope on every build. A reader MUST NOT treat the rendered DOM as source data.
8. Each rendered page MUST carry `data-page-id` equal to the `id` of the page it renders, so that reports and edits can refer to both.
9. A writer MAY additionally include `<script type="text/markdown" id="gospelo-source">` with the raw Markdown for human reading. It is informational: the source of truth is the source page in the envelope.

## 4. Envelope

```json
{
  "format": "gospelo-document",
  "version": 1,
  "generator": "gospelo-md2html 0.1.0",
  "meta": { "title": "...", "date": "2026-09-21", "source": "report.md", "lang": "ja" },
  "layout": { "page": "16x9", "fontSize": "14pt", "columns": "two" },
  "pages": [
    { "id": "p00", "kind": "source", "title": null, "continued": false,
      "blocks": [ { "type": "markdown", "text": "# ..." } ] },
    { "id": "p01", "kind": "cover", "title": "...", "continued": false, "blocks": [ ... ] },
    { "id": "p02", "kind": "content", "title": "1. ...", "continued": false, "blocks": [ ... ] }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Always `"gospelo-document"`. |
| `version` | yes | Integer major version. Readers MUST reject a version they do not implement. |
| `generator` | no | Tool and version that wrote the file. Informational. |
| `meta` | yes | `title` (required), `date`, `source` (path of the Markdown relative to the file), `lang` (BCP 47, default `ja`). |
| `layout` | yes | Page format, body size, columns and the per-page or per-block `overrides`. Same keys as the CLI options of `gospelo-md2html`. |
| `pages` | yes | One object per page. `pages[0]` MAY be the source page. At least one `cover` or `content` page is required. |
| `extras` | no | Free-form application data at document, meta, layout and page level. Readers MUST preserve it and MUST NOT depend on it. |

### 4.1 Pages and blocks

Pages and blocks are unchanged from the `gospelo-md2html` content JSON: page `kind` is `source`, `cover` or `content`; block `type` is one of `heading`, `paragraph`, `list`, `table`, `code`, `image`, `mermaid`, `quote`, `html`, `markdown`, `pagebreak`. Inline formatting (bold, inline code, links) stays as Markdown text. A `markdown` block is allowed only on the source page. `continued: true` on a page or on a `table` / `code` block marks a fragment that continues the previous one; `--reflow` merges these before re-paginating.

Block `id` values are optional in the file. A reader assigns `<page id>-b<index>` to blocks without an id; a writer MUST NOT persist ids it generated itself.

### 4.2 Identifiers

- Page ids MUST be unique within the document. Continuation pages produced by a build use `<id>-2`, `<id>-3`.
- Block ids, when present, MUST be unique within the document and are the keys used by `layout.overrides`.

## 5. Reading

A conforming reader:

1. Opens the file and reads in chunks. If the first 64 bytes do not contain `gospelo-document`, it MAY fall back to scanning the whole file (section 9, legacy).
2. Finds `<script type="application/json" id="gospelo-document">` and the following `</script>`, parses the JSON in between, and stops reading.
3. Rejects the document if `format` is not `gospelo-document` or `version` is unsupported.
4. Validates against the schema. Unknown keys are an error except inside `extras`.

Reading the sidecar form is step 3 and 4 applied to the whole file.

## 6. Writing

A conforming writer:

1. Produces the envelope, runs its own layout process, and renders the pages from the result.
2. Writes the container in the order of section 3.1, with the envelope before styles and scripts.
3. Writes the envelope pretty-printed (two-space indent, one key per line) so that edits produce line-level diffs, with `<` escaped per rule 3.2.5.
4. Writes `meta.source` relative to the directory of the file being written.
5. Removes runtime-only data (generated block ids, placement data) before embedding.

## 7. Editing contract

- The envelope is the only supported edit surface. Editing the rendered DOM has no effect after the next build.
- A build starts from the page boundaries in `pages` and moves only overflow to continuation pages. It never pulls content back to an earlier page. Re-paginating everything is an explicit operation (`--reflow`).
- Content that spills during a build is written back into the envelope of the same file, so the envelope and the rendered pages never disagree.
- Layout belongs in `layout`; content pages carry no layout except `layout.overrides` keyed by their ids.

## 8. Assets

- Images are referenced by `src` as a path relative to the file, or embedded as a `data:` URI when `layout.embedImages` is true.
- The Mermaid library is embedded when `layout.mermaidLib` is `embed` (default) and the document has at least one `mermaid` block; with `link` a `mermaid.min.js` next to the file is referenced. Mermaid diagrams are stored as source and drawn in the browser; they are never pre-rendered.
- Fonts are not embedded except the Font Awesome subset needed by `fa:` icons in Mermaid sources.

## 9. Differences from the current gospelo-md2html output (legacy)

Files written by `gospelo-md2html` before this format existed are readable with the fallback in section 5 step 1.

| Legacy | Version 1 |
| --- | --- |
| Three blocks: `text/markdown` id `page-0`, JSON id `md2html-content`, JSON id `md2html-layout` | One envelope block, id `gospelo-document`. The Markdown lives in `pages[0]`; the `text/markdown` block is optional and informational. |
| Blocks placed after the Mermaid library (in `<head>`), at the start of `<body>` | Envelope first in `<head>`; Mermaid library last in `<body>`. |
| No format identifier; `version: 1` on the content JSON | `format`, `version`, `generator` on the envelope; `data-gospelo-document` on `<html>`; signature comment on line 2. |
| `meta` has `title`, `date`, `source` | Adds optional `lang`; `extras` at document, meta, layout and page level. |
| Layout `columns` and `fontSize` written as `null` when defaulted | Same; `null` means "use the page format default". |
| Extension `.html` | `.gospelo.html` (single file), `.gospelo.json` (sidecar). Plain `.html` remains readable. |

Readers SHOULD accept legacy ids (`page-0`, `md2html-content`, `md2html-layout`) as aliases for one release cycle and writers MUST emit only the version 1 form.

## 10. Conformance checklist

- [ ] Line 2 is `<!-- gospelo-document 1 -->`
- [ ] `<html data-gospelo-document="1" lang="...">`
- [ ] Exactly one `#gospelo-document` script, in `<head>`, before styles and scripts
- [ ] Envelope validates against `gospelo-document.schema.json`
- [ ] `<` escaped as `<` inside the envelope
- [ ] Rendered `section.page` ids match `pages[].id`
- [ ] Large scripts at the end of `<body>`
- [ ] `meta.source` relative to the file
