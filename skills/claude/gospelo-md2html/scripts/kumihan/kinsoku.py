"""Stage 2b, kinsoku: line-start / line-end prohibition and no-break-inside.

Applies JLREQ 3.1.7 (line-start / line-end) and 3.1.10 (no-break-inside) to
candidate break positions produced by the segmenter. A candidate position *i*
means "break between text[i-1] and text[i]": text[i] starts a new line.

A ``Kinsoku`` instance holds the character sets; ``feasible`` filters candidates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# -- JLREQ 3.1.7 character sets -------------------------------------------------

_LINE_START_CJK = frozenset(
    "、。，．・：；？！"
    "ー"
    "ゝゞヽヾ"
    "々"
    "ぁぃぅぇぉっゃゅょゎ"
    "ァィゥェォッャュョヮヵヶ"
    "」』）］｝〉》〕〙〗"
    "’”"
)

_LINE_START_ASCII = frozenset(")]},.:;!?")

_LINE_END_CJK = frozenset(
    "「『（［｛〈《〔〘〖"
    "‘“"
)

_LINE_END_ASCII = frozenset("([{")


# -- no-break-inside helpers -----------------------------------------------------

def _is_latin_or_digit(ch: str) -> bool:
    return ch.isascii() and (ch.isalpha() or ch.isdigit())


def _is_connector(ch: str) -> bool:
    return ch in "._-+/"


def _is_no_break_seq(ch: str) -> bool:
    return ch in "…‥—"  # ellipsis, two-dot leader, em dash


def _no_break_inside(text: str, i: int) -> bool:
    """Return True if a break at position *i* would split a no-break-inside run.

    Covers: Latin words, digit runs, mixed tokens like ``v1.2`` or ``2026-09``,
    and sequences of ``...``, ``..``, ``---``.
    """
    if not (0 < i < len(text)):
        return False
    left, right = text[i - 1], text[i]
    if _is_latin_or_digit(left) and _is_latin_or_digit(right):
        return True
    if _is_latin_or_digit(left) and _is_connector(right):
        return True
    if _is_connector(left) and _is_latin_or_digit(right):
        return True
    if _is_no_break_seq(left) and _is_no_break_seq(right):
        return True
    if _is_latin_or_digit(left) and right in "°℃℉%‰‱":
        return True
    return False


# -- Kinsoku data object ---------------------------------------------------------

@dataclass(frozen=True)
class Kinsoku:
    """Character sets for line-start / line-end prohibition."""

    line_start: frozenset[str] = field(default_factory=frozenset)
    line_end: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def default(cls) -> Kinsoku:
        return cls(
            line_start=_LINE_START_CJK | _LINE_START_ASCII,
            line_end=_LINE_END_CJK | _LINE_END_ASCII,
        )

    def describe(self) -> dict[str, Any]:
        return {
            "lineStart": sorted(self.line_start),
            "lineEnd": sorted(self.line_end),
        }


# -- feasibility filter -----------------------------------------------------------

def feasible(text: str, candidates: frozenset[int], kinsoku: Kinsoku | None = None) -> frozenset[int]:
    """Return the subset of *candidates* that do not violate kinsoku rules.

    A break at position *i* puts ``text[i-1]`` at line end and ``text[i]`` at
    line start. Rejected when:

    1. ``text[i]`` is in ``kinsoku.line_start`` (would start a line with a
       prohibited character).
    2. ``text[i-1]`` is in ``kinsoku.line_end`` (would end a line with a
       prohibited character).
    3. The break splits a no-break-inside run (Latin word, digit sequence,
       mixed token, or repeated no-break symbols).
    4. ``text[i]`` is an ASCII space (a space at the visible start of a line).
    """
    if kinsoku is None:
        kinsoku = Kinsoku.default()
    out: set[int] = set()
    for i in candidates:
        if not (0 < i < len(text)):
            continue
        if text[i] in kinsoku.line_start:
            continue
        if text[i - 1] in kinsoku.line_end:
            continue
        if _no_break_inside(text, i):
            continue
        if text[i] == " ":
            continue
        out.add(i)
    return frozenset(out)
