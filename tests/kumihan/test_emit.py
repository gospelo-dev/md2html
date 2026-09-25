"""K07: SVG / JSON / PNG emitters."""

import json
from fractions import Fraction

import pytest

from kumihan import FontFace, Typesetter
from kumihan.emit import emit_svg, emit_json

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"
F = Fraction
WIDTH = F(20)
LH = F(13, 10)


@pytest.fixture
def layout(bold_face: FontFace):
    return Typesetter(bold_face).layout(SAMPLE, WIDTH, line_height=LH)


# -- SVG -----------------------------------------------------------------------

def test_svg_is_string(layout):
    svg = emit_svg(layout)
    assert isinstance(svg, str)


def test_svg_starts_with_svg_tag(layout):
    svg = emit_svg(layout)
    assert svg.startswith("<svg ")


def test_svg_ends_with_closing_tag(layout):
    svg = emit_svg(layout)
    assert svg.strip().endswith("</svg>")


def test_svg_has_viewbox(layout):
    svg = emit_svg(layout)
    assert 'viewBox="0 0 ' in svg


def test_svg_has_path_elements(layout):
    svg = emit_svg(layout)
    assert "<path " in svg


def test_svg_no_text_element(layout):
    svg = emit_svg(layout)
    assert "<text" not in svg


def test_svg_no_foreignobject(layout):
    svg = emit_svg(layout)
    assert "<foreignObject" not in svg


def test_svg_no_font_face(layout):
    svg = emit_svg(layout)
    assert "@font-face" not in svg


def test_svg_title(layout):
    svg = emit_svg(layout, title="テスト見出し")
    assert "<title>テスト見出し</title>" in svg


def test_svg_no_title(layout):
    svg = emit_svg(layout, title=None)
    assert "<title>" not in svg


def test_svg_metadata_contains_decision(layout):
    svg = emit_svg(layout)
    assert "<metadata>" in svg
    dj = layout.decision.to_json()
    escaped = dj.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    assert escaped in svg


def test_svg_metadata_excluded(layout):
    svg = emit_svg(layout, include_decision=False)
    assert "<metadata>" not in svg


def test_svg_data_role(layout):
    svg = emit_svg(layout, role="main")
    assert 'data-role="main"' in svg


def test_svg_fill(layout):
    svg = emit_svg(layout, fill="#444")
    assert 'fill="#444"' in svg


def test_svg_lf_line_endings(layout):
    svg = emit_svg(layout)
    assert "\r" not in svg


def test_svg_deterministic(bold_face: FontFace):
    ts = Typesetter(bold_face)
    l1 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    l2 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert emit_svg(l1) == emit_svg(l2)


def test_svg_path_d_integers(layout):
    """All coordinates in <path d> should be integers (no decimal points)."""
    svg = emit_svg(layout)
    import re
    for m in re.finditer(r'<path d="([^"]+)"', svg):
        d = m.group(1)
        numbers = re.findall(r'-?\d+\.?\d*', d)
        for n in numbers:
            assert "." not in n, f"non-integer in path: {n}"


def test_svg_xml_lang(layout):
    svg = emit_svg(layout, lang="ja")
    assert 'xml:lang="ja"' in svg


# -- JSON ----------------------------------------------------------------------

def test_json_is_string(layout):
    j = emit_json(layout)
    assert isinstance(j, str)


def test_json_parseable(layout):
    j = emit_json(layout)
    d = json.loads(j)
    assert "viewbox" in d
    assert "lines" in d
    assert "decision" in d


def test_json_viewbox(layout):
    j = emit_json(layout)
    d = json.loads(j)
    assert d["viewbox"]["width"] == layout.placement.viewbox_width
    assert d["viewbox"]["height"] == layout.placement.viewbox_height


def test_json_line_count(layout):
    j = emit_json(layout)
    d = json.loads(j)
    assert len(d["lines"]) == len(layout.placement.lines)


def test_json_glyph_coords(layout):
    j = emit_json(layout)
    d = json.loads(j)
    for i, line in enumerate(d["lines"]):
        for g_d in line["glyphs"]:
            assert isinstance(g_d["x"], int)
            assert isinstance(g_d["y"], int)
            assert isinstance(g_d["gid"], int)


def test_json_deterministic(bold_face: FontFace):
    ts = Typesetter(bold_face)
    l1 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    l2 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert emit_json(l1) == emit_json(l2)


def test_json_indent(layout):
    j = emit_json(layout, indent=2)
    assert "\n" in j
    d = json.loads(j)
    assert "viewbox" in d


# -- PNG -----------------------------------------------------------------------

def test_png_bytes(layout):
    from kumihan.emit import emit_png
    data = emit_png(layout, background="white")
    assert isinstance(data, bytes)
    assert data[:8] == b"\x89PNG\r\n\x1a\n"


def test_png_deterministic(bold_face: FontFace):
    from kumihan.emit import emit_png
    ts = Typesetter(bold_face)
    l1 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    l2 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert emit_png(l1, background="white") == emit_png(l2, background="white")


# -- short text ----------------------------------------------------------------

def test_svg_short_text(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout("短い", F(20), line_height=LH)
    svg = emit_svg(layout, title="短い")
    assert "<path " in svg
    assert "<title>短い</title>" in svg
