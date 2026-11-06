// Bundles @mermaid-js/layout-elk (ESM + dynamic chunks + elkjs + the d3 parts it
// uses) into one IIFE that a self-contained HTML can inline. The bundle is not
// committed: `md2html.py setup --elk` builds it on the user's machine into the
// user cache (scripts/md2html/elk_setup.py). Nothing is registered here:
// figures.js calls mermaid.registerLayoutLoaders() with
// window.__mermaidLayoutElk.layouts, so that a missing bundle is an error there.
import layouts from '@mermaid-js/layout-elk'
import pkg from '@mermaid-js/layout-elk/package.json' with { type: 'json' }

window.__mermaidLayoutElk = { version: pkg.version, layouts: layouts }
