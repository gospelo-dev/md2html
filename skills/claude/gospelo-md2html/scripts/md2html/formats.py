"""Page format definitions (docs/03_page_formats.md).

All dimensions are in millimetres. Top and bottom margins are always equal
(decision 9). Horizontal formats default to the split layout (decision 7).
"""

from __future__ import annotations

from dataclasses import dataclass

MM_TO_PX = 96.0 / 25.4  # Chromium: 1mm = 3.7795px
PT_TO_PX = 96.0 / 72.0


@dataclass(frozen=True)
class PageFormat:
    id: str
    width_mm: float
    height_mm: float
    margin_v_mm: float
    margin_h_mm: float
    default_font_pt: float
    is_slide: bool
    default_columns: str  # "two" (column order: left column, then right) | "split" (figure + text) | "single"

    @property
    def is_landscape(self) -> bool:
        return self.width_mm > self.height_mm


FORMATS: dict[str, PageFormat] = {
    "a4": PageFormat("a4", 210.0, 297.0, 18.0, 18.0, 11.0, False, "single"),
    "a4-landscape": PageFormat("a4-landscape", 297.0, 210.0, 16.0, 20.0, 11.0, False, "two"),
    "a3": PageFormat("a3", 297.0, 420.0, 22.0, 22.0, 12.0, False, "single"),
    "a3-landscape": PageFormat("a3-landscape", 420.0, 297.0, 20.0, 24.0, 12.0, False, "two"),
    "16x9": PageFormat("16x9", 338.6667, 190.5, 10.0, 12.0, 14.0, True, "two"),
    "4x3": PageFormat("4x3", 254.0, 190.5, 10.0, 12.0, 14.0, True, "two"),
}


def get_format(page_id: str) -> PageFormat:
    try:
        return FORMATS[page_id]
    except KeyError:
        raise ValueError(
            f"unknown page format: {page_id!r} (expected one of {', '.join(FORMATS)})"
        ) from None
