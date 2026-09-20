# Third-party notices

This repository vendors the following third-party assets under
`skills/claude/gospelo-md2html/references/vendor/`. They are redistributed
unmodified (except that the Font Awesome CSS font URL is rewritten to a data
URI at HTML generation time).

| Asset | Version | License | Source |
| --- | --- | --- | --- |
| `mermaid.min.js` | Mermaid 11.12.2 | MIT (Copyright (c) 2014-2025 Knut Sveidqvist) | https://github.com/mermaid-js/mermaid |
| `fontawesome.min.css`, `fa-solid.min.css` | Font Awesome Free 6.7.2 | MIT (CSS/code) | https://github.com/FortAwesome/Font-Awesome |
| `fa-solid-900.woff2` | Font Awesome Free 6.7.2 | SIL OFL 1.1 (font), icons CC BY 4.0 | https://fontawesome.com/license/free |

Runtime dependencies resolved by `uv` at execution time (not vendored):

| Package | License |
| --- | --- |
| markdown-it-py | MIT |
| mdit-py-plugins | MIT |
| playwright (Python) | Apache-2.0 (Chromium is downloaded by Playwright under its own licenses) |

The generated HTML embeds (or links) Mermaid.js and, when `fa:` icons are used,
the Font Awesome Free Solid font. Documents you distribute therefore carry those
licenses' attribution requirements; the Font Awesome CSS header comment is kept
in the embedded stylesheet for that purpose.
