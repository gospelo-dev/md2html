"""K05: line breaking and fit. Tests with the 07 sample on a 16:9 cover."""

from fractions import Fraction

import pytest

from kumihan import FontFace, FitError
from kumihan.kinsoku import Kinsoku, feasible
from kumihan.normalize import normalize
from kumihan.segment import BudouXSegmenter, candidate_breaks
from kumihan.shape import shape
from kumihan.space import SpacingRules, apply_spacing, ZERO
from kumihan.linebreak import (
    BreakCandidate,
    BreakResult,
    find_breaks,
    line_ink_width,
    default_chooser,
)
from kumihan.fit import Fit, FitResult, try_fit

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"
F = Fraction

# Use a width (em) that forces the sample text into 2 lines.
# The spaced text is ~28.3em; use ~20em so both lines fit.
WIDTH_EM = F(20)


def _spaced(face: FontFace, text: str = SAMPLE) -> "tuple":
    """Shape and space with heading rules, return (spaced, feasible_positions)."""
    shaped = shape(face, text)
    spaced = apply_spacing(shaped, SpacingRules.heading())
    n = normalize(text)
    seg = BudouXSegmenter()
    candidates = candidate_breaks(n, seg)
    feas = feasible(text, candidates)
    return spaced, feas


# -- line_ink_width ---------------------------------------------------------------

def test_line_ink_width_full(bold_face: FontFace):
    spaced, _ = _spaced(bold_face)
    w = line_ink_width(spaced, 0, len(spaced.glyphs))
    assert w > F(0) and w < F(30)


def test_line_ink_width_empty(bold_face: FontFace):
    spaced, _ = _spaced(bold_face)
    assert line_ink_width(spaced, 0, 0) == ZERO
    assert line_ink_width(spaced, 5, 5) == ZERO


def test_line_ink_width_single(bold_face: FontFace):
    spaced, _ = _spaced(bold_face)
    w = line_ink_width(spaced, 0, 1)
    ink = bold_face.ink(spaced.glyphs[0].gid)
    expected = F(ink.xmax - ink.xmin, bold_face.upm)
    assert w == expected


def test_line_ink_width_sum(bold_face: FontFace):
    """Width of [0, n) > width of [0, k) for any 0 < k < n."""
    spaced, _ = _spaced(bold_face)
    n = len(spaced.glyphs)
    full = line_ink_width(spaced, 0, n)
    half = line_ink_width(spaced, 0, n // 2)
    assert full > half


# -- find_breaks: 1-line fits ------------------------------------------------------

def test_short_text_fits_1_line(bold_face: FontFace):
    spaced, feas = _spaced(bold_face, "短い")
    result = find_breaks(spaced, F(10), feas)
    assert result is not None
    assert result.num_lines == 1
    assert result.candidates[result.chosen].positions == ()


# -- find_breaks: 2-line -----------------------------------------------------------

def test_sample_breaks_into_2_lines(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    result = find_breaks(spaced, WIDTH_EM, feas)
    assert result is not None
    assert result.num_lines == 2
    chosen = result.candidates[result.chosen]
    assert len(chosen.positions) == 1
    pos = chosen.positions[0]
    assert 0 < pos < len(SAMPLE)
    for w in chosen.widths:
        assert w <= WIDTH_EM


def test_2line_balance(bold_face: FontFace):
    """Chosen break minimises the difference between line widths."""
    spaced, feas = _spaced(bold_face)
    result = find_breaks(spaced, WIDTH_EM, feas)
    assert result is not None and result.num_lines == 2
    chosen = result.candidates[result.chosen]
    for c in result.candidates:
        assert chosen.score <= c.score


def test_2line_tiebreak_center(bold_face: FontFace):
    """Among equal scores, the center-closest position wins."""
    spaced, feas = _spaced(bold_face)
    result = find_breaks(spaced, WIDTH_EM, feas)
    if result is None or len(result.candidates) < 2:
        pytest.skip("not enough candidates for tie-break test")
    chosen = result.candidates[result.chosen]
    center = F(len(SAMPLE), 2)
    for c in result.candidates:
        if c.score == chosen.score:
            avg_c = F(sum(c.positions), len(c.positions)) if c.positions else ZERO
            avg_ch = F(sum(chosen.positions), len(chosen.positions)) if chosen.positions else ZERO
            assert abs(avg_ch - center) <= abs(avg_c - center)


def test_rejection_single_phrase_short(bold_face: FontFace):
    """A break leaving < 4 chars as a single phrase on the last line is rejected."""
    spaced, feas = _spaced(bold_face)
    result = find_breaks(spaced, WIDTH_EM, feas)
    if result is None or result.num_lines < 2:
        pytest.skip("no 2-line break result")
    n = len(SAMPLE)
    for c in result.candidates:
        if not c.positions:
            continue
        pos = c.positions[-1]
        tail = n - pos
        if tail < 4:
            internal = any(pos < b < n for b in feas)
            assert internal, f"pos {pos}: tail {tail} chars, single phrase, should be rejected"


def test_candidate_describe(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    result = find_breaks(spaced, WIDTH_EM, feas)
    assert result is not None
    d = result.candidates[0].describe()
    assert "positions" in d and "widths" in d and "score" in d


# -- find_breaks: no fit -----------------------------------------------------------

def test_no_fit_returns_none(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    result = find_breaks(spaced, F(1), feas, max_lines=2)
    assert result is None


# -- Fit strategy ------------------------------------------------------------------

def test_fit_wrap_shrink_sample(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    fit = Fit.wrap_shrink()
    result = try_fit(spaced, WIDTH_EM, feas, fit)
    assert result.scale == F(1)
    assert result.breaks.num_lines <= 2


def test_fit_wrap_shrink_narrow(bold_face: FontFace):
    """Narrow width forces shrinking."""
    spaced, feas = _spaced(bold_face)
    fit = Fit.wrap_shrink(min_scale=F(1, 2))
    result = try_fit(spaced, F(12), feas, fit)
    assert result.scale < F(1)


def test_fit_wrap_no_shrink(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    fit = Fit.wrap()
    result = try_fit(spaced, WIDTH_EM, feas, fit)
    assert result.scale == F(1)


def test_fit_none_overflow(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    fit = Fit.none()
    result = try_fit(spaced, F(1), feas, fit)
    assert "overflow" in result.warnings


def test_fit_none_ok(bold_face: FontFace):
    spaced, feas = _spaced(bold_face, "短い")
    fit = Fit.none()
    result = try_fit(spaced, F(10), feas, fit)
    assert result.warnings == ()


def test_fit_ellipsis(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    fit = Fit.ellipsis()
    result = try_fit(spaced, F(10), feas, fit)
    assert any("truncated" in w for w in result.warnings)


def test_fit_error(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    fit = Fit.wrap_shrink(min_scale=F(99, 100))
    with pytest.raises(FitError):
        try_fit(spaced, F(1, 10), feas, fit)


def test_fit_deterministic(bold_face: FontFace):
    spaced, feas = _spaced(bold_face)
    fit = Fit.wrap_shrink()
    r1 = try_fit(spaced, WIDTH_EM, feas, fit)
    r2 = try_fit(spaced, WIDTH_EM, feas, fit)
    c1 = r1.breaks.candidates[r1.breaks.chosen]
    c2 = r2.breaks.candidates[r2.breaks.chosen]
    assert c1.positions == c2.positions
    assert c1.widths == c2.widths


def test_fit_describe(bold_face: FontFace):
    d = Fit.wrap_shrink().describe()
    assert d["strategy"] == "wrap+shrink"
    assert d["shrinkStep"] == 10 / 11
