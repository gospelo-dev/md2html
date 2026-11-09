# gospelo-md2html

[![License: MIT](https://img.shields.io/badge/License-MIT-1E90FF.svg?style=flat)](./LICENSE) [![Node.js](https://img.shields.io/badge/Node.js-22.12+-1E90FF.svg?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Puppeteer](https://img.shields.io/badge/Puppeteer-chrome--headless--shell-2EAD33.svg?style=flat&logo=puppeteer&logoColor=white)](https://pptr.dev/) [![Mermaid](https://img.shields.io/badge/Mermaid-12-FF3670.svg?style=flat&logo=mermaid&logoColor=white)](https://mermaid.js.org/) [![Agent Skill](https://img.shields.io/badge/Agent_Skill-Claude_Code,_Copilot,_Codex,_OpenCode-7B3FF2.svg?style=flat)](https://docs.claude.com/en/docs/claude-code/skills)

<p align="center"><img src="https://github.com/gospelo-dev/md2html/blob/main/assets/hero.jpg?raw=true" alt="gospelo-md2html: Markdown + Mermaid to paginated slides and documents, editable JSON, original kept" width="820"></p>

Turn Markdown + Mermaid into **layout-aware, paginated slide decks and documents** as **one self-contained HTML file**, with PDF and PPTX output as well. The HTML is a file that an **AI agent can edit and rebuild as it is**, and it **keeps the original Markdown inside**. The name says HTML; the HTML is the master document, and every other format is produced from it. This is not a plain Markdown-to-HTML converter.

日本語版: [README_ja.md](./README_ja.md)

Most Markdown-to-PDF tools flow text into a browser's print engine and hope for the best: headings land at the bottom of a page, tables split anywhere, diagrams shrink or overflow, and once the HTML exists nobody can adjust a single page without regenerating everything. This skill is built around three things:

1. **Layout-aware pagination.** `import` renders every block in headless Chrome (chrome-headless-shell) to get real heights and paginates with typographic rules (keep headings with their text, split tables at rows and repeat the header, two columns on landscape paper) into 16:9 / 4:3 slides or A4 / A3 documents.
2. **Editable by an AI.** The output is one `.gospelo.html` (a **Gospelo Document**) whose content sits at the top of the file as JSON: one object per page, text as inline Markdown, tables as `header` + `rows`, Mermaid as source. An agent edits the page in question and runs `build` on that same file. Anything that no longer fits is spilled to a continuation page with the same title, and the JSON always matches the rendered pages.
3. **The original is preserved.** The Markdown as imported is kept verbatim inside the file; `restore` gets it back at any time, and a fresh `import` from it undoes every edit.

Layout never lives in the content: paper size, margins, font scale, column split and figure side come from CLI options or a separate layout JSON. Mermaid diagrams are drawn during the build by [mermaid-arch](https://github.com/gospelo-dev/mermaid-arch) (Mermaid 12, ELK layout, AWS architecture icons) and written into the file as SVG, while their source stays in the envelope, so they remain editable and the file stays small (no Mermaid library inside).

New here? See the [Quickstart](./docs/QUICKSTART.md) ([日本語](./docs/QUICKSTART_ja.md)). The typographic rules and their sources are in [docs/DESIGN.md](./docs/DESIGN.md), the single-file design in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), and the file format in [docs/spec/gospelo-document.md](./docs/spec/gospelo-document.md).

## What you get

| Feature | Detail |
| --- | --- |
| Paper sizes | `a4`, `a4-landscape`, `a3`, `a3-landscape` (documents) and `16x9`, `4x3` (slides) |
| One knob for typography | Everything (headings, tables, code, margins, footer size) derives from `--font-size` |
| Slides | One slide per `h2`; the heading moves into a header band at 1.25x body size, continuation slides are marked |
| Two columns | Landscape formats flow blocks in column order (down the left column, then the right); wide tables and wide figures become full-width bands. Portrait formats are single column. `split` (one figure beside the text) is also available |
| Code blocks | Syntax-highlighted with Shiki when the fence names a language (JSON, bash, YAML, Python, JS/TS, HTML, CSS, SQL, TOML, Markdown, diff, Dockerfile). Colors are written into the file as static markup; no highlighter is shipped. In two-column layouts code sits in one column at 0.6x body size, otherwise 0.85x |
| Tall diagrams | A tall Mermaid flowchart that would shrink to unreadable size is cut between nodes and laid out as 2 to 4 side-by-side columns inside one SVG |
| Architecture diagrams | Diagrams can use AWS Architecture Icons (`fn@{ icon: "aws:lambda", form: "square", label: "Handler" }`, or `architecture-beta`) from your own AWS icon zip (`--icons-zip`). Only the drawn SVG goes into the file; the icon pack itself is never written out |
| Real measurement | Heights are measured in chrome-headless-shell (puppeteer-core), never estimated; a verify pass checks every page for overflow |
| Editable content | Page-scoped JSON; table rows, list items and Mermaid source are plain data |
| Auto spill | Content that stops fitting after an edit moves to a `(continued)` page; nothing is deleted or forced |
| Gospelo Document | One `.gospelo.html` carries its content, layout and original Markdown in an envelope at the top of the file; `check`, `build` and `restore` work from that file alone, so one file is all an editor (or an agent) needs. An optional `.gospelo.json` sidecar holds the same envelope |
| Original preserved | The Markdown as imported is kept verbatim as page 0 of the envelope; `restore` gets it back |
| Report | Per-page used / remaining height, row and item heights, figure scale, warnings, and planned spills |
| PDF and PPTX | `build --pdf` prints through the same browser at the page size; `build --pptx` writes a fixed-appearance PowerPoint deck: one image slide per page (same rendering), invisible link hotspots, optional transparent selectable-text layer. Not editable in PowerPoint; see "PPTX export" below |

## Prerequisites

Supported platforms: **macOS / Linux / WSL2**

| Dependency | Install |
| --- | --- |
| [Node.js](https://nodejs.org/) 22.12+ (with npm) | md2html is TypeScript, bundled as `scripts/md2html.mjs` |
| [uv](https://docs.astral.sh/uv/) (optional) | `curl -LsSf https://astral.sh/uv/install.sh \| sh`. `scripts/md2html.py` is a thin wrapper with no dependencies that runs `md2html.mjs`; `python3` works as well |
| npm packages and chrome-headless-shell | one-time: `uv run <skill>/scripts/md2html.py setup` (runs `npm ci --omit=dev`, then installs the chrome-headless-shell version puppeteer-core expects into puppeteer's cache) |
| AWS Architecture Icons zip (only for `aws:` icons) | download `Icon-package_*.zip` from https://aws.amazon.com/architecture/icons/ and pass it with `--icons-zip` |

mermaid-arch (with Font Awesome Free), Shiki (syntax highlighting) and the BIZ UD fonts are vendored in the skill. Mermaid 12 is not: its bundle includes elkjs (EPL-2.0), which this repository does not carry, so `setup` installs it from the npm registry together with the other npm packages, once; nothing else is downloaded at run time (see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)). The browser is taken from `--chrome PATH`, then `CHROME_PATH`, then `PUPPETEER_EXECUTABLE_PATH`, then puppeteer's cache.

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

# Diagrams with AWS icons: pass your AWS icon zip to every import / check / build of that document
uv run $S import docs/architecture.md --page 16x9 --icons-zip "<path to Icon-package_*.zip>"

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

Adding a gate is one more array in `rows`. Text cells keep inline Markdown (`**bold**`, `` `code` ``, `[link](url)`). Block types: `heading`, `paragraph`, `list`, `table`, `code`, `image`, `mermaid`, `quote`, `html`, `pagebreak`. The envelope schema is [references/gospelo-document.schema.json](./skills/claude/gospelo-md2html/references/gospelo-document.schema.json); the format is specified in [docs/spec/gospelo-document.md](./docs/spec/gospelo-document.md). Files written before 0.2.0 are not read; see [docs/MIGRATION.md](./docs/MIGRATION.md).

### Layout JSON (optional)

```json
{
  "page": "16x9",
  "fontSize": "14pt",
  "titleScale": 1.25,
  "columns": "two",
  "overrides": {
    "p07": { "columns": "single" },
    "p08": { "columns": "split", "splitRatio": 0.4, "gutter": "3em" },
    "p08-b1": { "span": 2 },
    "p09-b0": { "maxHeightRatio": 0.7 }
  }
}
```

Pass it with `--layout layout.json`; CLI options win over the file. `overrides` adjust a single page or block: switch a page to a single column or give it its own split ratio and column gap (`columns`, `figureSide`, `splitRatio`, `gutter`), make a block a full-width band (`span: 2`) or keep it in a column (`span: 1`), cap a figure's height. A page with its own column widths is measured again at those widths, and its continuation pages keep its settings.

### Per-section layout in the Markdown

A comment on the line right after a heading lays out that heading's section (up to the next heading of the same or a higher level; on slides, that slide and its continuations). A new page starts where the layout changes, and `import` records the settings as the overrides of the section's pages:

```markdown
## Architecture
<!-- layout: columns=single -->

## Pricing
<!-- layout: columns=split split-ratio=0.4 gutter=3em figure-side=left -->
```

Keys: `columns`, `split-ratio`, `gutter`, `figure-side`. A comment that is not right after a heading, a comment inside a paragraph, or an unknown key or value stops the import. `columns=single` suits a wide figure: it takes the full width above the text.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--page` | `a4` | `a4` / `a4-landscape` / `a3` / `a3-landscape` / `16x9` / `4x3` |
| `--font-size` | A4 11pt, A3 12pt, slides 14pt | Body size in `pt`, `px` or `mm`; every other dimension derives from it |
| `--font-family` | BIZ UDPGothic, then Hiragino, Noto Sans JP | CSS font-family list for body text and diagram labels, e.g. `"'Noto Sans JP', sans-serif"`. Recorded in the file. Prefer fonts Chrome can embed in PDF: static (non-variable) glyf TrueType such as BIZ UD or the static Noto Sans JP TTFs. The CFF-based Hiragino is replaced by a 2 MB Osaka-Mono in the PDF, and a variable font is converted to outlines (large PDF, text not selectable) |
| `--code-font-family` | SFMono, Menlo, BIZ UDGothic | CSS font-family list for code and inline code. Keep a CJK-capable monospace in the list, or Japanese inside code falls back to Osaka-Mono in the PDF |
| `--no-embed-fonts` | off (fonts embedded) | Do not embed the BIZ UD subsets. By default the file carries `@font-face` subsets of BIZ UDPGothic (Regular and Bold) and BIZ UDGothic (Regular) covering only the characters the document uses, so viewers need no font installed and the PDF embeds the same subsets. A 15-page Japanese deck adds about 0.3 MB; see the fonts section below |
| `--title-scale` | `1.25` | Slide header title size relative to body |
| `--header-title` | `section` | `section` (current h2), `doc` (document h1) or `fixed:<text>` |
| `--columns` | landscape `two`, portrait `single` | `two` (column order, left column then right, with full-width bands), `split` (one figure beside the text), `single` |
| `--figure-side` | `right` | Figure column side in `split` layout |
| `--split-ratio` | `0.5` | Text column fraction in `split` layout (0.4 to 0.6; 0.4 gives text 2 : figure 3) |
| `--gutter` | `2em` | Gap between columns in `two` and `split` layouts: `em` (times the body size), `px`, `mm` or `pt`, at most 20% of the content width. Recorded in the file. Before 0.8 the gap was 1.5em; files from 0.7 that record no gutter are rebuilt with 2em unless you pass `--gutter 1.5em` |
| `--details` | `drop` | `<details>` handling; Mermaid sources inside folds are always rescued |
| `--icons-zip PATH` | | `import` / `check` / `build`: the AWS Architecture Icons zip (`Icon-package_*.zip`). Required when a diagram uses `aws:` icons; without it the command stops (`icons-zip-missing`) and shows the fix. The path is not recorded in the file, so pass it on every build |
| `--chrome PATH` | | chrome-headless-shell executable (default: `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, then puppeteer's cache) |
| `--mermaid-lib` | `prerender` | The only mode: diagrams are written as SVG drawn by mermaid-arch and no library is shipped. Documents written with `embed` or `link` by earlier releases stop with an error; rebuild them with `--mermaid-lib prerender` |
| `--mermaid-version` | the version mermaid-arch draws with | The file records the Mermaid version it was paginated with. A document paginated with another version (for example 11.12.2 from the Python releases) stops with an error, because diagram sizes and page breaks may change; rebuild with `--mermaid-version 12.3.0` to accept that. Mermaid 12 lays flowcharts out with ELK unless the diagram sets `layout: dagre` |
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

The generated HTML carries its Japanese fonts. `import` and `build` collect the characters the document uses and write subsets of the bundled BIZ UD fonts (SIL Open Font License) into the `<style>` block as `@font-face` data URIs: BIZ UDPGothic Regular for body text, BIZ UDPGothic Bold for headings, table headers and `**bold**` only, and BIZ UDGothic Regular for code only. The same subsets are used while measuring, so pagination does not depend on the fonts installed on the building machine, and a reader on macOS, Windows or Linux sees the same glyphs without installing anything. The cost is size: a 15-page 16:9 deck grew from 0.46 MB to 0.77 MB, and its PDF shrank from 0.40 MB to 0.24 MB because Chrome embeds the subsets instead of a system font. The page mermaid-arch draws diagrams in gets the same subsets, so diagram labels are measured with the fonts the document shows. When a diagram label uses `fa:` icons, the file also carries Font Awesome Free (all styles, fonts as data URIs, about 0.5 MB).

Only the bundled families are embedded. If `--font-family` names another font, that font must be installed wherever the file is viewed. `--no-embed-fonts` (layout `embedFonts: false`) turns embedding off, for example when the file is only viewed on machines that have BIZ UD installed. Latin text still comes from the first installed font in the stack (`-apple-system`, Helvetica Neue) when there is one, and from BIZ UDPGothic otherwise.

### PPTX export: what you get and what you do not

`--pptx` produces **fixed-appearance slides**: each page is one picture, rendered by the same browser that verified the layout, so the deck looks exactly like the HTML and the PDF, on any machine. It is a delivery format, not an editing format.

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

Then, once per installed copy: `uv run .claude/skills/gospelo-md2html/scripts/md2html.py setup`. The installer does not copy `node_modules`; `setup` installs the npm packages from the bundled `package-lock.json` (mermaid-arch comes from the tarball in the skill's `vendor/`, so no GitHub access is needed; Mermaid 12.3.0 comes from the public npm registry) and chrome-headless-shell.

Agents discover the skill via [SKILL.md](./skills/claude/gospelo-md2html/SKILL.md) and trigger it when you say things like *"convert this Markdown to A4 PDF"*, *"make slides from this doc"*, or *"add a row to the table on page 5"*. SKILL.md tells the agent to dry-run first, edit only the JSON, check capacity before building, and screenshot the result before reporting.

OpenCode needs no separate copy; see [skills/opencode/README.md](./skills/opencode/README.md).

### Distributing as a ZIP

```bash
cd md2html/skills/claude
zip -r gospelo-md2html.zip gospelo-md2html -x "*__pycache__*" -x "*.DS_Store" -x "*node_modules*"
```

The recipient unzips it, runs `python gospelo-md2html/scripts/install.py --project /path/to/repo`, then `setup` in the installed copy.

## How pagination works

- Heights come from a measurement pass: every block is rendered in a hidden flow container at the text column width (and at full width for landscape formats), and the browser reports block, row, item and line heights. Mermaid diagrams are drawn by mermaid-arch first, in its own page of the same browser, and measured as SVG.
- Pages are filled greedily to 98% of the content height. Headings reserve room for the following lines (or the whole figure) so they never end a page. Tables split at row boundaries with the header repeated and never leave fewer than three rows; code splits only above 15 lines; paragraphs split at measured line boundaries with the inline Markdown re-serialised on both sides.
- Landscape formats use two columns in column order (down the left column, then the right); tables with four or more columns and wide figures become full-width bands, and a figure that does not fit the left column floats to the top of an empty right column. The columns above a band are balanced to end at the same height, moving whole blocks only; at the end of a page or section the left column simply fills first.
- A verify pass opens the final HTML, measures each page again, and spills anything that still overflows. `build` keeps your page boundaries and only ever moves content forward into `(continued)` pages.

The design documents behind these rules (page formats, layout logic, content model, decisions) live in the maintainers' working directory and are summarised in the skill's `references/`.

## Repository layout

```
md2html/
├── skills/
│   ├── claude/
│   │   └── gospelo-md2html/
│   │       ├── SKILL.md                 # Agent Skill definition and workflow
│   │       ├── package.json, package-lock.json, tsconfig.json
│   │       ├── src/                     # TypeScript: cli, blocks, inline, markdown, paginate, measure, render,
│   │       │                            # content, layout, fonts, mermaid (mermaid-arch), pptx, assets, scale, formats, report
│   │       ├── vendor/                  # gospelo-mermaid-arch-<version>-<commit>.tgz and its provenance note
│   │       ├── scripts/
│   │       │   ├── md2html.mjs          # The CLI, bundled from src/ with esbuild (committed; npm run build)
│   │       │   ├── md2html.py           # Thin wrapper: finds node and runs md2html.mjs (setup: npm ci + browser)
│   │       │   ├── kumihan/             # Typesetting engine for h1 headings (work in progress; not used by md2html yet)
│   │       │   ├── extract_markdown.py  # Migration: pull the Markdown out of any file the tool wrote
│   │       │   └── install.py           # Installer for agent discovery paths
│   │       └── references/
│   │           ├── base.css             # Page frame and typography (CSS variables)
│   │           ├── figures.js           # Browser side: figure sizing, column split of tall flowcharts, Shiki
│   │           ├── gospelo-document.schema.json  # Envelope schema (the file format)
│   │           ├── layout.schema.json   # Layout JSON schema (--layout files)
│   │           ├── page_formats.md      # Paper sizes, margins, defaults
│   │           ├── layout_rules.md      # Pagination rules
│   │           ├── editing_guide.md     # How an agent edits the envelope
│   │           ├── color-scheme.md      # Mermaid palette used in the docs' diagrams
│   │           └── vendor/              # Shiki, BIZ UD fonts (see THIRD_PARTY_NOTICES.md)
│   └── opencode/README.md               # How OpenCode picks up the same skill
├── tests/
│   ├── ts/                              # node --test: pagination and two columns, inline split, envelope I/O,
│   │   │                                # layout names, PPTX export, fonts
│   │   └── browser/                     # the CLI end to end in chrome-headless-shell (run locally, not in CI)
│   ├── kumihan/, test_extract_markdown.py  # pytest: the Python parts that remain
│   └── fixtures/
├── .github/workflows/ci.yml             # CI: the node tests without a browser (and a check that md2html.mjs matches src/), pytest
├── docs/                                # QUICKSTART, DESIGN, ARCHITECTURE, MIGRATION (en/ja), spec/gospelo-document
├── assets/                              # README hero image; design/ holds the DESIGN figures and the script that draws them
├── THIRD_PARTY_NOTICES.md               # Licenses of the vendored assets and runtime dependencies
└── LICENSE
```

Run the tests:

```bash
# TypeScript (Node 22.18+, which runs the .ts tests directly). npm test runs every test,
# including tests/ts/browser, which CI skips: on the GitHub Ubuntu runner Chrome cannot
# build its sandbox without lifting a kernel restriction, which the workflow does not do.
cd skills/claude/gospelo-md2html && npm ci && node scripts/md2html.mjs setup && npm test && cd -
# set MD2HTML_TEST_ICONS_ZIP to an AWS icon zip to also run the aws: icon test

# Python (kumihan and extract_markdown.py), as CI runs it
uv run --python 3.14.9 \
  --with pytest --with brotli \
  --with fonttools==4.65.0 --with uharfbuzz==0.56.2 --with budoux==0.9.2 --with resvg-py \
  pytest -q tests/kumihan tests/test_extract_markdown.py
```

After changing `src/`, run `npm run build` and commit `scripts/md2html.mjs` with it; CI checks that the two match.

The kumihan golden SVGs record the Python and library versions they were generated with, so those versions are pinned; after upgrading one, regenerate the goldens with `pytest tests/kumihan --update-golden`.

## License

[MIT](./LICENSE). Vendored assets: see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
