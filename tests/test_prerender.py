"""prerender mode: diagrams are written as the SVG the verify pass drew, and the Mermaid library is omitted."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html.content import make_source_page  # noqa: E402
from md2html.formats import get_format  # noqa: E402
from md2html.layout import Layout, LayoutError, build_layout  # noqa: E402
from md2html.render import RenderContext, render_document  # noqa: E402
from md2html.scale import build_metrics  # noqa: E402

SRC = "flowchart LR\n  A --> B"


def doc_and_pages():
    page = {"id": "p01", "kind": "content", "title": "T", "continued": False,
            "blocks": [{"id": "p01-b0", "type": "paragraph", "text": "x"},
                       {"id": "p01-b1", "type": "mermaid", "source": SRC}]}
    doc = {"version": 1, "meta": {"title": "T", "date": None, "source": None},
           "pages": [make_source_page("# T"), page]}
    return doc, [page]


def ctx(layout: Layout, svgs=None, tmp_path=None) -> RenderContext:
    metrics = build_metrics(get_format(layout.page), layout.font_size, layout.title_scale, layout.columns,
                            layout.figure_side, layout.split_ratio)
    return RenderContext(metrics, layout, Path("."), tmp_path, False, svgs)


def test_prerender_is_the_default_and_validated():
    assert Layout().mermaid_lib == "prerender"
    assert build_layout(None, {"mermaid_lib": "embed"}).mermaid_lib == "embed"
    with pytest.raises(LayoutError):
        build_layout(None, {"mermaid_lib": "cdn"})


def test_without_svgs_the_source_and_library_are_written(tmp_path):
    doc, pages = doc_and_pages()
    html = render_document(doc, pages, ctx(Layout(page="a4"), None, tmp_path), None)
    assert '<pre class="mermaid">' in html
    assert 'data-mermaid-version="' in html  # the library (needed by the verify pass) is embedded
    assert "Mermaid 11.12.2 | MIT License" in html


def test_with_svgs_the_svg_replaces_the_source_and_no_library_is_written(tmp_path):
    doc, pages = doc_and_pages()
    svg = '<svg id="mermaid-1" viewBox="0 0 100 50" width="100" height="50"><g/></svg>'
    html = render_document(doc, pages, ctx(Layout(page="a4"), {"p01-b1": svg}, tmp_path), None)
    assert svg in html
    assert '<pre class="mermaid">' not in html
    assert 'data-mermaid-version="' not in html and "MIT License" not in html
    assert '"mermaidVersion": "' in html  # the version used is still recorded in the envelope
    assert "flowchart LR" in html  # the source stays in the envelope


def test_embed_mode_keeps_the_library_even_with_svgs(tmp_path):
    doc, pages = doc_and_pages()
    svg = '<svg viewBox="0 0 10 10"></svg>'
    layout = Layout(page="a4", mermaid_lib="embed")
    html = render_document(doc, pages, ctx(layout, None, tmp_path), None)
    assert 'data-mermaid-version="' in html and '<pre class="mermaid">' in html
    assert svg not in html
