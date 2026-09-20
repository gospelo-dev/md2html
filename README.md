# gospelo-md2html

[![License: MIT](https://img.shields.io/badge/License-MIT-1E90FF.svg?style=flat)](https://github.com/gospelo-dev/md2html/blob/main/LICENSE) [![Python](https://img.shields.io/badge/Python-3.10+-1E90FF.svg?style=flat&logo=python&logoColor=white)](https://www.python.org/) [![uv](https://img.shields.io/badge/run_with-uv-DE5FE9.svg?style=flat)](https://docs.astral.sh/uv/) [![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33.svg?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/python/) [![Mermaid](https://img.shields.io/badge/Mermaid-11-FF3670.svg?style=flat&logo=mermaid&logoColor=white)](https://mermaid.js.org/) [![Agent Skill](https://img.shields.io/badge/Agent_Skill-Claude_Code,_Copilot,_Codex,_OpenCode-7B3FF2.svg?style=flat)](https://docs.claude.com/en/docs/claude-code/skills)

<p align="center"><img src="https://github.com/gospelo-dev/md2html/blob/main/assets/hero.jpg?raw=true" alt="gospelo-md2html: Markdown + Mermaid to paginated slides and documents, editable JSON, original kept" width="820"></p>

Turn Markdown + Mermaid into **layout-aware, paginated HTML slide decks and documents** that an **AI agent can edit and rebuild as they are**, and that **keep the original Markdown inside**. This is not a plain Markdown-to-HTML converter.

日本語版: [README_ja.md](https://github.com/gospelo-dev/md2html/blob/main/README_ja.md)

Most Markdown-to-PDF tools flow text into a browser's print engine and hope for the best: headings land at the bottom of a page, tables split anywhere, diagrams shrink or overflow, and once the HTML exists nobody can adjust a single page without regenerating everything. This skill is built around three things:

1. **Layout-aware pagination.** `import` renders every block in headless Chromium to get real heights and paginates with typographic rules (keep headings with their text, split tables at rows and repeat the header, two columns on landscape paper) into 16:9 / 4:3 slides or A4 / A3 documents.
2. **Editable by an AI.** Content lives in a **content JSON** (one object per page, text as inline Markdown, tables as `header` + `rows`, Mermaid as source) that is also embedded in the generated HTML. An agent edits the page in question and runs `build`; it can do the same when all it has is the HTML file. Anything that no longer fits is spilled to a continuation page with the same title, and the JSON always matches the output.
3. **The original is preserved.** The Markdown as imported is kept verbatim inside the JSON and the HTML; `restore` gets it back at any time, and a fresh `import` from it undoes every edit.

Layout never lives in the content: paper size, margins, font scale, column split and figure side come from CLI options or a separate layout JSON. Mermaid is rendered in the browser by an embedded Mermaid.js, so diagrams stay editable all the way to the final file.

New here? See the [Quickstart](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART.md) ([日本語](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART_ja.md)). The typographic rules behind the layout (font-size scale, margins, columns, figure placement) are explained in [docs/design/design_theory.md](https://github.com/gospelo-dev/md2html/blob/main/docs/design/design_theory.md) (Japanese), which is itself built with this skill into a 16:9 deck.

## What you get

| Feature | Detail |
| --- | --- |
| Paper sizes | `a4`, `a4-landscape`, `a3`, `a3-landscape` (documents) and `16x9`, `4x3` (slides) |
| One knob for typography | Everything (headings, tables, code, margins, footer size) derives from `--font-size` |
| Slides | One slide per `h2`; the heading moves into a header band at 1.25x body size, continuation slides are marked |
| Two columns | Landscape formats flow blocks down the left column, then the right (N order); wide tables, code and wide figures become full-width bands. Portrait formats are single column. `split` (one figure beside the text) is also available |
| Real measurement | Heights are measured in Chromium (Playwright), never estimated; a verify pass checks every page for overflow |
| Editable content | Page-scoped JSON; table rows, list items and Mermaid source are plain data |
| Auto spill | Content that stops fitting after an edit moves to a `(continued)` page; nothing is deleted or forced |
| Self-contained HTML | The HTML embeds its own content JSON and layout; `check out.html` / `build out.html` verify and regenerate it from that alone, so one file is all an editor (or an agent) needs |
| Original preserved | The Markdown as imported is kept verbatim as page 0 inside the JSON and inside the HTML; `restore` gets it back |
| Report | Per-page used / remaining height, row and item heights, figure scale, warnings, and planned spills |

## Prerequisites

Supported platforms: **macOS / Linux / WSL2**

| Dependency | Install |
| --- | --- |
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.10+, markdown-it-py, Playwright | resolved automatically by `uv run` from the script's inline metadata (no `pip`, no venv) |
| Chromium | one-time: `uv run <skill>/scripts/md2html.py setup` |

Mermaid.js and Font Awesome Free are vendored in the skill; nothing else is downloaded at run time.

## Usage example

```bash
S=skills/claude/gospelo-md2html/scripts/md2html.py

# 0. First run only
uv run $S setup

# 1. Markdown -> content JSON, paginated for 16:9 slides at 14pt (dry-run shows pages and warnings first)
uv run $S import docs/handover.md -o out/handover.json --page 16x9 --font-size 14pt --dry-run
uv run $S import docs/handover.md -o out/handover.json --page 16x9 --font-size 14pt

# 2. Edit out/handover.json (add a row to a table on page p05, say), then see what will spill
uv run $S check out/handover.json --page 16x9 --font-size 14pt --report out/report.json

# 3. Build HTML + PDF. Overflow is spilled to continuation pages and written back to the JSON.
uv run $S build out/handover.json -o out/handover.html --page 16x9 --font-size 14pt --pdf out/handover.pdf

# Roll back to the original Markdown at any time (from the JSON or the HTML)
uv run $S restore out/handover.html -o out/handover.original.md

# Got only the HTML? It carries its content JSON and layout: edit the
# <script type="application/json" id="md2html-content"> block, then rebuild in place
uv run $S check out/handover.html
uv run $S build out/handover.html --pdf out/handover.pdf
```

Paper and font size are pagination inputs, so pass them to `import` as well. To change them later, run `build --reflow` to re-paginate everything.

### Content JSON

One page of a 16:9 deck:

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

Adding a gate is one more array in `rows`. Text cells keep inline Markdown (`**bold**`, `` `code` ``, `[link](url)`). Block types: `heading`, `paragraph`, `list`, `table`, `code`, `image`, `mermaid`, `quote`, `html`, `pagebreak`. The schema is in [references/content.schema.json](https://github.com/gospelo-dev/md2html/blob/main/skills/claude/gospelo-md2html/references/content.schema.json).

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
| `--title-scale` | `1.25` | Slide header title size relative to body |
| `--header-title` | `section` | `section` (current h2), `doc` (document h1) or `fixed:<text>` |
| `--columns` | landscape `two`, portrait `single` | `two` (N-order columns with full-width bands), `split` (one figure beside the text), `single` |
| `--figure-side` | `right` | Figure column side in `split` layout |
| `--split-ratio` | `0.5` | Text column fraction in `split` layout (0.4 to 0.6) |
| `--details` | `drop` | `<details>` handling; Mermaid sources inside folds are always rescued |
| `--mermaid-lib` | `embed` | `embed` Mermaid.js into the HTML (single file, about 3MB) or `link` it as a sibling `mermaid-<version>.min.js` |
| `--mermaid-version` | newest vendored | Vendored Mermaid version to render with (`X.Y.Z`). A generated HTML records the version it was paginated with and is rebuilt with that same version; see `THIRD_PARTY_NOTICES.md` for adding versions |
| `--hr-break` | off | Treat `---` as a page break in slide formats |
| `--embed-images` | off | Inline images as data URIs |
| `--date` | today | Footer date, or `none` |
| `--report PATH` | | Write the capacity report as JSON |
| `--reflow` | | `build`: re-paginate from scratch. With a JSON input it rewrites the JSON and exits; with an HTML input it rebuilds the HTML |
| `--no-write-back` | | `build`: do not write spills back to the JSON (JSON input only) |

`check` and `build` accept either a content JSON or an HTML produced by `build`. With an HTML input the embedded layout becomes the default and `--layout` / CLI options override it; `build out.html` writes back to the same file by default.

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
- Landscape formats reserve a figure slot per page; the first `image` or `mermaid` block goes there and the text flows beside it. Pages without a figure use the full width.
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
│   │       │   ├── md2html/             # blocks, inline, paginate, measure, render, ...
│   │       │   └── install.py           # Installer for agent discovery paths
│   │       └── references/
│   │           ├── base.css             # Page frame and typography (CSS variables)
│   │           ├── figures.js           # Browser-side Mermaid rendering and figure sizing
│   │           ├── content.schema.json  # Content JSON schema
│   │           ├── layout.schema.json   # Layout JSON schema
│   │           ├── page_formats.md      # Paper sizes, margins, defaults
│   │           ├── layout_rules.md      # Pagination rules
│   │           ├── editing_guide.md     # How an agent edits the content JSON
│   │           └── vendor/              # Mermaid.js, Font Awesome Free (see THIRD_PARTY_NOTICES.md)
│   └── opencode/README.md
├── tests/                               # pytest (pagination rules, schema, inline split, import, HTML embedding)
└── docs/QUICKSTART.md, QUICKSTART_ja.md
```

Run the tests with `uv run --with pytest --with markdown-it-py --with mdit-py-plugins pytest -q tests`.

## License

[MIT](https://github.com/gospelo-dev/md2html/blob/main/LICENSE). Vendored assets: see [THIRD_PARTY_NOTICES.md](https://github.com/gospelo-dev/md2html/blob/main/THIRD_PARTY_NOTICES.md).
