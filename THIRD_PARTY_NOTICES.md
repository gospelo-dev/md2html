# Third-party notices

This repository vendors the following third-party assets in
`skills/claude/gospelo-md2html/`. They are redistributed unmodified, apart
from Shiki, which is a bundle built from the unmodified npm packages (see
below).

| Asset | Version | License | Source |
| --- | --- | --- | --- |
| `vendor/gospelo-mermaid-arch-<version>-<commit>.tgz` (`@gospelo/mermaid-arch`) | 0.1.0 (commit recorded in the `.txt` next to it) | MIT (gospelo-dev) | https://github.com/gospelo-dev/mermaid-arch |
| inside it: `vendor/fontawesome/<version>/` (`all.min.css` and webfonts) | Font Awesome Free 6.7.2 | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT | https://fontawesome.com/license/free |

Mermaid is not in this repository, and neither is elkjs: see "Mermaid and
elkjs" below.
| `references/vendor/shiki/<version>/shiki.min.js` | Shiki 4.4.3 (bundle of `shiki`, its `@shikijs/*` packages, TextMate grammars and the `github-light-high-contrast` theme) | MIT (Copyright (c) 2021 Pine Wu, (c) 2023 Anthony Fu); the bundled dependencies, grammars and theme are MIT or ISC | https://github.com/shikijs/shiki |
| `references/vendor/fonts/bizud/BIZUDPGothic-{Regular,Bold}.woff2`, `references/vendor/fonts/bizud/BIZUDGothic-{Regular,Bold}.woff2` | BIZ UDGothic / BIZ UDPGothic (Google Fonts release) | SIL OFL 1.1 (Copyright 2022 The BIZ UDGothic Project Authors; no Reserved Font Name), text in `fonts/bizud/OFL.txt` | https://github.com/googlefonts/morisawa-biz-ud-gothic |

The BIZ UD files are the unmodified TTFs of the Google Fonts release converted
to WOFF2 (a lossless container change). At build time the tool subsets them to
the characters a document uses and embeds the subsets in the generated HTML;
the OFL permits subsetting and embedding, and requires no attribution inside
the document. Section 5 of the OFL says the font cannot be sold by itself; it
travels inside the documents you produce, which is permitted.

## mermaid-arch: diagram drawing

mermaid-arch is installed from the tarball in `vendor/` (referenced as
`file:vendor/...` in `package.json`; the `package-lock.json` integrity pins
its contents). The `.txt` next to the tarball records the source commit, how
it was built, and its sha256 and npm integrity; replace both together when
updating to another commit.

The tarball carries Font Awesome Free (with its license text) but no Mermaid:
mermaid-arch depends on the `mermaid` package (see below) and checks the
installed copy against its `src/mermaid-manifest.json` (version and sha256 of
`mermaid.min.js` and `LICENSE`), stopping with an error when they differ.

## Mermaid and elkjs

Mermaid 12.3.0 (MIT, Copyright (c) 2014-2025 Knut Sveidqvist,
https://github.com/mermaid-js/mermaid) draws every diagram. Its
`dist/mermaid.min.js` bundles the ELK layout, which includes **elkjs**
(the Eclipse Layout Kernel compiled to JavaScript, **EPL-2.0**,
https://github.com/kieler/elkjs).

This repository does not contain elkjs. Mermaid is a pinned npm dependency
(`"mermaid": "12.3.0"` in the skill's `package.json`, integrity in
`package-lock.json`): `md2html.py setup` (`npm ci`) downloads it from the
public npm registry into each user's `node_modules`, and only there is elkjs.
Publishing or copying this repository, or installing the skill with
`install.py` (which skips `node_modules`), does not distribute elkjs.

The tool loads Mermaid into a page of headless Chrome to draw every diagram.
The generated document contains the drawn SVG, never the library: no Mermaid
or elkjs code, so no Mermaid or EPL notice is needed in the document. The SVG
that ELK laid out is output of the program and not covered by the EPL.

Earlier Python releases built `@mermaid-js/layout-elk` into the user cache with
`setup --elk`; Mermaid 12 includes ELK, so that step is gone.

AWS Architecture Icons are not part of this repository or of mermaid-arch.
They are read at build time from the user's own `Icon-package_*.zip`
(`--icons-zip`), used only to draw the diagrams, and never written out: the
generated document contains the drawn SVG only, which is how AWS permits the
icons to be used (as part of architecture diagrams).

## Shiki: build-only syntax highlighter

Shiki colours code blocks that name a language. It runs only in the
measurement and verify passes inside the browser; the generated document
contains the coloured `<span>` markup, never the library, so no Shiki notice is
needed in the document.

`shiki/<version>/shiki.min.js` is an IIFE built with esbuild from
`shiki/build/entry.mjs`, which loads the JavaScript regex engine (no WASM), the
`github-light-high-contrast` theme and a fixed set of languages, and exposes
`window.__shikiInit()`. To rebuild or add a version: in `shiki/build/`, run
`npm install && npm run build` (versions are pinned in `package.json`), move `shiki.min.js` to `shiki/<version>/` together
with Shiki's `LICENSE` (as `LICENSE.txt`), and update the table above. The
newest vendored version is used. With no Shiki vendored, code blocks are
written uncoloured.

## Notices carried by generated documents

The generated HTML contains the SVG drawn by Mermaid, but not the library
itself, so no Mermaid notice is needed in the document. By default it also
contains subsets of the BIZ UD fonts (OFL, no notice required in the document;
`--no-embed-fonts` omits them). Whenever a diagram label uses `fa:` icons, it
embeds Font Awesome Free (the stylesheet with its fonts as data URIs); the CSS
header comment with the license summary and copyright is kept in the embedded
stylesheet. Documents that show such icons carry the CC BY 4.0 attribution
that comment provides.

## Runtime dependencies

Installed by `npm ci` (`md2html.py setup`) from the skill's `package-lock.json`;
not vendored in the repository, except mermaid-arch (above).

| Package | Version | License |
| --- | --- | --- |
| @gospelo/mermaid-arch | 0.1.0 | MIT |
| mermaid (its `mermaid.min.js` bundles elkjs, EPL-2.0) | 12.3.0 | MIT |
| markdown-it | 15.0.3 | MIT |
| puppeteer-core | 25.16.0 | Apache-2.0 |
| subset-font (font subsetting; uses harfbuzzjs, MIT, and fontverter, BSD-3-Clause) | 2.9.0 | BSD-3-Clause |
| fflate (PPTX packaging) | 0.8.3 | MIT |

chrome-headless-shell is downloaded by `setup` into puppeteer's cache with
`@puppeteer/browsers` (Apache-2.0), under the Chromium licenses. It is not
redistributed by this repository.

The Python scripts used by md2html (`scripts/md2html.py`, a wrapper that runs
the Node.js CLI, `scripts/extract_markdown.py` and `scripts/install.py`) use the
standard library only. `scripts/kumihan/` is not used by md2html; its
dependencies are resolved by `uv` and not vendored.
