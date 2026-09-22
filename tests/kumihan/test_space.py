"""K04: spacing rules. Verified against 07_measurements.md ink bounds."""

from fractions import Fraction

from kumihan import FontFace
from kumihan.chars import CharClass
from kumihan.shape import shape
from kumihan.space import (
    Spaced,
    SpacedGlyph,
    SpacingRules,
    apply_spacing,
    ink_gap,
    _pair_kind,
    ZERO,
)

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"
F = Fraction


def _gap_after(spaced: Spaced, i: int) -> Fraction | None:
    """Ink gap between spaced glyphs i and i+1 after spacing."""
    face = spaced.shaped.face
    g = spaced.glyphs
    return ink_gap(face, g[i].gid, g[i + 1].gid, g[i].advance)


# -- SpacingRules presets --------------------------------------------------------

def test_heading_preset():
    r = SpacingRules.heading()
    assert r.g_max_kana == F(6, 100)
    assert r.g_min == F(2, 100)
    assert r.a_je == F(1, 8)
    assert r.punct_run == F(1, 4)
    assert r.trim_start is True and r.trim_end is True


def test_subheading_preset():
    r = SpacingRules.subheading()
    assert r.g_max_kana == F(8, 100)


def test_caption_preset():
    r = SpacingRules.caption()
    assert r.g_max_kana == F(1, 10)


def test_label_preset():
    r = SpacingRules.label()
    assert r.g_max_kana == F(1)
    assert r.a_je == ZERO
    assert r.trim_start is False


def test_describe():
    d = SpacingRules.heading().describe()
    assert d["gMaxKana"] == 0.06
    assert d["aJE"] == 0.125
    assert d["trimStart"] is True


# -- _pair_kind -------------------------------------------------------------------

def test_pair_kind_kanji_kanji():
    assert _pair_kind(CharClass.KANJI, CharClass.KANJI, "生", "成") == "keep"


def test_pair_kind_kana_kanji():
    assert _pair_kind(CharClass.KANA, CharClass.KANJI, "の", "高") == "kana"


def test_pair_kind_kanji_kana():
    assert _pair_kind(CharClass.KANJI, CharClass.KANA, "高", "い") == "kana"


def test_pair_kind_kana_kana():
    assert _pair_kind(CharClass.KANA, CharClass.KANA, "す", "る") == "kana"


def test_pair_kind_je_boundary():
    assert _pair_kind(CharClass.KANJI, CharClass.LATIN, "成", "A") == "je"
    assert _pair_kind(CharClass.LATIN, CharClass.KANA, "I", "で") == "je"
    assert _pair_kind(CharClass.KANA, CharClass.LATIN, "い", "H") == "je"


def test_pair_kind_cjk_punct():
    assert _pair_kind(CharClass.PUNCT, CharClass.PUNCT, "、", "。") == "punct"


def test_pair_kind_ascii_punct():
    assert _pair_kind(CharClass.PUNCT, CharClass.PUNCT, ")", ")") == "keep"


def test_pair_kind_mixed_punct():
    assert _pair_kind(CharClass.PUNCT, CharClass.PUNCT, "、", ")") == "keep"


def test_pair_kind_punct_with_other():
    assert _pair_kind(CharClass.PUNCT, CharClass.LATIN, "、", "S") == "keep"
    assert _pair_kind(CharClass.KANA, CharClass.PUNCT, "を", "、") == "keep"


def test_pair_kind_latin_latin():
    assert _pair_kind(CharClass.LATIN, CharClass.LATIN, "A", "I") == "keep"


def test_pair_kind_space():
    assert _pair_kind(CharClass.SPACE, CharClass.KANJI, " ", "生") == "keep"


# -- apply_spacing: sample text ---------------------------------------------------

def test_spacing_kanji_kanji_unchanged(bold_face: FontFace):
    shaped = shape(bold_face, SAMPLE)
    spaced = apply_spacing(shaped, SpacingRules.heading())
    original_adv = F(shaped.glyphs[0].x_advance, bold_face.upm)
    assert spaced.glyphs[0].advance == original_adv


def test_spacing_kana_gap_clamped(bold_face: FontFace):
    """Kana-containing pairs with gap > gMax are clamped to gMax."""
    shaped = shape(bold_face, SAMPLE)
    rules = SpacingRules.heading()
    spaced = apply_spacing(shaped, rules)
    kana_pairs = []
    for i in range(len(spaced.glyphs) - 1):
        a, b = spaced.glyphs[i], spaced.glyphs[i + 1]
        kind = _pair_kind(a.char_class, b.char_class,
                          SAMPLE[a.cluster], SAMPLE[b.cluster])
        if kind == "kana":
            g = _gap_after(spaced, i)
            if g is not None:
                kana_pairs.append((i, g))
    assert len(kana_pairs) > 0
    for idx, g in kana_pairs:
        assert g <= rules.g_max_kana, f"pair {idx}: gap {float(g):.4f} > gMax"


def test_spacing_kana_gap_below_gmin_untouched(bold_face: FontFace):
    """Pairs with gap < gMin are left alone even if kana is involved."""
    rules = SpacingRules.heading()
    shaped = shape(bold_face, "すっ")
    spaced = apply_spacing(shaped, rules)
    g = _gap_after(spaced, 0)
    if g is not None and g < rules.g_min:
        original_adv = F(shaped.glyphs[0].x_advance, bold_face.upm)
        assert spaced.glyphs[0].advance == original_adv


def test_spacing_je_boundary(bold_face: FontFace):
    """JE boundaries have ink gap = aJE."""
    shaped = shape(bold_face, SAMPLE)
    rules = SpacingRules.heading()
    spaced = apply_spacing(shaped, rules)
    je_gaps = []
    for i in range(len(spaced.glyphs) - 1):
        a, b = spaced.glyphs[i], spaced.glyphs[i + 1]
        kind = _pair_kind(a.char_class, b.char_class,
                          SAMPLE[a.cluster], SAMPLE[b.cluster])
        if kind == "je":
            g = _gap_after(spaced, i)
            if g is not None:
                je_gaps.append((i, g))
    assert len(je_gaps) >= 4
    for idx, g in je_gaps:
        assert g == rules.a_je, f"pair {idx}: gap {float(g):.4f} != aJE {float(rules.a_je)}"


def test_spacing_known_pair_no_kana_clamp(bold_face: FontFace):
    """de->sai (index 4->5): kana-kanji with gap 0.053 < gMax, no change."""
    shaped = shape(bold_face, SAMPLE)
    spaced = apply_spacing(shaped, SpacingRules.heading())
    original_adv = F(shaped.glyphs[4].x_advance, bold_face.upm)
    assert spaced.glyphs[4].advance == original_adv


def test_spacing_total_advance_shorter(bold_face: FontFace):
    """Spacing tightens kana and some JE gaps, so total should decrease."""
    shaped = shape(bold_face, SAMPLE)
    spaced = apply_spacing(shaped, SpacingRules.heading())
    original_total = F(shaped.total_advance, bold_face.upm)
    assert spaced.total_advance < original_total


# -- tracking --------------------------------------------------------------------

def test_tracking_positive(bold_face: FontFace):
    shaped = shape(bold_face, "生成")
    base = apply_spacing(shaped, SpacingRules.heading())
    tracked = apply_spacing(shaped, SpacingRules.heading(), tracking=F(2, 100))
    assert tracked.total_advance == base.total_advance + F(2, 100)


def test_tracking_negative(bold_face: FontFace):
    shaped = shape(bold_face, "生成")
    base = apply_spacing(shaped, SpacingRules.heading())
    tracked = apply_spacing(shaped, SpacingRules.heading(), tracking=F(-2, 100))
    assert tracked.total_advance == base.total_advance - F(2, 100)


# -- edge cases -------------------------------------------------------------------

def test_spacing_empty(bold_face: FontFace):
    shaped = shape(bold_face, "")
    spaced = apply_spacing(shaped, SpacingRules.heading())
    assert len(spaced.glyphs) == 0 and spaced.total_advance == ZERO


def test_spacing_single_glyph(bold_face: FontFace):
    shaped = shape(bold_face, "生")
    spaced = apply_spacing(shaped, SpacingRules.heading())
    assert len(spaced.glyphs) == 1
    assert spaced.glyphs[0].x == ZERO


def test_spacing_label_no_adjustment(bold_face: FontFace):
    shaped = shape(bold_face, SAMPLE)
    spaced = apply_spacing(shaped, SpacingRules.label())
    original_total = F(shaped.total_advance, bold_face.upm)
    assert spaced.total_advance == original_total


def test_spacing_deterministic(bold_face: FontFace):
    shaped = shape(bold_face, SAMPLE)
    r1 = apply_spacing(shaped, SpacingRules.heading())
    r2 = apply_spacing(shaped, SpacingRules.heading())
    assert [(g.x, g.advance) for g in r1.glyphs] == \
           [(g.x, g.advance) for g in r2.glyphs]


def test_spacing_positions_monotonic(bold_face: FontFace):
    shaped = shape(bold_face, SAMPLE)
    spaced = apply_spacing(shaped, SpacingRules.heading())
    for i in range(1, len(spaced.glyphs)):
        assert spaced.glyphs[i].x > spaced.glyphs[i - 1].x
