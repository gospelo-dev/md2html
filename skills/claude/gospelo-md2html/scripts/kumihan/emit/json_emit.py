"""JSON emitter: glyph positions and line ink ranges for other renderers."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..typesetter import Layout


def emit_json(layout: "Layout", *, indent: int | None = None) -> str:
    p = layout.placement
    out: dict[str, Any] = {
        "viewbox": {"width": p.viewbox_width, "height": p.viewbox_height},
        "lines": [],
    }
    for pl in p.lines:
        line_d: dict[str, Any] = {
            "baselineY": pl.baseline_y,
            "inkLeft": pl.ink_left,
            "inkRight": pl.ink_right,
            "start": pl.start,
            "end": pl.end,
            "glyphs": [
                {"gid": g.gid, "x": g.x, "y": g.y, "cluster": g.cluster}
                for g in pl.glyphs
            ],
        }
        out["lines"].append(line_d)
    out["decision"] = json.loads(layout.decision.to_json())
    return json.dumps(out, sort_keys=True, separators=(",", ":")) if indent is None else json.dumps(out, sort_keys=True, indent=indent)
