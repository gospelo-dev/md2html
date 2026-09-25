"""Typography scale and derived page metrics (docs/04_layout_logic.md section 2,
docs/03_page_formats.md sections 2.1 and 6).

Everything derives from the body font size F (px) and the page format. The
only mm values that survive into CSS are the paper size and margins.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .formats import MM_TO_PX, PT_TO_PX, PageFormat

_SIZE_RE = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|px|mm)\s*$")

TITLE_BAND_FACTOR = 2.0       # header band = title size x 2.0
FOOTER_MAX_BODY_RATIO = 0.75  # footer <= 0.75 F
FOOTER_MAX_MARGIN_RATIO = 0.36  # footer <= 0.36 M
SAFETY = 0.98                 # fill pages up to 98% (measured heights)
IMAGE_RATIO_SINGLE = 0.6      # figure height cap in single-column pages
IMAGE_RATIO_SPLIT = 1.0       # figure column: full height available


def parse_font_size(value: str) -> float:
    """Return the font size in CSS px. Accepts pt, px, mm. Raises on anything else."""
    m = _SIZE_RE.match(value)
    if not m:
        raise ValueError(f"invalid --font-size {value!r}: expected e.g. 11pt, 14px, 3.5mm")
    num, unit = float(m.group(1)), m.group(2)
    if num <= 0:
        raise ValueError(f"invalid --font-size {value!r}: must be positive")
    if unit == "pt":
        return num * PT_TO_PX
    if unit == "mm":
        return num * MM_TO_PX
    return num


@dataclass(frozen=True)
class Metrics:
    fmt: PageFormat
    F: float                 # body font px
    title_scale: float
    columns: str             # "split" | "single" (document default)
    figure_side: str         # "left" | "right"
    split_ratio: float       # text column fraction

    # ---- paper ---------------------------------------------------------
    @property
    def page_w_px(self) -> float:
        return self.fmt.width_mm * MM_TO_PX

    @property
    def page_h_px(self) -> float:
        return self.fmt.height_mm * MM_TO_PX

    @property
    def margin_v_px(self) -> float:
        return self.fmt.margin_v_mm * MM_TO_PX

    @property
    def margin_h_px(self) -> float:
        return self.fmt.margin_h_mm * MM_TO_PX

    # ---- typography ----------------------------------------------------
    @property
    def line_height(self) -> float:
        return 1.5 if self.fmt.is_slide else 1.6

    @property
    def line_px(self) -> float:
        return self.F * self.line_height

    @property
    def title_size_px(self) -> float:
        return self.F * self.title_scale

    @property
    def header_band_px(self) -> float:
        return self.title_size_px * TITLE_BAND_FACTOR if self.fmt.is_slide else 0.0

    @property
    def header_gap_px(self) -> float:
        return self.F if self.fmt.is_slide else 0.0

    @property
    def footer_size_px(self) -> float:
        return min(FOOTER_MAX_BODY_RATIO * self.F, FOOTER_MAX_MARGIN_RATIO * self.margin_v_px)

    @property
    def footer_band_px(self) -> float:
        return self.margin_v_px

    @property
    def table_scale(self) -> float:
        return 0.85 if self.fmt.is_slide else 0.9

    @property
    def code_scale(self) -> float:
        # half-width columns need the small size; full-width code on portrait paper stays readable
        return 0.6 if self.columns == "two" else 0.85

    # ---- content box ---------------------------------------------------
    @property
    def content_w_px(self) -> float:
        return self.page_w_px - 2 * self.margin_h_px

    @property
    def content_h_px(self) -> float:
        return self.page_h_px - self.margin_v_px - self.footer_band_px - self.header_band_px - self.header_gap_px

    @property
    def gutter_px(self) -> float:
        return self.F * 1.5

    @property
    def text_col_px(self) -> float:
        return (self.content_w_px - self.gutter_px) * self.split_ratio

    @property
    def figure_col_px(self) -> float:
        return (self.content_w_px - self.gutter_px) * (1.0 - self.split_ratio)

    @property
    def col2_px(self) -> float:
        """Width of one column in the two-column layout (column order: left, then right)."""
        return (self.content_w_px - self.gutter_px) / 2.0

    def figure_box(self, mode: str, ratio_override: float | None = None) -> tuple[float, float, float]:
        """(W, H, r) for figure sizing in the given page mode ('split', 'col' or 'single')."""
        # a figure that fills a column must still fit the pagination capacity (content height x SAFETY)
        usable_h = self.content_h_px * SAFETY - 1.0
        if mode == "split":
            return self.figure_col_px, usable_h, IMAGE_RATIO_SPLIT
        if mode == "col":
            return self.col2_px, usable_h, IMAGE_RATIO_SPLIT
        r = IMAGE_RATIO_SINGLE if ratio_override is None else ratio_override
        return self.content_w_px, self.content_h_px, r

    def css_vars(self) -> str:
        fmt = self.fmt
        text_fr = round(self.split_ratio * 2, 3)
        figure_fr = round((1.0 - self.split_ratio) * 2, 3)
        lines = [
            f"--page-w: {fmt.width_mm}mm;",
            f"--page-h: {fmt.height_mm}mm;",
            f"--margin-v: {fmt.margin_v_mm}mm;",
            f"--margin-h: {fmt.margin_h_mm}mm;",
            f"--font-size: {self.F:.3f}px;",
            f"--line-height: {self.line_height};",
            f"--title-size: {self.title_size_px:.3f}px;",
            f"--header-band: {self.header_band_px:.3f}px;",
            f"--header-gap: {self.header_gap_px:.3f}px;",
            f"--footer-size: {self.footer_size_px:.3f}px;",
            f"--footer-band: {self.footer_band_px:.3f}px;",
            f"--content-w: {self.content_w_px:.3f}px;",
            f"--content-h: {self.content_h_px:.3f}px;",
            f"--gutter: {self.gutter_px:.3f}px;",
            f"--text-fr: {text_fr}fr;",
            f"--figure-fr: {figure_fr}fr;",
            f"--table-scale: {self.table_scale};",
            f"--code-scale: {self.code_scale};",
        ]
        return ":root {\n  " + "\n  ".join(lines) + "\n}\n"


def build_metrics(fmt: PageFormat, font_size: str | None, title_scale: float,
                  columns: str | None, figure_side: str, split_ratio: float) -> Metrics:
    F = parse_font_size(font_size) if font_size else fmt.default_font_pt * PT_TO_PX
    if columns is None:
        columns = fmt.default_columns
    if columns not in ("two", "split", "single"):
        raise ValueError(f"invalid columns {columns!r}: expected two, split or single")
    if figure_side not in ("left", "right"):
        raise ValueError(f"invalid figure side {figure_side!r}: expected left or right")
    if not (0.4 <= split_ratio <= 0.6):
        raise ValueError(f"invalid split ratio {split_ratio}: expected 0.4 to 0.6")
    if title_scale <= 0:
        raise ValueError(f"invalid title scale {title_scale}")
    return Metrics(fmt, F, title_scale, columns, figure_side, split_ratio)
