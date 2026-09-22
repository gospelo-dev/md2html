"""Stage 7, placement: convert em Fractions to font-unit integers.

The only rounding in the pipeline. ``round()`` on ``Fraction`` does
ROUND_HALF_EVEN (banker's rounding) which is what we want.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from .fit import FitResult
from .space import ZERO


@dataclass(frozen=True)
class PlacedGlyph:
    gid: int
    x: int
    y: int
    cluster: int


@dataclass(frozen=True)
class PlacedLine:
    glyphs: tuple[PlacedGlyph, ...]
    baseline_y: int
    ink_left: int
    ink_right: int
    start: int
    end: int


@dataclass(frozen=True)
class Placement:
    lines: tuple[PlacedLine, ...]
    viewbox_width: int
    viewbox_height: int


def place(fit_result: FitResult, width_em: Fraction,
          line_height: Fraction) -> Placement:
    spaced = fit_result.spaced
    face = spaced.shaped.face
    upm = face.upm
    scale = fit_result.scale
    breaks = fit_result.breaks
    rules = spaced.rules
    chosen = breaks.candidates[breaks.chosen]
    num_lines = len(chosen.lines)
    ascent_norm = face.ascent_norm

    vb_width = round(width_em / scale * upm)
    vb_height = round(Fraction(num_lines) * line_height * upm)

    placed: list[PlacedLine] = []
    for i, (start, end) in enumerate(chosen.lines):
        if start >= end:
            placed.append(PlacedLine((), 0, 0, 0, start, end))
            continue

        line_top = Fraction(i) * line_height * upm
        em_top = line_top + (line_height * upm - upm) / 2
        baseline = round(em_top + ascent_norm * upm)

        first_x = spaced.glyphs[start].x
        trim_off = ZERO
        if rules.trim_start:
            ink0 = face.ink(spaced.glyphs[start].gid)
            if not ink0.is_empty:
                trim_off = -Fraction(ink0.xmin, upm)

        gs: list[PlacedGlyph] = []
        for j in range(start, end):
            sg = spaced.glyphs[j]
            x = round((sg.x - first_x + trim_off) * upm)
            gs.append(PlacedGlyph(gid=sg.gid, x=x, y=baseline,
                                  cluster=sg.cluster))

        ink0 = face.ink(gs[0].gid)
        ink_l = gs[0].x + ink0.xmin if not ink0.is_empty else gs[0].x

        last_sg = spaced.glyphs[end - 1]
        last_ink = face.ink(last_sg.gid)
        last_x = round((last_sg.x - first_x + trim_off) * upm)
        ink_r = (last_x + last_ink.xmax if not last_ink.is_empty
                 else round((last_sg.x - first_x + trim_off + last_sg.advance) * upm))

        placed.append(PlacedLine(
            glyphs=tuple(gs), baseline_y=baseline,
            ink_left=ink_l, ink_right=ink_r,
            start=start, end=end,
        ))

    return Placement(lines=tuple(placed),
                     viewbox_width=vb_width, viewbox_height=vb_height)
