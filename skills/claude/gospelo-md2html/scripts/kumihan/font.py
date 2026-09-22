"""FontFace: one font file (or one face of a .ttc) read once, with per-glyph caches.

Provides what the later stages need from a font and nothing else:

- identity for the decision record: file name, ttc index, sha256, upm, names,
  weight class, applied variation axes
- vertical metrics (hhea, OS/2) for placing the em box inside the line box
- the OpenType feature tags per table, so shaping can tell requested from
  effective features (BIZ UD has no GPOS at all; that is a normal case)
- an sfnt byte string HarfBuzz can open (woff2 is decompressed here)
- ink bounds and outlines per glyph id, cached; outlines are cached as pen
  recordings so the emitter can replay them through a TransformPen without
  re-parsing the glyph

A FontFace is immutable after load. Variable fonts are instanced at load
(``variations``) so the glyph caches are valid for exactly one instance.
"""

from __future__ import annotations

import hashlib
import io
import math
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any, Mapping, NamedTuple

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont, TTLibError

from .errors import FontError

FONT_SUFFIXES = (".ttf", ".otf", ".woff", ".woff2", ".ttc", ".otc")


class Bounds(NamedTuple):
    """Ink bounds of a glyph in integer font units (y up). Empty glyphs are all zero."""

    xmin: int
    ymin: int
    xmax: int
    ymax: int

    @property
    def is_empty(self) -> bool:
        return self.xmin == self.xmax and self.ymin == self.ymax

    @property
    def width(self) -> int:
        return self.xmax - self.xmin

    @property
    def height(self) -> int:
        return self.ymax - self.ymin


EMPTY_BOUNDS = Bounds(0, 0, 0, 0)


@dataclass(frozen=True)
class Axis:
    """A variation axis from fvar."""

    tag: str
    minimum: float
    default: float
    maximum: float


@dataclass(frozen=True)
class VerticalMetrics:
    """Vertical metrics in font units. hhea values drive the em box; OS/2 are informational."""

    ascent: int
    descent: int  # negative in hhea
    line_gap: int
    typo_ascender: int | None
    typo_descender: int | None
    typo_line_gap: int | None
    win_ascent: int | None
    win_descent: int | None
    x_height: int | None
    cap_height: int | None


def svg_number(value: float) -> str:
    """Number formatter for SVG path data: integers only, half-even rounding.

    TrueType outlines are already integral, so this is exact for BIZ UD. CFF
    outlines with fractional coordinates are rounded once, here.
    """
    return str(round(value))


class FontFace:
    """One font instance with cached glyph geometry. Construct with FontFace.load()."""

    def __init__(self, *, path: Path, index: int, sha256: str, ttfont: TTFont, sfnt: bytes,
                 variations: Mapping[str, float]):
        self.path = path
        self.index = index
        self.sha256 = sha256
        self._tt = ttfont
        self._sfnt = sfnt
        self.variations: dict[str, float] = dict(sorted(variations.items()))

        self.upm: int = int(ttfont["head"].unitsPerEm)
        self.glyph_count: int = int(ttfont["maxp"].numGlyphs)
        self.family, self.subfamily, self.postscript_name = _names(ttfont)
        self.weight: int | None = _os2_attr(ttfont, "usWeightClass")
        self.metrics = _vertical_metrics(ttfont)
        self.features: dict[str, frozenset[str]] = _feature_tags(ttfont)
        self.axes: dict[str, Axis] = _axes(ttfont)

        self._order: list[str] = ttfont.getGlyphOrder()
        self._cmap: dict[int, str] = ttfont.getBestCmap() or {}
        self._name_to_gid: dict[str, int] = {name: gid for gid, name in enumerate(self._order)}
        self._glyph_set = ttfont.getGlyphSet(location=self.variations or None)
        self._hmtx = ttfont["hmtx"].metrics if "hmtx" in ttfont else {}
        self._ink: dict[int, Bounds] = {}
        self._outline: dict[int, RecordingPen] = {}
        self._hb_face: hb.Face | None = None

    # ------------------------------------------------------------------
    # loading
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: str | Path, index: int = 0, variations: Mapping[str, float] | None = None) -> "FontFace":
        """Read a .ttf / .otf / .woff / .woff2 / .ttc file.

        ``index`` selects a face of a collection. ``variations`` sets axis values
        of a variable font (e.g. {"wght": 700}); unknown tags raise FontError.
        """
        path = Path(path)
        if not path.is_file():
            raise FontError(f"font file not found: {path}")
        data = path.read_bytes()
        try:
            tt = TTFont(io.BytesIO(data), fontNumber=index, recalcBBoxes=False, recalcTimestamp=False)
        except (TTLibError, IndexError, ValueError, KeyError, OSError) as e:
            raise FontError(f"cannot read font {path.name} (index {index}): {e}") from e
        for table in ("head", "maxp", "hhea", "cmap"):
            if table not in tt:
                raise FontError(f"font {path.name} lacks the {table} table")

        axes = _axes(tt)
        variations = dict(variations or {})
        for tag, value in variations.items():
            axis = axes.get(tag)
            if axis is None:
                raise FontError(f"font {path.name} has no variation axis {tag!r}")
            if not (axis.minimum <= value <= axis.maximum):
                raise FontError(f"axis {tag!r} = {value} is outside [{axis.minimum}, {axis.maximum}]")

        # HarfBuzz reads plain sfnt only; woff/woff2 are decompressed by fontTools.
        # A collection member saves as a standalone sfnt.
        tt.flavor = None
        buf = io.BytesIO()
        tt.save(buf)
        return cls(path=path, index=index, sha256=hashlib.sha256(data).hexdigest(), ttfont=tt,
                   sfnt=buf.getvalue(), variations=variations)

    # ------------------------------------------------------------------
    # identity and metrics
    # ------------------------------------------------------------------

    @property
    def sfnt_bytes(self) -> bytes:
        """The face as an uncompressed sfnt, suitable for hb.Face."""
        return self._sfnt

    @property
    def ascent_norm(self) -> Fraction:
        """hhea ascent as a share of (ascent - descent). BIZ UD: 1802 / 2048 = 0.88."""
        m = self.metrics
        return Fraction(m.ascent, m.ascent - m.descent)

    def has_feature(self, tag: str, table: str | None = None) -> bool:
        if table is not None:
            return tag in self.features.get(table, frozenset())
        return any(tag in tags for tags in self.features.values())

    def describe(self) -> dict[str, Any]:
        """JSON-ready identity for the decision record. No absolute paths, no timestamps."""
        return {
            "file": self.path.name,
            "index": self.index,
            "sha256": self.sha256,
            "family": self.family,
            "subfamily": self.subfamily,
            "postscriptName": self.postscript_name,
            "weight": self.weight,
            "upm": self.upm,
            "features": {table: sorted(tags) for table, tags in sorted(self.features.items())},
            "variations": self.variations,
        }

    def __repr__(self) -> str:
        return f"FontFace({self.path.name!r}, index={self.index}, upm={self.upm}, sha256={self.sha256[:12]}...)"

    # ------------------------------------------------------------------
    # glyph lookup
    # ------------------------------------------------------------------

    def gid(self, char: str) -> int | None:
        """Glyph id of a single character through the best cmap, or None if unmapped.

        Shaping (HarfBuzz) is the real mapping; this is for reference glyphs
        such as 国 and H when deriving Latin pairing from ink.
        """
        name = self._cmap.get(ord(char))
        return None if name is None else self._name_to_gid.get(name)

    def glyph_name(self, gid: int) -> str:
        self._check_gid(gid)
        return self._order[gid]

    def advance(self, gid: int) -> int:
        """Horizontal advance from hmtx in font units (the unshaped value)."""
        name = self.glyph_name(gid)
        entry = self._hmtx.get(name)
        return int(entry[0]) if entry else 0

    # ------------------------------------------------------------------
    # cached geometry
    # ------------------------------------------------------------------

    def ink(self, gid: int) -> Bounds:
        """Ink bounds in integer font units, y up. Cached per glyph id.

        Fractional bounds (CFF) are widened outward to integers so the box
        always contains the ink.
        """
        cached = self._ink.get(gid)
        if cached is None:
            pen = BoundsPen(self._glyph_set)
            self._draw_raw(gid, pen)
            b = pen.bounds
            if b is None:
                cached = EMPTY_BOUNDS
            else:
                cached = Bounds(math.floor(b[0]), math.floor(b[1]), math.ceil(b[2]), math.ceil(b[3]))
            self._ink[gid] = cached
        return cached

    def draw(self, gid: int, pen) -> None:
        """Replay the glyph outline into any fontTools pen (e.g. a TransformPen around an SVGPathPen)."""
        self._recording(gid).replay(pen)

    def outline(self, gid: int) -> str:
        """SVG path data of the glyph at the origin, y up, integer coordinates. Cached via draw()."""
        pen = SVGPathPen(self._glyph_set, ntos=svg_number)
        self.draw(gid, pen)
        return pen.getCommands()

    def _recording(self, gid: int) -> RecordingPen:
        rec = self._outline.get(gid)
        if rec is None:
            rec = RecordingPen()
            self._draw_raw(gid, rec)
            self._outline[gid] = rec
        return rec

    def _draw_raw(self, gid: int, pen) -> None:
        name = self.glyph_name(gid)
        self._glyph_set[name].draw(pen)

    def _check_gid(self, gid: int) -> None:
        if not 0 <= gid < self.glyph_count:
            raise FontError(f"glyph id {gid} out of range for {self.path.name} ({self.glyph_count} glyphs)")

    # ------------------------------------------------------------------
    # HarfBuzz
    # ------------------------------------------------------------------

    @property
    def hb_face(self) -> hb.Face:
        if self._hb_face is None:
            face = hb.Face(self._sfnt)
            if face.upem != self.upm:
                raise FontError(f"HarfBuzz reports upem {face.upem}, fontTools {self.upm} for {self.path.name}")
            self._hb_face = face
        return self._hb_face

    def hb_font(self) -> hb.Font:
        """A fresh hb.Font scaled to font units with this face's variations applied.

        Cheap to create; callers may keep one per shaping run. hb.Font is
        mutable, so it is not shared.
        """
        font = hb.Font(self.hb_face)
        font.scale = (self.upm, self.upm)
        if self.variations:
            font.set_variations(self.variations)
        return font


# ----------------------------------------------------------------------
# table readers
# ----------------------------------------------------------------------

def _names(tt: TTFont) -> tuple[str, str, str]:
    if "name" not in tt:
        return ("", "", "")
    name = tt["name"]
    family = name.getBestFamilyName() or name.getDebugName(1) or ""
    subfamily = name.getBestSubFamilyName() or name.getDebugName(2) or ""
    ps = name.getDebugName(6) or ""
    return (family, subfamily, ps)


def _os2_attr(tt: TTFont, attr: str) -> int | None:
    if "OS/2" not in tt:
        return None
    value = getattr(tt["OS/2"], attr, None)
    return None if value is None else int(value)


def _vertical_metrics(tt: TTFont) -> VerticalMetrics:
    hhea = tt["hhea"]
    return VerticalMetrics(
        ascent=int(hhea.ascent),
        descent=int(hhea.descent),
        line_gap=int(hhea.lineGap),
        typo_ascender=_os2_attr(tt, "sTypoAscender"),
        typo_descender=_os2_attr(tt, "sTypoDescender"),
        typo_line_gap=_os2_attr(tt, "sTypoLineGap"),
        win_ascent=_os2_attr(tt, "usWinAscent"),
        win_descent=_os2_attr(tt, "usWinDescent"),
        x_height=_os2_attr(tt, "sxHeight"),
        cap_height=_os2_attr(tt, "sCapHeight"),
    )


def _feature_tags(tt: TTFont) -> dict[str, frozenset[str]]:
    out: dict[str, frozenset[str]] = {}
    for table in ("GSUB", "GPOS"):
        tags: set[str] = set()
        if table in tt:
            feature_list = getattr(tt[table].table, "FeatureList", None)
            if feature_list is not None:
                tags = {rec.FeatureTag for rec in feature_list.FeatureRecord}
        out[table] = frozenset(tags)
    return out


def _axes(tt: TTFont) -> dict[str, Axis]:
    if "fvar" not in tt:
        return {}
    return {
        a.axisTag: Axis(a.axisTag, float(a.minValue), float(a.defaultValue), float(a.maxValue))
        for a in tt["fvar"].axes
    }
