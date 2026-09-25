"""Stage 6b, fit: drive the shrink loop and strategy selection.

Strategies:
- ``wrap+shrink``: 1-line -> 2-line -> shrink S by 1/1.1 steps -> 3-line -> error
- ``wrap``: 1-line -> 2-line -> 3-line -> error (no shrinking)
- ``ellipsis``: 1-line, truncate with ... if overflow
- ``none``: 1-line, warn if overflow (no breaking or shrinking)
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from .errors import FitError
from .linebreak import (
    BreakCandidate,
    BreakResult,
    Chooser,
    find_breaks,
    line_ink_width,
)
from .space import Spaced, ZERO


@dataclass(frozen=True)
class Fit:
    strategy: str
    max_lines: int
    shrink_step: Fraction
    min_scale: Fraction

    @classmethod
    def wrap_shrink(cls, max_lines: int = 2,
                    min_scale: Fraction = Fraction(8, 11)) -> Fit:
        return cls("wrap+shrink", max_lines, Fraction(10, 11), min_scale)

    @classmethod
    def wrap(cls, max_lines: int = 2) -> Fit:
        return cls("wrap", max_lines, Fraction(1), Fraction(1))

    @classmethod
    def ellipsis(cls) -> Fit:
        return cls("ellipsis", 1, Fraction(1), Fraction(1))

    @classmethod
    def none(cls) -> Fit:
        return cls("none", 1, Fraction(1), Fraction(1))

    def describe(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy,
            "maxLines": self.max_lines,
            "shrinkStep": float(self.shrink_step),
            "minScale": float(self.min_scale),
        }


@dataclass(frozen=True)
class FitResult:
    spaced: Spaced
    breaks: BreakResult
    scale: Fraction
    warnings: tuple[str, ...] = ()


def try_fit(
    spaced: Spaced,
    width_em: Fraction,
    feasible_positions: frozenset[int],
    fit: Fit,
    chooser: Chooser | None = None,
) -> FitResult:
    n = len(spaced.glyphs)

    if fit.strategy == "none":
        result = find_breaks(spaced, Fraction(10**9), frozenset(), max_lines=1)
        w = line_ink_width(spaced, 0, n) if n > 0 else ZERO
        warnings = ("overflow",) if w > width_em else ()
        return FitResult(spaced, result, Fraction(1), warnings)

    if fit.strategy == "ellipsis":
        return _fit_ellipsis(spaced, width_em)

    can_shrink = fit.strategy == "wrap+shrink"
    scale = Fraction(1)
    tried_min = False

    while True:
        effective_width = width_em / scale
        result = find_breaks(spaced, effective_width, feasible_positions,
                             max_lines=min(fit.max_lines, 2), chooser=chooser)
        if result is not None:
            warnings = ()
            if scale < Fraction(1):
                warnings = (f"shrunk to {float(scale):.4f}",)
            return FitResult(spaced, result, scale, warnings)

        if not can_shrink:
            break

        next_scale = scale * fit.shrink_step
        if next_scale < fit.min_scale:
            if not tried_min and scale > fit.min_scale:
                scale = fit.min_scale
                tried_min = True
                continue
            break
        scale = next_scale

    final_scale = fit.min_scale if can_shrink else Fraction(1)
    effective_width = width_em / final_scale
    result = find_breaks(spaced, effective_width, feasible_positions,
                         max_lines=3, chooser=chooser)
    if result is not None:
        warnings = ["3 lines"]
        if final_scale < Fraction(1):
            warnings.insert(0, f"shrunk to {float(final_scale):.4f}")
        return FitResult(spaced, result, final_scale, tuple(warnings))

    raise FitError("text does not fit", candidates=[], warnings=["overflow"])


def _fit_ellipsis(spaced: Spaced, width_em: Fraction) -> FitResult:
    n = len(spaced.glyphs)
    if n == 0:
        result = find_breaks(spaced, width_em, frozenset(), max_lines=1)
        return FitResult(spaced, result, Fraction(1))

    result = find_breaks(spaced, width_em, frozenset(), max_lines=1)
    if result is not None:
        return FitResult(spaced, result, Fraction(1))

    face = spaced.shaped.face
    upm = face.upm
    ellipsis_gid = face.gid("…")
    if ellipsis_gid is None:
        raise FitError("ellipsis glyph not in font", candidates=[], warnings=[])
    ellipsis_adv = Fraction(face.advance(ellipsis_gid), upm)

    for cut in range(n, 0, -1):
        text_w = line_ink_width(spaced, 0, cut)
        if text_w + ellipsis_adv <= width_em:
            cand = BreakCandidate((), ((0, cut),), (text_w + ellipsis_adv,), ZERO)
            br = BreakResult(chosen=0, candidates=(cand,), num_lines=1)
            return FitResult(spaced, br, Fraction(1),
                             warnings=(f"truncated at {cut}/{n}",))

    raise FitError("text too wide even at 1 char + ellipsis",
                   candidates=[], warnings=["overflow"])
