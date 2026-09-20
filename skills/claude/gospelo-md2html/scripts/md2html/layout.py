"""Layout JSON and CLI option merging (docs/07_content_model.md section 4).

Layout values never live in the content JSON. CLI options win over the
layout file. Unknown keys are an error (no silent defaults).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LAYOUT_KEYS = {
    "page": str,
    "fontSize": str,
    "titleScale": (int, float),
    "headerTitle": str,
    "columns": str,
    "figureSide": str,
    "splitRatio": (int, float),
    "details": str,
    "mermaidLib": str,
    "mermaidVersion": (str, type(None)),
    "hrBreak": bool,
    "imageScale": (int, float),
    "embedImages": bool,
    "date": (str, type(None)),
    "css": (str, type(None)),
    "overrides": dict,
}

PAGE_OVERRIDE_KEYS = {"columns", "figureSide", "splitRatio"}
BLOCK_OVERRIDE_KEYS = {"maxHeightRatio", "span"}  # span: 1 | 2 (two-column layout)


class LayoutError(ValueError):
    pass


@dataclass
class Layout:
    page: str = "a4"
    font_size: str | None = None
    title_scale: float = 1.25
    header_title: str = "section"
    columns: str | None = None
    figure_side: str = "right"
    split_ratio: float = 0.5
    details: str = "drop"
    mermaid_lib: str = "prerender"       # prerender (SVG in the document, no library) | embed | link
    mermaid_version: str | None = None   # None = newest vendored; generated HTML records the effective one
    hr_break: bool = False
    image_scale: float = 1.0
    embed_images: bool = False
    date: str | None = None          # None = today; "none" = hidden
    css: str | None = None
    overrides: dict[str, dict[str, Any]] = field(default_factory=dict)

    def page_override(self, page_id: str) -> dict[str, Any]:
        return {k: v for k, v in self.overrides.get(page_id, {}).items() if k in PAGE_OVERRIDE_KEYS}

    def block_override(self, block_id: str) -> dict[str, Any]:
        return {k: v for k, v in self.overrides.get(block_id, {}).items() if k in BLOCK_OVERRIDE_KEYS}

    def span_overrides(self) -> dict[str, int]:
        return {k: int(v["span"]) for k, v in self.overrides.items() if isinstance(v, dict) and v.get("span") in (1, 2)}


_CAMEL_TO_FIELD = {
    "page": "page",
    "fontSize": "font_size",
    "titleScale": "title_scale",
    "headerTitle": "header_title",
    "columns": "columns",
    "figureSide": "figure_side",
    "splitRatio": "split_ratio",
    "details": "details",
    "mermaidLib": "mermaid_lib",
    "mermaidVersion": "mermaid_version",
    "hrBreak": "hr_break",
    "imageScale": "image_scale",
    "embedImages": "embed_images",
    "date": "date",
    "css": "css",
    "overrides": "overrides",
}


def load_layout_file(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise LayoutError(f"layout file not found: {path}") from None
    except json.JSONDecodeError as e:
        raise LayoutError(f"layout file is not valid JSON: {path}: {e}") from None
    if not isinstance(data, dict):
        raise LayoutError(f"layout file must be a JSON object: {path}")
    for key, value in data.items():
        if key not in LAYOUT_KEYS:
            raise LayoutError(f"unknown layout key {key!r} in {path}")
        if not isinstance(value, LAYOUT_KEYS[key]):
            raise LayoutError(f"layout key {key!r} has wrong type in {path}")
    _validate_overrides(data.get("overrides", {}), path)
    return data


def _validate_overrides(overrides: dict[str, Any], path: Path) -> None:
    for target, values in overrides.items():
        if not isinstance(values, dict):
            raise LayoutError(f"overrides[{target!r}] must be an object in {path}")
        for k in values:
            if k not in PAGE_OVERRIDE_KEYS | BLOCK_OVERRIDE_KEYS:
                raise LayoutError(f"unknown override key {k!r} for {target!r} in {path}")
        if "span" in values and values["span"] not in (1, 2):
            raise LayoutError(f"override span for {target!r} must be 1 or 2 in {path}")
        if "columns" in values and values["columns"] not in ("two", "split", "single"):
            raise LayoutError(f"override columns for {target!r} must be two, split or single in {path}")


def build_layout(layout_path: Path | None, cli: dict[str, Any], base: dict[str, Any] | None = None) -> Layout:
    """Merge, lowest priority first: `base` (layout embedded in an input HTML),
    the layout file, then CLI values. CLI values that are None are ignored."""
    layout = Layout()
    if base:
        for key, value in base.items():
            if key not in LAYOUT_KEYS:
                raise LayoutError(f"unknown layout key {key!r} in embedded layout")
            setattr(layout, _CAMEL_TO_FIELD[key], value)
    if layout_path is not None:
        data = load_layout_file(layout_path)
        for key, value in data.items():
            setattr(layout, _CAMEL_TO_FIELD[key], value)
    for key, value in cli.items():
        if value is None:
            continue
        if not hasattr(layout, key):
            raise LayoutError(f"internal: unknown layout field {key!r}")
        setattr(layout, key, value)
    _check(layout)
    return layout


def layout_to_dict(layout: Layout) -> dict[str, Any]:
    """The effective layout as layout-JSON keys (embedded into generated HTML)."""
    out: dict[str, Any] = {}
    for camel, field_name in _CAMEL_TO_FIELD.items():
        value = getattr(layout, field_name)
        if camel == "overrides" and not value:
            continue
        out[camel] = value
    return out


def _check(layout: Layout) -> None:
    if layout.header_title not in ("section", "doc") and not layout.header_title.startswith("fixed:"):
        raise LayoutError(f"invalid header title mode {layout.header_title!r}")
    if layout.details not in ("drop", "expand"):
        raise LayoutError(f"invalid details mode {layout.details!r}")
    if layout.mermaid_lib not in ("prerender", "embed", "link"):
        raise LayoutError(f"invalid mermaid lib mode {layout.mermaid_lib!r}: expected prerender, embed or link")
    if layout.mermaid_version is not None and not re.match(r"^\d+\.\d+\.\d+$", layout.mermaid_version):
        raise LayoutError(f"invalid mermaid version {layout.mermaid_version!r}: expected MAJOR.MINOR.PATCH")
    if layout.image_scale <= 0:
        raise LayoutError("image scale must be positive")
    if layout.date is not None and layout.date != "none" and not re.match(r"^\d{4}-\d{2}-\d{2}$", layout.date):
        raise LayoutError(f"invalid date {layout.date!r}: expected YYYY-MM-DD or none")
