"""Stage 8: SVG outline emitter.

Produces an SVG string from a Layout. Each line becomes one ``<path>``
element whose ``d`` attribute contains all glyphs of that line concatenated,
with integer coordinates only. Glyph outlines are y-flipped and translated
via fontTools TransformPen.

The SVG contains no ``<text>``, ``<foreignObject>``, or ``@font-face``.
Attribute order, key order, and line endings (LF) are fixed for determinism.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

from ..font import svg_number

if TYPE_CHECKING:
    from ..typesetter import Layout


def emit_svg(
    layout: "Layout",
    *,
    title: str | None = None,
    fill: str = "#222",
    role: str = "main",
    lang: str = "ja",
    include_decision: bool = True,
) -> str:
    p = layout.placement
    face = layout.spaced.shaped.face

    vb_w = p.viewbox_width
    vb_h = p.viewbox_height

    lines: list[str] = []
    lines.append(
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' viewBox="0 0 {vb_w} {vb_h}"'
        f' xml:lang="{_esc(lang)}">'
    )

    if title is not None:
        lines.append(f"<title>{_esc(title)}</title>")

    if include_decision:
        dj = layout.decision.to_json()
        lines.append(f"<metadata>{_esc(dj)}</metadata>")

    lines.append(f'<g data-role="{_esc(role)}" fill="{_esc(fill)}">')

    for pl in p.lines:
        if not pl.glyphs:
            continue
        glyph_set = face._glyph_set
        pen = SVGPathPen(glyph_set, ntos=svg_number)
        for g in pl.glyphs:
            tp = TransformPen(pen, (1, 0, 0, -1, g.x, g.y))
            face.draw(g.gid, tp)
        d = pen.getCommands()
        if d:
            lines.append(f'<path d="{d}"/>')

    lines.append("</g>")
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
