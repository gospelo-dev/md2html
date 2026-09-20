"""Browser-side assets: base CSS, figures.js, vendored Mermaid.js and Font
Awesome (docs/02_pipeline.md section (2)). Missing vendor files are an error.
"""

from __future__ import annotations

import base64
import shutil
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent.parent
REFERENCES = SKILL_DIR / "references"
VENDOR = REFERENCES / "vendor"

MERMAID_JS = VENDOR / "mermaid.min.js"
FA_CSS = VENDOR / "fontawesome.min.css"
FA_SOLID_CSS = VENDOR / "fa-solid.min.css"
FA_WOFF2 = VENDOR / "fa-solid-900.woff2"
BASE_CSS = REFERENCES / "base.css"
FIGURES_JS = REFERENCES / "figures.js"


class AssetError(RuntimeError):
    pass


def _read(path: Path) -> str:
    if not path.is_file():
        raise AssetError(f"required asset is missing: {path}")
    return path.read_text(encoding="utf-8")


def base_css() -> str:
    return _read(BASE_CSS)


def figures_js() -> str:
    return _read(FIGURES_JS)


def mermaid_script_tag(mode: str, out_dir: Path | None) -> str:
    if mode == "embed":
        return "<script>\n" + _read(MERMAID_JS) + "\n</script>"
    if out_dir is None:
        raise AssetError("mermaid link mode needs an output directory")
    if not MERMAID_JS.is_file():
        raise AssetError(f"required asset is missing: {MERMAID_JS}")
    target = out_dir / "mermaid.min.js"
    if target.resolve() != MERMAID_JS.resolve():
        shutil.copyfile(MERMAID_JS, target)
    return '<script src="mermaid.min.js"></script>'


def fontawesome_style_tag() -> str:
    css = _read(FA_CSS) + "\n" + _read(FA_SOLID_CSS)
    if not FA_WOFF2.is_file():
        raise AssetError(f"required asset is missing: {FA_WOFF2}")
    b64 = base64.b64encode(FA_WOFF2.read_bytes()).decode("ascii")
    data_uri = f"data:font/woff2;base64,{b64}"
    css = css.replace("url(../webfonts/fa-solid-900.woff2)", f"url({data_uri})")
    css = css.replace(',url(../webfonts/fa-solid-900.ttf) format("truetype")', "")
    return "<style>\n" + css + "\n</style>"


def page_number_script() -> str:
    return (
        "<script>\n"
        "document.addEventListener('DOMContentLoaded', function () {\n"
        "  var pages = document.querySelectorAll('.page');\n"
        "  pages.forEach(function (p, i) {\n"
        "    var el = p.querySelector('.page-number');\n"
        "    if (el) { el.textContent = (i + 1) + ' / ' + pages.length; }\n"
        "  });\n"
        "});\n"
        "</script>"
    )
