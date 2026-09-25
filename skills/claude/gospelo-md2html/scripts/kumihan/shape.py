"""Stage 3, shaping: cut the text into runs and shape each with HarfBuzz.

Script, language and direction are set explicitly per run (no
guess_segment_properties) so the result does not depend on HarfBuzz
heuristics. Language is passed as a plain string ("ja" / "en").

HarfBuzz does no line breaking here; the output is one flat glyph list for
the whole string with cluster = character index into the text. Feature tags
are recorded twice in the result: what the caller requested and what the font
actually has (BIZ UD has no GPOS, so palt / kern are requested but never
effective; that is a normal outcome, not an error).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import uharfbuzz as hb

from .chars import CharClass, RunKind, classify, run_kind
from .font import FontFace

SCRIPT_OF = {RunKind.JA: "Hani", RunKind.PUNCT: "Hani", RunKind.LATIN: "Latn", RunKind.SPACE: "Zyyy"}
LANGUAGE_OF = {RunKind.JA: "ja", RunKind.PUNCT: "ja", RunKind.LATIN: "en", RunKind.SPACE: "en"}


@dataclass(frozen=True)
class Run:
    start: int
    end: int
    kind: RunKind
    script: str
    language: str


@dataclass(frozen=True)
class ShapedGlyph:
    gid: int
    cluster: int      # index of the first character this glyph renders
    x_advance: int    # font units
    x_offset: int
    y_offset: int
    char_class: CharClass
    run: int          # index into Shaped.runs


@dataclass(frozen=True)
class Shaped:
    text: str
    face: FontFace
    glyphs: tuple[ShapedGlyph, ...]
    runs: tuple[Run, ...]
    features_requested: dict[str, bool]
    features_effective: dict[str, bool]

    @property
    def total_advance(self) -> int:
        return sum(g.x_advance for g in self.glyphs)


def split_runs(text: str) -> list[Run]:
    """Maximal runs of equal RunKind, in text order."""
    runs: list[Run] = []
    start = 0
    while start < len(text):
        kind = run_kind(text[start])
        end = start + 1
        while end < len(text) and run_kind(text[end]) is kind:
            end += 1
        runs.append(Run(start, end, kind, SCRIPT_OF[kind], LANGUAGE_OF[kind]))
        start = end
    return runs


def shape(face: FontFace, text: str, features: Mapping[str, bool] | None = None) -> Shaped:
    """Shape ``text`` with ``face``. ``features`` are OpenType tags -> on/off.

    Tags the font lacks are still passed to HarfBuzz (harmless) but are
    reported separately in ``features_effective`` for the decision record.
    """
    requested = dict(sorted((features or {}).items()))
    effective = {tag: on for tag, on in requested.items() if face.has_feature(tag)}
    runs = split_runs(text)
    font = face.hb_font()
    glyphs: list[ShapedGlyph] = []
    for run_index, run in enumerate(runs):
        buf = hb.Buffer()
        buf.add_str(text[run.start:run.end])
        buf.direction = "ltr"
        buf.script = run.script
        buf.language = run.language
        buf.cluster_level = hb.BufferClusterLevel.MONOTONE_CHARACTERS
        hb.shape(font, buf, requested)
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            cluster = run.start + info.cluster
            glyphs.append(ShapedGlyph(
                gid=info.codepoint,
                cluster=cluster,
                x_advance=pos.x_advance,
                x_offset=pos.x_offset,
                y_offset=pos.y_offset,
                char_class=classify(text[cluster]),
                run=run_index,
            ))
    return Shaped(text=text, face=face, glyphs=tuple(glyphs), runs=tuple(runs),
                  features_requested=requested, features_effective=effective)
