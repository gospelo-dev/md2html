"""PNG emitter via resvg_py. Raises ImportError at import time if resvg_py is missing."""

from __future__ import annotations

from typing import TYPE_CHECKING

import resvg_py  # noqa: F401 — fail fast if absent

from .svg import emit_svg

if TYPE_CHECKING:
    from ..typesetter import Layout


def emit_png(
    layout: "Layout",
    *,
    title: str | None = None,
    fill: str = "#222",
    role: str = "main",
    lang: str = "ja",
    background: str | None = None,
    zoom: float | None = None,
) -> bytes:
    svg = emit_svg(layout, title=title, fill=fill, role=role, lang=lang)
    kwargs: dict = {"svg_string": svg, "skip_system_fonts": True}
    if background is not None:
        kwargs["background"] = background
    if zoom is not None:
        kwargs["zoom"] = zoom
    return resvg_py.svg_to_bytes(**kwargs)
