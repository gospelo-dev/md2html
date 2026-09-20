# Third-party notices

This repository vendors the following third-party assets under
`skills/claude/gospelo-md2html/references/vendor/`. They are redistributed
unmodified (except that the Font Awesome CSS font URL is rewritten to a data
URI at HTML generation time).

| Asset | Version | License | Source |
| --- | --- | --- | --- |
| `mermaid/<version>/mermaid.min.js` | Mermaid 11.12.2 | MIT (Copyright (c) 2014-2025 Knut Sveidqvist) | https://github.com/mermaid-js/mermaid |
| `fontawesome.min.css`, `fa-solid.min.css` | Font Awesome Free 6.7.2 | MIT (CSS/code) | https://github.com/FortAwesome/Font-Awesome |
| `fa-solid-900.woff2` | Font Awesome Free 6.7.2 | SIL OFL 1.1 (font), icons CC BY 4.0 | https://fontawesome.com/license/free |

## Mermaid: per-version vendoring

Mermaid is kept per version as `mermaid/<version>/mermaid.min.js` with the MIT
text next to it as `mermaid/<version>/LICENSE.txt`, so that several versions
can coexist. A generated HTML records the version it was paginated with in its
embedded layout (`mermaidVersion`) and is rebuilt with that same version;
new documents default to the newest vendored version. `--mermaid-version X.Y.Z`
selects one explicitly.

To add a version: create `mermaid/<version>/`, copy the unmodified
`dist/mermaid.min.js` of that release and its `LICENSE` file (as `LICENSE.txt`),
and add a row to the table above. The directory name must match the version
string inside the bundle; the tool checks this.

## Notices carried by generated documents

The generated HTML embeds (or links) Mermaid.js and, when `fa:` icons are used,
the Font Awesome Free Solid font. Documents you distribute therefore carry those
licenses' attribution requirements:

- Mermaid: the tool writes an HTML comment with the version, the copyright line
  and the full MIT permission notice immediately before the library, in both
  `embed` and `link` mode. In `link` mode it also copies
  `LICENSE.mermaid-<version>.txt` next to `mermaid-<version>.min.js`.
- Font Awesome: the CSS header comment (license summary and copyright) is kept
  in the embedded stylesheet.

Runtime dependencies resolved by `uv` at execution time (not vendored):

| Package | License |
| --- | --- |
| markdown-it-py | MIT |
| mdit-py-plugins | MIT |
| playwright (Python) | Apache-2.0 (Chromium is downloaded by Playwright under its own licenses) |
