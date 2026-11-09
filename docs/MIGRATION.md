# Migrating documents to the Gospelo Document format

Since gospelo-md2html 0.2.0 the only file the tool reads and writes is a **Gospelo Document**: a `.gospelo.html` (or a `.gospelo.json` sidecar) whose first `<script>` holds the envelope `{"format": "gospelo-document", "version": 1, ...}`. Files written by earlier releases are not read. `check`, `build` and `restore` stop with:

```
error: old.html: no <script id="gospelo-document"> envelope found; it was written by an earlier md2html release; convert it first: https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION.md
```

The same applies to a bare content JSON (`{"version": 1, "meta": ..., "pages": ...}` without `format`).

## Principle

A Gospelo Document is always generated from Markdown. Every file the tool has ever written keeps the imported Markdown inside, so migration is: get the Markdown out, run `import` again.

## Steps

1. Get the original Markdown.
   - If you still have the `.md` that was imported, use it. Skip to step 2.
   - Otherwise extract it from the old file with the migration tool (standard library only, no `uv` needed):

     ```bash
     python skills/claude/gospelo-md2html/scripts/extract_markdown.py old.html -o original.md
     ```

     It reads any container the tool has written: `.gospelo.html`, `.gospelo.json`, a pre-0.2 HTML (its `<script type="text/markdown" id="page-0">` block) and a pre-0.2 content JSON (its `pages[0]` source page). The output is the Markdown exactly as it was imported.

2. Generate the Gospelo Document with the same paper and font size as before (both are pagination inputs):

   ```bash
   S=skills/claude/gospelo-md2html/scripts/md2html.py
   uv run $S setup      # once: npm packages and chrome-headless-shell (needs Node.js 22.12+)
   uv run $S import original.md -o new.gospelo.html --page 16x9 --font-size 14pt
   ```

   The old HTML's `<script id="md2html-layout">` block shows which options were in effect.

3. Re-apply edits that were made to the old content JSON after import, if any. Edits made to the JSON are not carried by the Markdown; compare the old JSON's `pages` with the new document's envelope and edit the new `.gospelo.html` (see the skill's `references/editing_guide.md`).

## What changed

| Before 0.2.0 | Gospelo Document |
| --- | --- |
| `import` wrote `content.json`; `build` produced the HTML | `import` writes `<name>.gospelo.html` directly; the sidecar `.gospelo.json` is optional (`-o name.gospelo.json`) |
| Three blocks after the Mermaid library: `page-0` (Markdown), `md2html-content`, `md2html-layout` | One envelope block `gospelo-document` at the top of `<head>`; the Markdown is `pages[0]` |
| No format identifier | `format`, `version`, `generator` in the envelope, `<!-- gospelo-document 1 -->` on line 2, `data-gospelo-document` on `<html>` |
| Mermaid library in `<head>` | Scripts at the end of `<body>` (diagrams are SVG from 0.7.0); the tool reads only the head of the file |
| Extension `.html` | `.gospelo.html` (plain `.html` is still accepted as input if it contains the envelope) |

Nothing changed in the page and block model: the Markdown, paper sizes, layout options and editing rules are the same. See [spec/gospelo-document.md](./spec/gospelo-document.md) for the format and [ARCHITECTURE.md](./ARCHITECTURE.md) for the file layout.

## From the Python releases (0.2 to 0.6) to 0.7.0

0.7.0 is a TypeScript rewrite on Node.js. The file format is unchanged (`format` `gospelo-document`, `version` 1), so `.gospelo.html` and `.gospelo.json` files written by 0.2 to 0.6 are read as they are. What changes is how diagrams are drawn, and that can move page breaks, so a rebuild does not happen silently:

| Recorded in the old file | What `check` / `build` does | To accept the change |
| --- | --- | --- |
| `layout.mermaidVersion` `11.12.2` (every Python release) | stops: diagrams are now drawn by mermaid-arch with Mermaid 12.3.0, and their sizes, and so the pages, may change | `build old.gospelo.html --mermaid-version 12.3.0` |
| `layout.mermaidLib` `embed` or `link` | stops: diagrams are always written as SVG; no Mermaid library is shipped any more | add `--mermaid-lib prerender` |

Check the result before handing it on: Mermaid 12 lays flowcharts out with ELK unless the diagram says otherwise. To keep a flowchart's earlier arrangement, add `layout: dagre` to its front matter (`---` / `config:` / `layout: dagre` / `---`) or `%%{init: {"layout": "dagre"}}%%`. To re-paginate the whole document instead of only spilling overflow, add `--reflow`.

Other differences:

- Setup: Node.js 22.12 or later is required. `uv run <skill>/scripts/md2html.py setup` installs the npm packages and chrome-headless-shell (instead of Playwright's Chromium). `scripts/md2html.py` still takes the same subcommands and options, except `setup --elk` / `--elk-only`: Mermaid 12 (installed from npm by `setup`) includes ELK, so there is no separate ELK bundle to build. Diagrams that ask for `layout: elk` (or another ELK name) keep working; an unknown layout name still stops the build instead of falling back to dagre.
- Diagrams with AWS icons are new (`--icons-zip <path to Icon-package_*.zip>`).
- A link inside a paragraph that was split across pages now keeps its URL; the Python releases wrote `[text]()` for it. Rebuilding a document whose envelope already contains such an empty link does not restore the URL; fix the text in the envelope, or re-import from the Markdown.
- `fa:` icons in diagram labels now embed Font Awesome Free with all its styles (about 0.5 MB instead of about 0.2 MB).
- The `generator` written into the envelope is `gospelo-md2html 0.7.0`.
