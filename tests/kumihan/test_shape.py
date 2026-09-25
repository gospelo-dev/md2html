"""K02: shaping with HarfBuzz. Smoke-tested values from 07_measurements.md."""

from conftest import BIZUD_BOLD

from kumihan import FontFace
from kumihan.chars import CharClass, RunKind, classify, run_kind
from kumihan.shape import Run, Shaped, ShapedGlyph, split_runs, shape

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"


# -- chars.py -------------------------------------------------------------------

def test_classify_kanji():
    for ch in "生成再現性高組版年":
        assert classify(ch) is CharClass.KANJI, ch


def test_classify_kana():
    for ch in "でのいをする":
        assert classify(ch) is CharClass.KANA, ch
    assert classify("ー") is CharClass.KANA


def test_classify_latin():
    for ch in "AHISVG0126":
        assert classify(ch) is CharClass.LATIN, ch


def test_classify_punct():
    for ch in "、（）":
        assert classify(ch) is CharClass.PUNCT, ch


def test_classify_space():
    assert classify(" ") is CharClass.SPACE
    assert classify("\t") is CharClass.SPACE


def test_classify_fullwidth_as_kanji():
    assert classify("Ａ") is CharClass.KANJI
    assert classify("１") is CharClass.KANJI


def test_classify_iteration_marks():
    for ch in "々〆〇〻":
        assert classify(ch) is CharClass.KANJI, ch


def test_run_kind_routing():
    assert run_kind("生") is RunKind.JA
    assert run_kind("す") is RunKind.JA
    assert run_kind("A") is RunKind.LATIN
    assert run_kind("、") is RunKind.PUNCT
    assert run_kind(" ") is RunKind.SPACE
    assert run_kind(".") is RunKind.LATIN  # ASCII punct stays in latin run
    assert run_kind("（") is RunKind.PUNCT


# -- split_runs ------------------------------------------------------------------

def test_split_runs_sample():
    runs = split_runs(SAMPLE)
    got = [(r.kind.value, r.start, r.end) for r in runs]
    expected = [
        ("ja", 0, 2), ("latin", 2, 4), ("ja", 4, 11), ("latin", 11, 13),
        ("ja", 13, 16), ("punct", 16, 17), ("latin", 17, 20), ("ja", 20, 25),
        ("punct", 25, 26), ("latin", 26, 30), ("ja", 30, 32), ("punct", 32, 33),
    ]
    assert got == expected


def test_split_runs_scripts():
    runs = split_runs(SAMPLE)
    for r in runs:
        if r.kind in (RunKind.JA, RunKind.PUNCT):
            assert r.script == "Hani" and r.language == "ja"
        elif r.kind is RunKind.LATIN:
            assert r.script == "Latn" and r.language == "en"


def test_split_runs_empty():
    assert split_runs("") == []


def test_split_runs_single_char():
    runs = split_runs("A")
    assert len(runs) == 1 and runs[0].kind is RunKind.LATIN


# -- shape -----------------------------------------------------------------------

def test_shape_glyph_count(bold_face: FontFace):
    result = shape(bold_face, SAMPLE, {"palt": True, "kern": True})
    assert len(result.glyphs) == 33


def test_shape_total_advance(bold_face: FontFace):
    result = shape(bold_face, SAMPLE)
    total_em = round(result.total_advance / bold_face.upm, 3)
    assert total_em == 28.628


def test_shape_features_effective_empty(bold_face: FontFace):
    result = shape(bold_face, SAMPLE, {"palt": True, "kern": True})
    assert result.features_requested == {"kern": True, "palt": True}
    assert result.features_effective == {}


def test_shape_cluster_matches_text_index(bold_face: FontFace):
    result = shape(bold_face, SAMPLE)
    clusters = [g.cluster for g in result.glyphs]
    assert clusters == list(range(33))


def test_shape_char_classes_assigned(bold_face: FontFace):
    result = shape(bold_face, SAMPLE)
    assert result.glyphs[0].char_class is CharClass.KANJI    # 生
    assert result.glyphs[2].char_class is CharClass.LATIN     # A
    assert result.glyphs[4].char_class is CharClass.KANA      # で
    assert result.glyphs[16].char_class is CharClass.PUNCT    # 、


def test_shape_no_features(bold_face: FontFace):
    result = shape(bold_face, SAMPLE)
    assert result.features_requested == {}
    total = result.total_advance
    result2 = shape(bold_face, SAMPLE, {"palt": True, "kern": True})
    assert result2.total_advance == total


def test_shape_empty(bold_face: FontFace):
    result = shape(bold_face, "")
    assert len(result.glyphs) == 0 and result.total_advance == 0


def test_shape_deterministic(bold_face: FontFace):
    r1 = shape(bold_face, SAMPLE)
    r2 = shape(bold_face, SAMPLE)
    assert [(g.gid, g.x_advance) for g in r1.glyphs] == [(g.gid, g.x_advance) for g in r2.glyphs]
