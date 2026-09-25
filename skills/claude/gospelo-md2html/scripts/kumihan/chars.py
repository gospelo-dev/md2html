"""Character classification shared by shaping, spacing and kinsoku.

Two views of a character:

- CharClass: what the spacing rules care about (kanji, kana, latin, punct,
  space). Full-width alphanumerics count as kanji (a full em body that is
  never tightened); ASCII punctuation counts as punct.
- RunKind: how the text is cut into shaping runs. Kanji and kana stay in one
  run so a font's kana/kanji kern pairs survive; ASCII punctuation stays
  inside the Latin run so "v1.2" is shaped as one word.
"""

from __future__ import annotations

import unicodedata
from enum import Enum


class CharClass(str, Enum):
    KANJI = "kanji"
    KANA = "kana"
    LATIN = "latin"
    PUNCT = "punct"
    SPACE = "space"
    OTHER = "other"


class RunKind(str, Enum):
    JA = "ja"
    LATIN = "latin"
    PUNCT = "punct"
    SPACE = "space"


_KANJI_RANGES = (
    (0x2E80, 0x2FDF),    # CJK radicals
    (0x3400, 0x4DBF),    # CJK extension A
    (0x4E00, 0x9FFF),    # CJK unified ideographs
    (0xF900, 0xFAFF),    # compatibility ideographs
    (0x20000, 0x3134F),  # extensions B..G
    (0xFF10, 0xFF19),    # full-width digits
    (0xFF21, 0xFF3A),    # full-width capitals
    (0xFF41, 0xFF5A),    # full-width small letters
)
_KANJI_EXTRA = frozenset("々〆〇〻")  # iteration marks, closing mark, zero: full-size bodies left untouched
_KANA_RANGES = (
    (0x3041, 0x3096),  # hiragana
    (0x3099, 0x309F),  # voicing marks and iteration marks
    (0x30A1, 0x30FA),  # katakana
    (0x30FC, 0x30FF),  # prolonged sound mark, iteration marks
    (0x31F0, 0x31FF),  # small katakana extension
    (0xFF66, 0xFF9F),  # half-width katakana
)
_KANA_EXTRA = frozenset()
_LATIN_RANGES = (
    (0x0030, 0x0039), (0x0041, 0x005A), (0x0061, 0x007A),
    (0x00C0, 0x024F),  # Latin-1 letters and Latin Extended A/B (ex. multiplication/division signs)
    (0x0370, 0x03FF),  # Greek
    (0x0400, 0x04FF),  # Cyrillic
    (0x1E00, 0x1EFF),  # Latin Extended Additional
)


def _in(ranges: tuple[tuple[int, int], ...], o: int) -> bool:
    return any(lo <= o <= hi for lo, hi in ranges)


def classify(ch: str) -> CharClass:
    o = ord(ch)
    if ch.isspace():
        return CharClass.SPACE
    if ch in _KANA_EXTRA or _in(_KANA_RANGES, o):
        return CharClass.KANA
    if ch in _KANJI_EXTRA or _in(_KANJI_RANGES, o):
        return CharClass.KANJI
    if _in(_LATIN_RANGES, o) and ch not in "×÷":
        return CharClass.LATIN
    cat = unicodedata.category(ch)
    if cat.startswith("P") or cat.startswith("S"):
        return CharClass.PUNCT
    if cat.startswith("L") or cat.startswith("N"):
        return CharClass.LATIN if ch.isascii() else CharClass.OTHER
    return CharClass.OTHER


def run_kind(ch: str) -> RunKind:
    cls = classify(ch)
    if cls is CharClass.SPACE:
        return RunKind.SPACE
    if cls is CharClass.LATIN:
        return RunKind.LATIN
    if cls is CharClass.PUNCT:
        return RunKind.LATIN if ch.isascii() else RunKind.PUNCT
    return RunKind.JA
