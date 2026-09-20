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
| `fonts/bizud/BIZUDPGothic-{Regular,Bold}.woff2`, `fonts/bizud/BIZUDGothic-{Regular,Bold}.woff2` | BIZ UDGothic / BIZ UDPGothic (Google Fonts release) | SIL OFL 1.1 (Copyright 2022 The BIZ UDGothic Project Authors; no Reserved Font Name), text in `fonts/bizud/OFL.txt` | https://github.com/googlefonts/morisawa-biz-ud-gothic |

The BIZ UD files are the unmodified TTFs of the Google Fonts release converted
to WOFF2 (a lossless container change). At build time the tool subsets them to
the characters a document uses and embeds the subsets in the generated HTML;
the OFL permits subsetting and embedding, and requires no attribution inside
the document. Section 5 of the OFL says the font cannot be sold by itself; it
travels inside the documents you produce, which is permitted.

## Mermaid: per-version vendoring

The vendored copy is the rendering engine in every mode: the measurement and
verify passes load it into headless Chromium to draw each diagram (its size
drives pagination). In the default `prerender` mode the drawn SVG is what ends
up in the document; in `embed` / `link` mode the library itself is shipped as
well. Mermaid is kept per version as `mermaid/<version>/mermaid.min.js` with
the MIT text next to it as `mermaid/<version>/LICENSE.txt`, so that several
versions can coexist. A generated HTML records the version it was paginated with in its
embedded layout (`mermaidVersion`) and is rebuilt with that same version;
new documents default to the newest vendored version. `--mermaid-version X.Y.Z`
selects one explicitly.

To add a version: create `mermaid/<version>/`, copy the unmodified
`dist/mermaid.min.js` of that release and its `LICENSE` file (as `LICENSE.txt`),
and add a row to the table above. The directory name must match the version
string inside the bundle; the tool checks this.

## Notices carried by generated documents

In the default `prerender` mode the generated HTML contains the SVG that
Mermaid.js drew, but not the library itself, so no Mermaid notice is needed in
the document. By default it also contains subsets of the BIZ UD fonts (OFL,
no notice required in the document; `--no-embed-fonts` omits them). In `embed`
and `link` mode the HTML embeds (or links) Mermaid.js, and whenever `fa:` icons
are used it embeds the Font Awesome Free Solid font. Documents you distribute
in those cases carry the licenses' attribution requirements:

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
| python-pptx (PPTX export) | MIT |
| Pillow (pulled in by python-pptx) | MIT-CMU (HPND) |
| fonttools (font subsetting) | MIT |
| Brotli (WOFF2 compression for fonttools) | MIT |
