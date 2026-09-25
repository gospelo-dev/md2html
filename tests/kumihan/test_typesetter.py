"""K06: Typesetter layout, placement, decision, and determinism."""

from fractions import Fraction

import pytest

from kumihan import (
    Decision,
    DecisionMismatch,
    Fit,
    FontFace,
    Layout,
    SpacingRules,
    Typesetter,
)
from kumihan.place import PlacedGlyph, PlacedLine, Placement, place

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"
F = Fraction
WIDTH = F(20)
LH = F(13, 10)


# -- placement ------------------------------------------------------------------

def test_placement_integer_coords(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    for line in layout.placement.lines:
        for g in line.glyphs:
            assert isinstance(g.x, int) and isinstance(g.y, int)


def test_placement_baselines_increase(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    baselines = [line.baseline_y for line in layout.placement.lines]
    for i in range(1, len(baselines)):
        assert baselines[i] > baselines[i - 1]


def test_placement_viewbox_positive(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert layout.placement.viewbox_width > 0
    assert layout.placement.viewbox_height > 0


def test_placement_ink_non_negative(bold_face: FontFace):
    """With trim_start the glyph origin may be negative; ink edge must be >= 0."""
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    for line in layout.placement.lines:
        assert line.ink_left >= 0, f"line ink_left={line.ink_left}"


# -- decision -------------------------------------------------------------------

def test_decision_json_roundtrip(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    j = layout.decision.to_json()
    d2 = Decision.from_json(j)
    assert d2.to_json() == j


def test_decision_keys_sorted(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    j = layout.decision.to_json()
    import json
    keys = list(json.loads(j).keys())
    assert keys == sorted(keys)


def test_decision_no_whitespace(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    j = layout.decision.to_json()
    assert ": " not in j
    assert ", " not in j


def test_decision_has_engine_version(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert layout.decision.engine.startswith("kumihan/")


def test_decision_has_text_hash(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert len(layout.decision.text_hash) == 16


def test_decision_has_font_info(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert layout.decision.font["file"] == "BIZUDPGothic-Bold.woff2"
    assert "sha256" in layout.decision.font


# -- determinism ----------------------------------------------------------------

def test_layout_deterministic(bold_face: FontFace):
    """Two layouts with the same input produce byte-identical decision JSON."""
    ts = Typesetter(bold_face)
    l1 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    l2 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    assert l1.decision.to_json() == l2.decision.to_json()


def test_placement_deterministic(bold_face: FontFace):
    ts = Typesetter(bold_face)
    l1 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    l2 = ts.layout(SAMPLE, WIDTH, line_height=LH)
    for a, b in zip(l1.placement.lines, l2.placement.lines):
        assert [(g.gid, g.x, g.y) for g in a.glyphs] == \
               [(g.gid, g.x, g.y) for g in b.glyphs]


# -- replay ---------------------------------------------------------------------

def test_replay_matches_layout(bold_face: FontFace):
    ts = Typesetter(bold_face)
    original = ts.layout(SAMPLE, WIDTH, line_height=LH)
    replayed = ts.replay(original.decision)
    for a, b in zip(original.placement.lines, replayed.placement.lines):
        assert [(g.gid, g.x, g.y) for g in a.glyphs] == \
               [(g.gid, g.x, g.y) for g in b.glyphs]


def test_replay_mismatch_font(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout(SAMPLE, WIDTH, line_height=LH)
    d = layout.decision
    bad = Decision(
        engine=d.engine, text=d.text, text_hash=d.text_hash,
        font={**d.font, "sha256": "0" * 64},
        segmenter=d.segmenter, params=d.params,
        lines=d.lines, scale=d.scale, warnings=d.warnings,
        versions=d.versions, kinsoku=d.kinsoku,
    )
    with pytest.raises(DecisionMismatch):
        ts.replay(bad)


# -- short text (1 line) -------------------------------------------------------

def test_short_text_1_line(bold_face: FontFace):
    ts = Typesetter(bold_face)
    layout = ts.layout("短い", F(20), line_height=LH)
    assert len(layout.placement.lines) == 1
    assert layout.decision.scale == 1.0
