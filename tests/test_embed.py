"""Content JSON and layout embedded in generated HTML (docs/07 section 9)."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html.content import (  # noqa: E402
    CONTENT_SCRIPT_ID, LAYOUT_SCRIPT_ID, ContentError, embed_json, extract_from_html, make_source_page,
)
from md2html.layout import Layout, build_layout, layout_to_dict  # noqa: E402


def sample_doc():
    return {
        "version": 1,
        "meta": {"title": "T", "date": "2026-09-20", "source": "a.md"},
        "pages": [
            make_source_page("# T\n\n<script>x</script>\n"),
            {"id": "p01", "kind": "content", "title": None, "continued": False,
             "blocks": [{"type": "paragraph", "text": "a </script> b <b>"}]},
        ],
    }


def wrap(doc, layout=None):
    html = f'<html><body><script type="application/json" id="{CONTENT_SCRIPT_ID}">\n{embed_json(doc)}\n</script>'
    if layout is not None:
        html += f'<script type="application/json" id="{LAYOUT_SCRIPT_ID}">\n{embed_json(layout)}\n</script>'
    return html + "</body></html>"


def test_embed_escapes_script_terminators_and_round_trips():
    doc = sample_doc()
    text = embed_json(doc)
    assert "</script" not in text and "<" not in text
    got, layout = extract_from_html(wrap(doc))
    assert got == doc and layout is None


def test_layout_round_trip_and_cli_precedence():
    layout = Layout(page="16x9", font_size="14pt", overrides={"p05": {"columns": "single"}})
    embedded = layout_to_dict(layout)
    _, got = extract_from_html(wrap(sample_doc(), embedded))
    merged = build_layout(None, {"font_size": "12pt", "page": None}, base=got)
    assert merged.page == "16x9" and merged.font_size == "12pt"
    assert merged.overrides == {"p05": {"columns": "single"}}


def test_missing_embedded_content_is_an_error():
    with pytest.raises(ContentError):
        extract_from_html("<html><body>no json here</body></html>")
