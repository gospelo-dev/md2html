"""K08: Golden SVG, determinism, and resvg raster comparison.

Golden SVGs live in tests/golden/kumihan/. To update them after an
intentional rule change:

    uv run --with fonttools --with brotli --with uharfbuzz --with budoux \\
        pytest tests/kumihan/test_golden.py --update-golden

Then commit the new SVGs and their hashes.
"""

from __future__ import annotations

import hashlib
from fractions import Fraction
from pathlib import Path

import pytest

from kumihan import FontFace, Typesetter
from kumihan.emit import emit_svg

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "golden" / "kumihan"
F = Fraction
LH = F(13, 10)

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"
SHORT = "短い見出し"

GOLDEN_CASES = [
    ("sample_2line", SAMPLE, F(20)),
    ("short_1line", SHORT, F(20)),
]


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _generate(bold_face: FontFace, text: str, width: Fraction) -> str:
    ts = Typesetter(bold_face)
    layout = ts.layout(text, width, line_height=LH)
    return emit_svg(layout, title=text)


# -- determinism ----------------------------------------------------------------

class TestDeterminism:
    def test_svg_byte_identical(self, bold_face: FontFace):
        s1 = _generate(bold_face, SAMPLE, F(20))
        s2 = _generate(bold_face, SAMPLE, F(20))
        assert s1 == s2

    def test_json_byte_identical(self, bold_face: FontFace):
        from kumihan.emit import emit_json
        ts = Typesetter(bold_face)
        l1 = ts.layout(SAMPLE, F(20), line_height=LH)
        l2 = ts.layout(SAMPLE, F(20), line_height=LH)
        assert emit_json(l1) == emit_json(l2)

    def test_png_byte_identical(self, bold_face: FontFace):
        from kumihan.emit import emit_png
        ts = Typesetter(bold_face)
        l1 = ts.layout(SAMPLE, F(20), line_height=LH)
        l2 = ts.layout(SAMPLE, F(20), line_height=LH)
        assert emit_png(l1, background="white") == emit_png(l2, background="white")


# -- golden SVG -----------------------------------------------------------------

@pytest.mark.parametrize("name,text,width", GOLDEN_CASES)
def test_golden_svg_matches(bold_face: FontFace, name: str, text: str, width: Fraction, request):
    svg = _generate(bold_face, text, width)
    golden_path = GOLDEN_DIR / f"{name}.svg"

    if request.config.getoption("--update-golden", default=False):
        golden_path.parent.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(svg, encoding="utf-8")
        pytest.skip(f"updated {golden_path.name}")

    assert golden_path.exists(), f"golden file missing: {golden_path}. Run with --update-golden"
    expected = golden_path.read_text(encoding="utf-8")
    assert _sha(svg) == _sha(expected), f"golden SVG mismatch for {name}"


# -- resvg raster ---------------------------------------------------------------

@pytest.mark.parametrize("name,text,width", GOLDEN_CASES)
def test_raster_pixel_identical(bold_face: FontFace, name: str, text: str, width: Fraction):
    from kumihan.emit import emit_png
    ts = Typesetter(bold_face)
    l1 = ts.layout(text, width, line_height=LH)
    l2 = ts.layout(text, width, line_height=LH)
    png1 = emit_png(l1, background="white")
    png2 = emit_png(l2, background="white")
    assert png1 == png2, f"raster mismatch for {name}"


# -- kinsoku in output ----------------------------------------------------------

def test_kinsoku_line_start_not_paren(bold_face: FontFace):
    """Opening paren should not appear at line start."""
    text = "テスト（開きカッコ）のテスト文字列の確認をする"
    ts = Typesetter(bold_face)
    layout = ts.layout(text, F(12), line_height=LH)
    for line in layout.placement.lines[1:]:
        first_cluster = line.glyphs[0].cluster if line.glyphs else -1
        if first_cluster >= 0:
            ch = text[first_cluster]
            assert ch not in "（「『〔〖〘([{", f"line starts with prohibited char: {ch}"


# -- shrink output ---------------------------------------------------------------

def test_shrink_still_produces_valid_svg(bold_face: FontFace):
    from kumihan import Fit
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, F(10), line_height=LH, fit=Fit.wrap_shrink())
    svg = emit_svg(layout)
    assert "<path " in svg
    assert layout.fit_result.scale < 1


# -- ellipsis output -------------------------------------------------------------

def test_ellipsis_produces_1_line_svg(bold_face: FontFace):
    from kumihan import Fit
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, F(15), line_height=LH, fit=Fit.ellipsis())
    svg = emit_svg(layout)
    assert "<path " in svg
    assert len(layout.placement.lines) == 1
