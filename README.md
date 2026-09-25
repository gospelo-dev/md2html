# gospelo-md2html

[![License: MIT](https://img.shields.io/badge/License-MIT-1E90FF.svg?style=flat)](https://github.com/gospelo-dev/md2html/blob/main/LICENSE) [![Python](https://img.shields.io/badge/Python-3.10+-1E90FF.svg?style=flat&logo=python&logoColor=white)](https://www.python.org/) [![uv](https://img.shields.io/badge/run_with-uv-DE5FE9.svg?style=flat)](https://docs.astral.sh/uv/) [![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33.svg?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/python/) [![Mermaid](https://img.shields.io/badge/Mermaid-11-FF3670.svg?style=flat&logo=mermaid&logoColor=white)](https://mermaid.js.org/) [![Agent Skill](https://img.shields.io/badge/Agent_Skill-Claude_Code,_Copilot,_Codex,_OpenCode-7B3FF2.svg?style=flat)](https://docs.claude.com/en/docs/claude-code/skills)

<p align="center"><img src="https://github.com/gospelo-dev/md2html/blob/main/assets/hero.jpg?raw=true" alt="gospelo-md2html: Markdown + Mermaid to paginated slides and documents, editable JSON, original kept" width="820"></p>

Turn Markdown + Mermaid into **layout-aware, paginated slide decks and documents** as **one self-contained HTML file**, with PDF and PPTX output as well. The HTML is a file that an **AI agent can edit and rebuild as it is**, and it **keeps the original Markdown inside**. The name says HTML; the HTML is the master document, and every other format is produced from it. This is not a plain Markdown-to-HTML converter.

日本語版: [README_ja.md](./README_ja.md)

Most Markdown-to-PDF tools flow text into a browser's print engine and hope for the best: headings land at the bottom of a page, tables split anywhere, diagrams shrink or overflow, and once the HTML exists nobody can adjust a single page without regenerating everything. This skill is built around three things:

1. **Layout-aware pagination.** `import` renders every block in headless Chromium to get real heights and paginates with typographic rules (keep headings with their text, split tables at rows and repeat the header, two columns on landscape paper) into 16:9 / 4:3 slides or A4 / A3 documents.
2. **Editable by an AI.** The output is one `.gospelo.html` (a **Gospelo Document**) whose content sits at the top of the file as JSON: one object per page, text as inline Markdown, tables as `header` + `rows`, Mermaid as source. An agent edits the page in question and runs `build` on that same file. Anything that no longer fits is spilled to a continuation page with the same title, and the JSON always matches the rendered pages.
3. **The original is preserved.** The Markdown as imported is kept verbatim inside the file; `restore` gets it back at any time, and a fresh `import` from it undoes every edit.

Layout never lives in the content: paper size, margins, font scale, column split and figure side come from CLI options or a separate layout JSON. Mermaid diagrams are drawn during the build and written into the file as SVG, while their source stays in the envelope, so they remain editable and the file stays small (no 3 MB library inside).

New here? See the [Quickstart](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART.md) ([日本語](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART_ja.md)). The typographic rules and their sources are in [docs/DESIGN.md](https://github.com/gospelo-dev/md2html/blob/main/docs/DESIGN.md), the single-file design in [docs/ARCHITECTURE.md](https://github.com/gospelo-dev/md2html/blob/main/docs/ARCHITECTURE.md), and the file format in [docs/spec/gospelo-document.md](https://github.com/gospelo-dev/md2html/blob/main/docs/spec/gospelo-document.md).

## What you get

| Feature | Detail |
| --- | --- |
| Paper sizes | `a4`, `a4-landscape`, `a3`, `a3-landscape` (documents) and `16x9`, `4x3` (slides) |
| One knob for typography | Everything (headings, tables, code, margins, footer size) derives from `--font-size` |
| Slides | One slide per `h2`; the heading moves into a header band at 1.25x body size, continuation slides are marked |
| Two columns | Landscape formats flow blocks in column order (down the left column, then the right); wide tables, code and wide figures become full-width bands. Portrait formats are single column. `split` (one figure beside the text) is also available |
| Real measurement | Heights are measured in Chromium (Playwright), never estimated; a verify pass checks every page for overflow |
| Editable content | Page-scoped JSON; table rows, list items and Mermaid source are plain data |
| Auto spill | Content that stops fitting after an edit moves to a `(continued)` page; nothing is deleted or forced |
| Gospelo Document | One `.gospelo.html` carries its content, layout and original Markdown in an envelope at the top of the file; `check`, `build` and `restore` work from that file alone, so one file is all an editor (or an agent) needs. An optional `.gospelo.json` sidecar holds the same envelope |
| Original preserved | The Markdown as imported is kept verbatim as page 0 of the envelope; `restore` gets it back |
| Report | Per-page used / remaining height, row and item heights, figure scale, warnings, and planned spills |
| PDF and PPTX | `build --pdf` prints through Chromium at the page size; `build --pptx` writes a fixed-appearance PowerPoint deck: one image slide per page (same Chromium rendering), invisible link hotspots, optional transparent selectable-text layer. Not editable in PowerPoint; see "PPTX export" below |

## Prerequisites

Supported platforms: **macOS / Linux / WSL2**

| Dependency | Install |
| --- | --- |
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.10+, markdown-it-py, Playwright | resolved automatically by `uv run` from the script's inline metadata (no `pip`, no venv) |
| Chromium | one-time: `uv run <skill>/scripts/md2html.py setup` |

Mermaid.js, Shiki (syntax highlighting) and Font Awesome Free are vendored in the skill; nothing else is downloaded at run time.

## Usage example

```bash
S=skills/claude/gospelo-md2html/scripts/md2html.py

# 0. First run only
uv run $S setup

# 1. Markdown -> out/handover.gospelo.html, paginated for 16:9 slides at 14pt (dry-run shows pages and warnings first)
uv run $S import docs/handover.md -o out/handover.gospelo.html --page 16x9 --font-size 14pt --dry-run
uv run $S import docs/handover.md -o out/handover.gospelo.html --page 16x9 --font-size 14pt

# 2. Edit the envelope at the top of out/handover.gospelo.html (add a row to a table on page p05, say),
#    then see what will spill
uv run $S check out/handover.gospelo.html --report out/report.json

# 3. Rebuild the same file (+ PDF and PPTX). Overflow is spilled to continuation pages and written back into the file.
uv run $S build out/handover.gospelo.html --pdf out/handover.pdf --pptx out/handover.pptx

# Roll back to the original Markdown at any time
uv run $S restore out/handover.gospelo.html -o out/handover.original.md

# Prefer a separate JSON for editing or diffs? Write the sidecar form and build from it
uv run $S import docs/handover.md -o out/handover.gospelo.json --page 16x9 --font-size 14pt
uv run $S build out/handover.gospelo.json --pdf out/handover.pdf     # writes out/handover.gospelo.html
```

Paper and font size are pagination inputs, so pass them to `import`. They are recorded in the file; to change them later, run `build --reflow --page a4` (for example) to re-paginate everything.

### The envelope

The first `<script>` of a `.gospelo.html` (and the whole of a `.gospelo.json`) is the envelope: `format`, `version`, `generator`, `meta`, `layout` and `pages`. `pages[0]` is the original Markdown; every other page is one object. One content page of a 16:9 deck:

```json
{
  "id": "p05",
  "kind": "content",
  "title": "4. Environments and gates",
  "continued": false,
  "blocks": [
    { "type": "mermaid", "source": "flowchart LR\n  Feat[feature/*] --> Rel[release/*] --> Main[main]" },
    { "type": "heading", "level": 3, "text": "Gates" },
    {
      "type": "table",
      "header": ["Gate", "Applies to", "Rule"],
      "rows": [
        ["Layer 1", "PRs into `release/*` and `main`", "CI must pass"],
        ["Layer 2", "`release/*` -> `main`", "All E2E green on staging"]
      ]
    }
  ]
}
```

Adding a gate is one more array in `rows`. Text cells keep inline Markdown (`**bold**`, `` `code` ``, `[link](url)`). Block types: `heading`, `paragraph`, `list`, `table`, `code`, `image`, `mermaid`, `quote`, `html`, `pagebreak`. The envelope schema is [references/gospelo-document.schema.json](https://github.com/gospelo-dev/md2html/blob/main/skills/claude/gospelo-md2html/references/gospelo-document.schema.json); the format is specified in [docs/spec/gospelo-document.md](https://github.com/gospelo-dev/md2html/blob/main/docs/spec/gospelo-document.md). Files written before 0.2.0 are not read; see [docs/MIGRATION.md](https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION.md).

### Layout JSON (optional)

```json
{
  "page": "16x9",
  "fontSize": "14pt",
  "titleScale": 1.25,
  "columns": "two",
  "overrides": {
    "p07": { "columns": "single" },
    "p08-b1": { "span": 2 },
    "p09-b0": { "maxHeightRatio": 0.7 }
  }
}
```

Pass it with `--layout layout.json`; CLI options win over the file. `overrides` adjust a single page or block: switch a page to a single column, make a block a full-width band (`span: 2`) or keep it in a column (`span: 1`), cap a figure's height.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--page` | `a4` | `a4` / `a4-landscape` / `a3` / `a3-landscape` / `16x9` / `4x3` |
| `--font-size` | A4 11pt, A3 12pt, slides 14pt | Body size in `pt`, `px` or `mm`; every other dimension derives from it |
| `--font-family` | BIZ UDPGothic, then Hiragino, Noto Sans JP | CSS font-family list for body text and diagram labels, e.g. `"'Noto Sans JP', sans-serif"`. Recorded in the file. Prefer fonts Chromium can embed in PDF: static (non-variable) glyf TrueType such as BIZ UD or the static Noto Sans JP TTFs. The CFF-based Hiragino is replaced by a 2 MB Osaka-Mono in the PDF, and a variable font is converted to outlines (large PDF, text not selectable) |
| `--code-font-family` | SFMono, Menlo, BIZ UDGothic | CSS font-family list for code and inline code. Keep a CJK-capable monospace in the list, or Japanese inside code falls back to Osaka-Mono in the PDF |
| `--no-embed-fonts` | off (fonts embedded) | Do not embed the BIZ UD subsets. By default the file carries `@font-face` subsets of BIZ UDPGothic (Regular and Bold) and BIZ UDGothic (Regular) covering only the characters the document uses, so viewers need no font installed and the PDF embeds the same subsets. A 15-page Japanese deck adds about 0.3 MB; see the fonts section below |
| `--title-scale` | `1.25` | Slide header title size relative to body |
| `--header-title` | `section` | `section` (current h2), `doc` (document h1) or `fixed:<text>` |
| `--columns` | landscape `two`, portrait `single` | `two` (column order, left column then right, with full-width bands), `split` (one figure beside the text), `single` |
| `--figure-side` | `right` | Figure column side in `split` layout |
| `--split-ratio` | `0.5` | Text column fraction in `split` layout (0.4 to 0.6) |
| `--details` | `drop` | `<details>` handling; Mermaid sources inside folds are always rescued |
| `--mermaid-lib` | `prerender` | `prerender`: diagrams are written as SVG and no library is shipped (a deck with five diagrams is about 0.3 to 0.5 MB); `embed`: inline Mermaid.js so the browser draws the diagrams (about 3 MB); `link`: reference a sibling `mermaid-<version>.min.js` |
| `--mermaid-version` | newest vendored | Vendored Mermaid version to render with (`X.Y.Z`). A generated HTML records the version it was paginated with and is rebuilt with that same version; see `THIRD_PARTY_NOTICES.md` for adding versions |
| `--hr-break` | off | Treat `---` as a page break in slide formats |
| `--embed-images` | off | Inline images as data URIs |
| `--date` | today | Footer date, or `none` |
| `--pptx PATH` | | `build`: also write a PPTX. Each page becomes one image slide at the page size; every `<a href>` becomes an invisible clickable hotspot |
| `--pptx-dpi N` | `200` | Slide image resolution |
| `--pptx-image` | `jpg` | `jpg` (smaller) or `png` (crisper) slide images |
| `--pptx-text` | off | Add a transparent selectable-text layer (searchable, copyable; some viewers show it as faint doubled text) |
| `--pptx-no-links` | off | Skip the link hotspots |
| `--report PATH` | | Write the capacity report as JSON |
| `--reflow` | | `build`: re-paginate from scratch. With a `.gospelo.json` input it rewrites the JSON and exits; with a `.gospelo.html` input it rebuilds the file |
| `--no-write-back` | | `build`: do not write spills back to a `.gospelo.json` input |

`check` and `build` take a `.gospelo.html` or a `.gospelo.json`. The layout recorded in the file is the default and `--layout` / CLI options override it; `build out.gospelo.html` rewrites the same file by default, and `build out.gospelo.json` writes `out.gospelo.html`.

### Fonts: embedded subsets

The generated HTML carries its Japanese fonts. `import` and `build` collect the characters the document uses and write subsets of the bundled BIZ UD fonts (SIL Open Font License) into the `<style>` block as `@font-face` data URIs: BIZ UDPGothic Regular for body text, BIZ UDPGothic Bold for headings, table headers and `**bold**` only, and BIZ UDGothic Regular for code only. The same subsets are used while measuring, so pagination does not depend on the fonts installed on the building machine, and a reader on macOS, Windows or Linux sees the same glyphs without installing anything. The cost is size: a 15-page 16:9 deck grew from 0.46 MB to 0.77 MB, and its PDF shrank from 0.40 MB to 0.24 MB because Chromium embeds the subsets instead of a system font.

Only the bundled families are embedded. If `--font-family` names another font, that font must be installed wherever the file is viewed. `--no-embed-fonts` (layout `embedFonts: false`) turns embedding off, for example when the file is only viewed on machines that have BIZ UD installed. Latin text still comes from the first installed font in the stack (`-apple-system`, Helvetica Neue) when there is one, and from BIZ UDPGothic otherwise.

### PPTX export: what you get and what you do not

`--pptx` produces **fixed-appearance slides**: each page is one picture, rendered by the same Chromium that verified the layout, so the deck looks exactly like the HTML and the PDF, on any machine. It is a delivery format, not an editing format.

Use it when:

- the recipient can only open `.pptx` (submission portals, corporate viewers, Teams or SharePoint previews), but you want the layout and fonts to survive untouched. PowerPoint substitutes missing fonts, which reshapes Japanese text in particular; a picture does not change;
- you hand over a final proposal or design comp and do not want the text moved or restyled;
- you need a slide show (projection with page transitions) rather than a PDF.

Do not use it when the recipient needs to edit text, tables or diagrams in PowerPoint: nothing on these slides is editable. Edit the `.gospelo.html` and run `build` again instead. Other limits: about 100 to 200 KB per slide at the default 200 dpi (`--pptx-dpi 150` halves it); screen readers and search see nothing unless `--pptx-text` adds the transparent text layer, which some viewers (Slack previews, Google Slides) show as faint doubled text; hyperlinks work as invisible clickable areas.

A native, editable PPTX (text boxes and tables placed from the measured layout) is planned as a separate mode; the block model and measured geometry already exist for it.

Exit codes: `0` success (spills included), `1` input or dependency error, `2` verification did not converge.

## Installing as an Agent Skill

This repository ships an [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) at `skills/claude/gospelo-md2html/`. It uses only the portable core of the open [Agent Skills standard](https://github.com/agentskills/agentskills), so it works with **Claude Code, GitHub Copilot, OpenAI Codex, and OpenCode**.

`scripts/install.py` copies (or symlinks) the skill into the discovery paths those agents scan, `.claude/skills/` and `.agents/skills/`:

```bash
git clone https://github.com/gospelo-dev/md2html.git
INSTALL=md2html/skills/claude/gospelo-md2html/scripts/install.py

python $INSTALL --project /path/to/repo      # into a project
python $INSTALL --user                       # user-wide
python $INSTALL --user --symlink             # development: symlink back to this clone
python $INSTALL --project /path/to/repo --force
```

Then, once per machine: `uv run .claude/skills/gospelo-md2html/scripts/md2html.py setup`.

Agents discover the skill via [SKILL.md](https://github.com/gospelo-dev/md2html/blob/main/skills/claude/gospelo-md2html/SKILL.md) and trigger it when you say things like *"convert this Markdown to A4 PDF"*, *"make slides from this doc"*, or *"add a row to the table on page 5"*. SKILL.md tells the agent to dry-run first, edit only the JSON, check capacity before building, and screenshot the result before reporting.

OpenCode needs no separate copy; see [skills/opencode/README.md](https://github.com/gospelo-dev/md2html/blob/main/skills/opencode/README.md).

### Distributing as a ZIP

```bash
cd md2html/skills/claude
zip -r gospelo-md2html.zip gospelo-md2html -x "*__pycache__*" -x "*.DS_Store"
```

The recipient unzips it and runs `python gospelo-md2html/scripts/install.py --project /path/to/repo`.

## How pagination works

- Heights come from a measurement pass: every block is rendered in a hidden flow container at the text column width (and at full width for landscape formats), and Chromium reports block, row, item and line heights.
- Pages are filled greedily to 98% of the content height. Headings reserve room for the following lines (or the whole figure) so they never end a page. Tables split at row boundaries with the header repeated and never leave fewer than three rows; code splits only above 15 lines; paragraphs split at measured line boundaries with the inline Markdown re-serialised on both sides.
- Landscape formats use two columns in column order (down the left column, then the right); tables with four or more columns, code and wide figures become full-width bands, and a figure that does not fit the left column floats to the top of an empty right column.
- A verify pass opens the final HTML, measures each page again, and spills anything that still overflows. `build` keeps your page boundaries and only ever moves content forward into `(continued)` pages.

The design documents behind these rules (page formats, layout logic, content model, decisions) live in the maintainers' working directory and are summarised in the skill's `references/`.

## Repository layout

```
md2html/
├── skills/
│   ├── claude/
│   │   └── gospelo-md2html/
│   │       ├── SKILL.md                 # Agent Skill definition and workflow
│   │       ├── scripts/
│   │       │   ├── md2html.py           # CLI (PEP 723 metadata; run with uv)
│   │       │   ├── md2html/             # blocks, inline, paginate, measure, render, content, layout,
│   │       │   │                        # fonts (embedded subsets), pptx_export, assets, scale, formats, report
│   │       │   ├── extract_markdown.py  # Migration: pull the Markdown out of any file the tool wrote
│   │       │   └── install.py           # Installer for agent discovery paths
│   │       └── references/
│   │           ├── base.css             # Page frame and typography (CSS variables)
│   │           ├── figures.js           # Browser-side Mermaid rendering and figure sizing
│   │           ├── gospelo-document.schema.json  # Envelope schema (the file format)
│   │           ├── layout.schema.json   # Layout JSON schema (--layout files)
│   │           ├── page_formats.md      # Paper sizes, margins, defaults
│   │           ├── layout_rules.md      # Pagination rules
│   │           ├── editing_guide.md     # How an agent edits the envelope
│   │           ├── color-scheme.md      # Mermaid palette used in the docs' diagrams
│   │           └── vendor/              # Mermaid.js (per version), Shiki, Font Awesome Free, BIZ UD fonts (see THIRD_PARTY_NOTICES.md)
│   └── opencode/README.md               # How OpenCode picks up the same skill
├── tests/                               # pytest: pagination and two columns, inline split, envelope I/O, migration,
│                                        # Mermaid vendoring and prerender, PPTX export, fonts
├── docs/                                # QUICKSTART, DESIGN, ARCHITECTURE, MIGRATION (en/ja), spec/gospelo-document
├── assets/                              # README hero image; design/ holds the DESIGN figures and the script that draws them
├── THIRD_PARTY_NOTICES.md               # Licenses of the vendored assets and runtime dependencies
└── LICENSE
```

Run the tests with `uv run --with pytest --with markdown-it-py --with mdit-py-plugins --with python-pptx --with fonttools --with brotli pytest -q tests`.

## License

[MIT](https://github.com/gospelo-dev/md2html/blob/main/LICENSE). Vendored assets: see [THIRD_PARTY_NOTICES.md](https://github.com/gospelo-dev/md2html/blob/main/THIRD_PARTY_NOTICES.md).
