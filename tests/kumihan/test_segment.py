"""K03: normalisation, segmentation (BudouX) and kinsoku.

Smoke-tested values from 07_measurements.md and the handover."""

import pytest

from kumihan.normalize import Normalized, normalize, BREAK_ALLOWED, BREAK_FORBIDDEN
from kumihan.segment import (
    BudouXSegmenter,
    EveryCharSegmenter,
    NoBreakSegmenter,
    candidate_breaks,
)
from kumihan.kinsoku import Kinsoku, feasible, _no_break_inside

SAMPLE = "生成AIで再現性の高いH1組版を、SVGで実現する（2026年版）"


# -- normalize -------------------------------------------------------------------

def test_normalize_nfc():
    n = normalize("Ａ")
    assert n.text == "Ａ"  # full-width stays (ascii_fold off)


def test_normalize_ascii_fold():
    n = normalize("Ａ１", ascii_fold=True)
    assert n.text == "A1"


def test_normalize_ascii_fold_default_off():
    n = normalize("Ａ１")
    assert n.text == "Ａ１"
    assert n.options == {"asciiFold": False}


def test_normalize_whitespace():
    n = normalize("  a  b   c  ")
    assert n.text == "a b c"


def test_normalize_fullwidth_space_preserved():
    n = normalize("あ　い")
    assert "　" in n.text


def test_normalize_zwsp_allow():
    n = normalize("あ" + BREAK_ALLOWED + "い")
    assert n.text == "あい"
    assert 1 in n.allow


def test_normalize_wj_forbid():
    n = normalize("あ" + BREAK_FORBIDDEN + "い")
    assert n.text == "あい"
    assert 1 in n.forbid


def test_normalize_marks_at_boundary_dropped():
    n = normalize(BREAK_ALLOWED + "あい" + BREAK_FORBIDDEN)
    assert n.text == "あい"
    assert n.allow == frozenset()
    assert n.forbid == frozenset()


def test_normalize_forbid_wins_over_allow():
    text = "あ" + BREAK_ALLOWED + BREAK_FORBIDDEN + "い"
    n = normalize(text)
    assert n.text == "あい"
    assert 1 in n.forbid


# -- BudouXSegmenter --------------------------------------------------------------

def test_budoux_phrases():
    seg = BudouXSegmenter()
    phrases = seg.phrases(SAMPLE)
    assert phrases == [
        "生成AIで", "再現性の", "高い", "H1組版を、",
        "SVGで", "実現する", "（2026年版）",
    ]


def test_budoux_boundaries():
    seg = BudouXSegmenter()
    b = seg.boundaries(SAMPLE)
    assert b == frozenset({5, 9, 11, 17, 21, 25})


def test_budoux_describe():
    seg = BudouXSegmenter()
    d = seg.describe()
    assert d["name"] == "budoux" and "version" in d
    assert d["model"] == "ja"
    assert d["sha256"].startswith("22e0d9aa137cd76c")


def test_budoux_empty():
    seg = BudouXSegmenter()
    assert seg.phrases("") == []
    assert seg.boundaries("") == frozenset()


# -- NoBreakSegmenter / EveryCharSegmenter -----------------------------------------

def test_nobreak():
    seg = NoBreakSegmenter()
    assert seg.boundaries("abc") == frozenset()
    assert seg.describe() == {"name": "nobreak"}


def test_everychar():
    seg = EveryCharSegmenter()
    assert seg.boundaries("abcd") == frozenset({1, 2, 3})
    assert seg.describe() == {"name": "everychar"}


# -- candidate_breaks with manual marks -------------------------------------------

def test_candidate_breaks_sample():
    n = normalize(SAMPLE)
    seg = BudouXSegmenter()
    c = candidate_breaks(n, seg)
    assert c == frozenset({5, 9, 11, 17, 21, 25})


def test_candidate_breaks_allow_adds():
    n = normalize("あい" + BREAK_ALLOWED + "うえ")
    seg = NoBreakSegmenter()
    c = candidate_breaks(n, seg)
    assert 2 in c


def test_candidate_breaks_forbid_removes():
    text = "あ" + BREAK_FORBIDDEN + "い" + BREAK_ALLOWED + "う"
    n = normalize(text)
    seg = EveryCharSegmenter()
    c = candidate_breaks(n, seg)
    assert 1 not in c
    assert 2 in c


# -- kinsoku: character sets -------------------------------------------------------

def test_kinsoku_default_sets():
    k = Kinsoku.default()
    assert "、" in k.line_start
    assert "。" in k.line_start
    assert "）" in k.line_start
    assert ")" in k.line_start
    assert "!" in k.line_start
    assert "ー" in k.line_start
    assert "っ" in k.line_start
    assert "ッ" in k.line_start
    assert "々" in k.line_start
    assert "（" in k.line_end
    assert "「" in k.line_end
    assert "(" in k.line_end


def test_kinsoku_describe():
    k = Kinsoku.default()
    d = k.describe()
    assert isinstance(d["lineStart"], list)
    assert isinstance(d["lineEnd"], list)
    assert d["lineStart"] == sorted(d["lineStart"])
    assert d["lineEnd"] == sorted(d["lineEnd"])


# -- kinsoku: no_break_inside -----------------------------------------------------

def test_no_break_latin_word():
    assert _no_break_inside("Hello", 2) is True   # l|l
    assert _no_break_inside("He", 1) is True      # H|e


def test_no_break_digits():
    assert _no_break_inside("2026", 2) is True     # 0|2


def test_no_break_mixed_token():
    assert _no_break_inside("v1.2", 1) is True     # v|1
    assert _no_break_inside("v1.2", 2) is True     # 1|.
    assert _no_break_inside("v1.2", 3) is True     # .|2


def test_no_break_unit():
    assert _no_break_inside("30°", 2) is True
    assert _no_break_inside("100%", 3) is True


def test_no_break_ellipsis_sequence():
    assert _no_break_inside("……", 1) is True
    assert _no_break_inside("——", 1) is True


def test_break_allowed_between_ja_and_latin():
    assert _no_break_inside("あA", 1) is False


def test_break_at_boundaries():
    assert _no_break_inside("abc", 0) is False
    assert _no_break_inside("abc", 3) is False


# -- kinsoku: feasible ------------------------------------------------------------

def test_feasible_sample():
    n = normalize(SAMPLE)
    seg = BudouXSegmenter()
    candidates = candidate_breaks(n, seg)
    f = feasible(SAMPLE, candidates)
    assert f == candidates  # BudouX already avoids prohibited positions
    for i in f:
        assert SAMPLE[i] not in Kinsoku.default().line_start
        assert SAMPLE[i - 1] not in Kinsoku.default().line_end


def test_feasible_blocks_line_start_prohibited():
    text = "あ、い"
    candidates = frozenset({1, 2})
    f = feasible(text, candidates)
    assert 2 in f       # い can start a line
    assert 1 not in f   # 、 cannot start a line


def test_feasible_blocks_line_end_prohibited():
    text = "「あ」い"
    candidates = frozenset({1, 2, 3})
    f = feasible(text, candidates)
    assert 1 not in f   # 「 cannot end a line
    assert 3 in f       # 」 can end a line (not in line_end set)


def test_feasible_blocks_space_at_line_start():
    text = "a b"
    candidates = frozenset({1, 2})
    f = feasible(text, candidates)
    assert 1 not in f   # space at line start
    assert 2 in f       # 'b' after space is ok


def test_feasible_blocks_no_break_inside():
    text = "あABCい"
    candidates = frozenset({1, 2, 3, 4})
    f = feasible(text, candidates)
    assert 2 not in f and 3 not in f  # inside "ABC"
    assert 1 in f and 4 in f          # between ja and latin


def test_feasible_empty_candidates():
    f = feasible("あいう", frozenset())
    assert f == frozenset()


def test_feasible_with_custom_kinsoku():
    k = Kinsoku(line_start=frozenset("い"), line_end=frozenset())
    f = feasible("あいう", frozenset({1, 2}), k)
    assert 1 not in f  # い is in custom line_start
    assert 2 in f
