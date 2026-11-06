# Third-party notices

This repository vendors the following third-party assets under
`skills/claude/gospelo-md2html/references/vendor/`. They are redistributed
unmodified (except that the Font Awesome CSS font URL is rewritten to a data
URI at HTML generation time), apart from Shiki, which is a bundle built from
the unmodified npm packages (see below). The Mermaid ELK layout is not
vendored: the repository carries only its build recipe, and each user builds
the bundle on their own machine (see below).

| Asset | Version | License | Source |
| --- | --- | --- | --- |
| `mermaid/<version>/mermaid.min.js` | Mermaid 11.12.2 | MIT (Copyright (c) 2014-2025 Knut Sveidqvist) | https://github.com/mermaid-js/mermaid |
| `shiki/<version>/shiki.min.js` | Shiki 4.4.3 (bundle of `shiki`, its `@shikijs/*` packages, TextMate grammars and the `github-light-high-contrast` theme) | MIT (Copyright (c) 2021 Pine Wu, (c) 2023 Anthony Fu); the bundled dependencies, grammars and theme are MIT or ISC | https://github.com/shikijs/shiki |
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

## Mermaid ELK layout

Diagrams that ask for the ELK layout (`layout: elk` in front matter or an
`%%{init}%%` directive, or `flowchart-elk`) are laid out by
`@mermaid-js/layout-elk` (MIT), which runs elkjs (the Eclipse Layout Kernel
compiled to JavaScript, **EPL-2.0**), plus d3-shape and d3-path (ISC).

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @mermaid-js/layout-elk | 0.2.0 | MIT (Copyright (c) 2014 - 2022 Knut Sveidqvist) | https://github.com/mermaid-js/mermaid |
| elkjs | 0.9.3 | EPL-2.0 | https://github.com/kieler/elkjs |
| d3-shape, d3-path | as resolved by npm (d3 ^7.9.0) | ISC (Copyright Mike Bostock) | https://github.com/d3 |

None of these is in the repository. `references/vendor/mermaid-layout-elk/build/`
holds only the recipe (`entry.mjs`, and `package.json` pinning layout-elk,
elkjs and esbuild). `md2html.py setup --elk` copies it to a temporary
directory, runs `npm install --ignore-scripts` and esbuild there, and writes
`mermaid-layout-elk.min.js` (one IIFE exposing `window.__mermaidLayoutElk`)
with `LICENSE.txt` (the license texts of the four packages, taken from the
installed packages) into the user cache,
`${XDG_CACHE_HOME:-~/.cache}/gospelo-md2html/mermaid-layout-elk/<version>/`.
figures.js registers the layouts with `mermaid.registerLayoutLoaders()`. The
layout-elk version is paired with each vendored Mermaid version in
`MERMAID_LAYOUT_ELK` (`scripts/md2html/assets.py`): 0.2.0 is the layout-elk
release that was current when Mermaid 11.12.2 was released.

Since the repository does not contain elkjs, publishing it does not distribute
elkjs. A generated document contains elkjs only in `embed` / `link` mode and
only when one of its diagrams asks for ELK; whoever passes such a document on
distributes elkjs in object form. The EPL-2.0 then requires the license text
and a statement of where the source code is available
(https://github.com/kieler/elkjs); the tool writes both in front of the bundle
(see below). In the default `prerender` mode the document holds only the SVG
that ELK laid out, which is output of the program and not covered by the EPL.

## Shiki: build-only syntax highlighter

Shiki colours code blocks that name a language. Like Mermaid in `prerender`
mode, it runs only in the measurement and verify passes inside Chromium; the
generated document contains the coloured `<span>` markup, never the library,
so no Shiki notice is needed in the document.

`shiki/<version>/shiki.min.js` is an IIFE built with esbuild from
`shiki/build/entry.mjs`, which loads the JavaScript regex engine (no WASM), the
`github-light-high-contrast` theme and a fixed set of languages, and exposes
`window.__shikiInit()`. To rebuild or add a version: in `shiki/build/`, run
`npm install && npm run build` (versions are pinned in `package.json`), move `shiki.min.js` to `shiki/<version>/` together
with Shiki's `LICENSE` (as `LICENSE.txt`), and update the table above. The
newest vendored version is used. With no Shiki vendored, code blocks are
written uncoloured.

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
- Mermaid ELK layout (only when a diagram asks for ELK): the tool writes an
  HTML comment with the version and the full `LICENSE.txt` (MIT, EPL-2.0 with
  the elkjs source location, ISC) immediately before the bundle. In `link`
  mode it also copies `LICENSE.mermaid-layout-elk-<version>.txt` next to
  `mermaid-layout-elk-<version>.min.js`. In `prerender` mode only the drawn SVG
  is in the document.
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
