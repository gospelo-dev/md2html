"""Output emitters: SVG outlines, JSON glyph positions, PNG via resvg."""

from __future__ import annotations

from .svg import emit_svg
from .json_emit import emit_json

__all__ = ["emit_svg", "emit_json"]

try:
    from .png import emit_png
    __all__.append("emit_png")
except ImportError:
    pass
