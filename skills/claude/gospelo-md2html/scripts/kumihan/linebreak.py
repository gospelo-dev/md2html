"""Stage 6a, line breaking: split text into lines to fit a given width.

Given spaced glyphs, a width constraint and feasible break positions, enumerate
break candidates, score for balance, and choose deterministically.

Line width is measured by ink (first glyph's ink left to last glyph's ink right).
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Callable

from .space import Spaced, ZERO


@dataclass(frozen=True)
class BreakCandidate:
    positions: tuple[int, ...]
    lines: tuple[tuple[int, int], ...]
    widths: tuple[Fraction, ...]
    score: Fraction

    def describe(self) -> dict[str, Any]:
        return {
            "positions": list(self.positions),
            "lines": [list(r) for r in self.lines],
            "widths": [float(w) for w in self.widths],
            "score": float(self.score),
        }


@dataclass(frozen=True)
class BreakResult:
    chosen: int
    candidates: tuple[BreakCandidate, ...]
    num_lines: int


Chooser = Callable[["tuple[BreakCandidate, ...]", int], int]


def line_ink_width(spaced: Spaced, start: int, end: int) -> Fraction:
    """Ink width of glyphs [start, end) in em."""
    if start >= end:
        return ZERO
    face = spaced.shaped.face
    upm = face.upm
    gs = spaced.glyphs
    adv_sum = sum(gs[j].advance for j in range(start, end - 1))
    last_ink = face.ink(gs[end - 1].gid)
    first_ink = face.ink(gs[start].gid)
    ink_right = (adv_sum + Fraction(last_ink.xmax, upm)
                 if not last_ink.is_empty
                 else adv_sum + gs[end - 1].advance)
    ink_left = (Fraction(first_ink.xmin, upm)
                if not first_ink.is_empty
                else ZERO)
    return ink_right - ink_left


def _score_2(w1: Fraction, w2: Fraction) -> Fraction:
    balance = abs(w1 - w2)
    penalty = ZERO
    if w1 > ZERO and w2 * 2 < w1:
        penalty = w1 - w2 * 2
    return balance + penalty


def _score_3(widths: tuple[Fraction, ...]) -> Fraction:
    max_w = max(widths)
    return max_w * 1000 + (max_w - min(widths))


def _is_single_phrase(pos: int, end: int,
                      all_candidates: frozenset[int]) -> bool:
    return not any(pos < b < end for b in all_candidates)


def default_chooser(candidates: tuple[BreakCandidate, ...],
                    text_len: int) -> int:
    center = Fraction(text_len, 2)

    def key(idx: int) -> tuple:
        c = candidates[idx]
        avg_pos = (Fraction(sum(c.positions), len(c.positions))
                   if c.positions else ZERO)
        return (c.score, abs(avg_pos - center), c.positions)

    return min(range(len(candidates)), key=key)


def find_breaks(
    spaced: Spaced,
    width_em: Fraction,
    feasible_positions: frozenset[int],
    max_lines: int = 2,
    chooser: Chooser | None = None,
) -> BreakResult | None:
    n = len(spaced.glyphs)
    if n == 0:
        single = BreakCandidate((), ((0, 0),), (ZERO,), ZERO)
        return BreakResult(chosen=0, candidates=(single,), num_lines=1)

    w_single = line_ink_width(spaced, 0, n)
    if w_single <= width_em:
        single = BreakCandidate((), ((0, n),), (w_single,), ZERO)
        return BreakResult(chosen=0, candidates=(single,), num_lines=1)

    if max_lines < 2:
        return None

    cands: list[BreakCandidate] = []
    for pos in sorted(feasible_positions):
        if not (0 < pos < n):
            continue
        w1 = line_ink_width(spaced, 0, pos)
        w2 = line_ink_width(spaced, pos, n)
        if w1 > width_em or w2 > width_em:
            continue
        if _is_single_phrase(pos, n, feasible_positions) and (n - pos) < 4:
            continue
        cands.append(BreakCandidate(
            positions=(pos,), lines=((0, pos), (pos, n)),
            widths=(w1, w2), score=_score_2(w1, w2),
        ))

    if cands:
        tc = tuple(cands)
        ch = chooser(tc, n) if chooser else default_chooser(tc, n)
        return BreakResult(chosen=ch, candidates=tc, num_lines=2)

    if max_lines >= 3:
        return _find_3line(spaced, width_em, feasible_positions, chooser)
    return None


def _find_3line(
    spaced: Spaced,
    width_em: Fraction,
    feasible_positions: frozenset[int],
    chooser: Chooser | None,
) -> BreakResult | None:
    n = len(spaced.glyphs)
    positions = sorted(feasible_positions)
    cands: list[BreakCandidate] = []
    for i, p1 in enumerate(positions):
        if p1 <= 0 or p1 >= n:
            continue
        for p2 in positions[i + 1:]:
            if p2 >= n:
                continue
            w1 = line_ink_width(spaced, 0, p1)
            w2 = line_ink_width(spaced, p1, p2)
            w3 = line_ink_width(spaced, p2, n)
            if w1 > width_em or w2 > width_em or w3 > width_em:
                continue
            cands.append(BreakCandidate(
                positions=(p1, p2),
                lines=((0, p1), (p1, p2), (p2, n)),
                widths=(w1, w2, w3), score=_score_3((w1, w2, w3)),
            ))
    if not cands:
        return None
    tc = tuple(cands)
    ch = chooser(tc, n) if chooser else default_chooser(tc, n)
    return BreakResult(chosen=ch, candidates=tc, num_lines=3)
