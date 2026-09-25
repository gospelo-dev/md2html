"""Stage 5, spacing: adjust inter-glyph gaps by character class.

For each adjacent pair (a, b), the ink gap ``g = RSB(a) + LSB(b)`` (em) is
compared to rule thresholds and the advance of *a* is adjusted so the ink gap
matches the target. Rules from 02_rules.md sections 2--3:

1. Kanji--kanji: leave alone.
2. Kana-containing pair (both JA, at least one kana): clamp g to gMax if
   g > gMax, skip if g < gMin.
3. JA--Latin boundary: set g to aJE (bidirectional).
4. CJK punct--CJK punct: squeeze g to punct_run (0.25 em).
5. Punct with anything else: leave alone.

Tracking is added to every inter-glyph gap after the pair rules.

All arithmetic uses ``fractions.Fraction``; rounding happens once in the
place stage (K06).
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from .chars import CharClass
from .shape import Shaped, ShapedGlyph

ZERO = Fraction(0)

_JA = frozenset({CharClass.KANJI, CharClass.KANA, CharClass.OTHER})


@dataclass(frozen=True)
class SpacingRules:
    g_max_kana: Fraction
    g_min: Fraction
    a_je: Fraction
    punct_run: Fraction
    trim_start: bool
    trim_end: bool

    @classmethod
    def heading(cls) -> SpacingRules:
        return cls(
            g_max_kana=Fraction(6, 100),
            g_min=Fraction(2, 100),
            a_je=Fraction(1, 8),
            punct_run=Fraction(1, 4),
            trim_start=True,
            trim_end=True,
        )

    @classmethod
    def subheading(cls) -> SpacingRules:
        return cls(
            g_max_kana=Fraction(8, 100),
            g_min=Fraction(2, 100),
            a_je=Fraction(1, 8),
            punct_run=Fraction(1, 4),
            trim_start=True,
            trim_end=True,
        )

    @classmethod
    def caption(cls) -> SpacingRules:
        return cls(
            g_max_kana=Fraction(10, 100),
            g_min=Fraction(2, 100),
            a_je=Fraction(1, 8),
            punct_run=Fraction(1, 4),
            trim_start=True,
            trim_end=True,
        )

    @classmethod
    def label(cls) -> SpacingRules:
        return cls(
            g_max_kana=Fraction(1),
            g_min=ZERO,
            a_je=ZERO,
            punct_run=Fraction(1, 4),
            trim_start=False,
            trim_end=False,
        )

    def describe(self) -> dict[str, Any]:
        return {
            "gMaxKana": float(self.g_max_kana),
            "gMin": float(self.g_min),
            "aJE": float(self.a_je),
            "punctRun": float(self.punct_run),
            "trimStart": self.trim_start,
            "trimEnd": self.trim_end,
        }


@dataclass(frozen=True)
class SpacedGlyph:
    gid: int
    cluster: int
    x: Fraction
    advance: Fraction
    char_class: CharClass
    run: int


@dataclass(frozen=True)
class Spaced:
    shaped: Shaped
    glyphs: tuple[SpacedGlyph, ...]
    rules: SpacingRules
    tracking: Fraction

    @property
    def total_advance(self) -> Fraction:
        if not self.glyphs:
            return ZERO
        last = self.glyphs[-1]
        return last.x + last.advance


def _pair_kind(a_cls: CharClass, b_cls: CharClass,
               a_ch: str, b_ch: str) -> str:
    if a_cls is CharClass.SPACE or b_cls is CharClass.SPACE:
        return "keep"
    if a_cls is CharClass.PUNCT or b_cls is CharClass.PUNCT:
        if a_cls is CharClass.PUNCT and b_cls is CharClass.PUNCT:
            if not a_ch.isascii() and not b_ch.isascii():
                return "punct"
        return "keep"
    if a_cls in _JA and b_cls in _JA:
        if a_cls is CharClass.KANA or b_cls is CharClass.KANA:
            return "kana"
        return "keep"
    if (a_cls in _JA and b_cls is CharClass.LATIN) or \
       (a_cls is CharClass.LATIN and b_cls in _JA):
        return "je"
    return "keep"


def ink_gap(face, gid_a: int, gid_b: int, advance_a: Fraction) -> Fraction | None:
    """Ink gap between two adjacent glyphs: RSB(a) + LSB(b) in em."""
    upm = face.upm
    ink_a = face.ink(gid_a)
    ink_b = face.ink(gid_b)
    if ink_a.is_empty or ink_b.is_empty:
        return None
    rsb = advance_a - Fraction(ink_a.xmax, upm)
    lsb = Fraction(ink_b.xmin, upm)
    return rsb + lsb


def apply_spacing(shaped: Shaped, rules: SpacingRules,
                  tracking: Fraction = ZERO) -> Spaced:
    """Apply spacing rules to *shaped* glyphs. Returns adjusted positions in em."""
    face = shaped.face
    upm = face.upm
    text = shaped.text
    src = shaped.glyphs
    n = len(src)

    if n == 0:
        return Spaced(shaped=shaped, glyphs=(), rules=rules, tracking=tracking)

    advances = [Fraction(g.x_advance, upm) for g in src]

    for i in range(n - 1):
        a, b = src[i], src[i + 1]
        kind = _pair_kind(a.char_class, b.char_class,
                          text[a.cluster], text[b.cluster])
        if kind == "keep":
            continue

        g = ink_gap(face, a.gid, b.gid, advances[i])
        if g is None:
            continue

        if kind == "kana":
            if g < rules.g_min:
                continue
            if g > rules.g_max_kana:
                advances[i] += rules.g_max_kana - g
        elif kind == "je":
            if rules.a_je > ZERO:
                advances[i] += rules.a_je - g
        elif kind == "punct":
            advances[i] += rules.punct_run - g

    if tracking:
        for i in range(n - 1):
            advances[i] += tracking

    out: list[SpacedGlyph] = []
    x = ZERO
    for i, g in enumerate(src):
        out.append(SpacedGlyph(
            gid=g.gid, cluster=g.cluster, x=x,
            advance=advances[i], char_class=g.char_class, run=g.run,
        ))
        x += advances[i]

    return Spaced(shaped=shaped, glyphs=tuple(out), rules=rules,
                  tracking=tracking)
