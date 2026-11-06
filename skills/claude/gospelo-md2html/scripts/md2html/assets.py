"""Browser-side assets: base CSS, figures.js, vendored Mermaid.js and Font
Awesome (docs/02_pipeline.md section (2)). Missing vendor files are an error.

Mermaid is vendored per version under references/vendor/mermaid/<version>/
(mermaid.min.js + LICENSE.txt) so that several versions can coexist: a
document keeps rendering with the version it was paginated with (recorded as
layout.mermaidVersion), and new documents default to the newest vendored one.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent.parent
REFERENCES = SKILL_DIR / "references"
VENDOR = REFERENCES / "vendor"

MERMAID_DIR = VENDOR / "mermaid"
SHIKI_DIR = VENDOR / "shiki"
FA_CSS = VENDOR / "fontawesome.min.css"
FA_SOLID_CSS = VENDOR / "fa-solid.min.css"
FA_WOFF2 = VENDOR / "fa-solid-900.woff2"
BASE_CSS = REFERENCES / "base.css"
FIGURES_JS = REFERENCES / "figures.js"

MERMAID_COPYRIGHT = "Copyright (c) 2014-2025 Knut Sveidqvist"
MERMAID_URL = "https://github.com/mermaid-js/mermaid"

_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
_BUNDLE_VERSION_RE = re.compile(r'version:"(\d+\.\d+\.\d+)"')


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


# --------------------------------------------------------------------------
# Mermaid (per-version vendoring)
# --------------------------------------------------------------------------

def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def mermaid_versions() -> list[str]:
    """Vendored Mermaid versions, oldest first."""
    if not MERMAID_DIR.is_dir():
        return []
    found = [p.name for p in MERMAID_DIR.iterdir()
             if p.is_dir() and _VERSION_RE.match(p.name) and (p / "mermaid.min.js").is_file()]
    return sorted(found, key=_version_key)


def default_mermaid_version() -> str:
    versions = mermaid_versions()
    if not versions:
        raise AssetError(f"no vendored Mermaid found under {MERMAID_DIR} (expected <version>/mermaid.min.js)")
    return versions[-1]


def resolve_mermaid_version(requested: str | None) -> str:
    """The version to render with: the requested one if vendored, else the newest."""
    if requested is None:
        return default_mermaid_version()
    if requested not in mermaid_versions():
        raise AssetError(
            f"Mermaid {requested} is not vendored; available: {', '.join(mermaid_versions()) or 'none'}. "
            f"Add references/vendor/mermaid/{requested}/mermaid.min.js and LICENSE.txt, or pass --mermaid-version"
        )
    return requested


def mermaid_bundle(version: str) -> Path:
    return MERMAID_DIR / version / "mermaid.min.js"


def mermaid_license(version: str) -> Path:
    return MERMAID_DIR / version / "LICENSE.txt"


def _bundle_text(version: str) -> str:
    text = _read(mermaid_bundle(version))
    m = _BUNDLE_VERSION_RE.search(text)
    if m and m.group(1) != version:
        raise AssetError(f"{mermaid_bundle(version)} reports version {m.group(1)}, directory says {version}")
    return text


def mermaid_notice(version: str) -> str:
    """HTML comment carrying the MIT copyright and permission notice. Emitted in
    front of the library in every generated document so that redistributed
    copies satisfy the license (THIRD_PARTY_NOTICES.md)."""
    license_text = _read(mermaid_license(version)).strip()
    if "--" in license_text:
        raise AssetError(f"{mermaid_license(version)} contains '--', which cannot appear inside an HTML comment")
    return (f"<!--\nMermaid {version} | MIT License | {MERMAID_COPYRIGHT} | {MERMAID_URL}\n\n"
            + license_text + "\n-->")


def mermaid_script_tag(mode: str, out_dir: Path | None, version: str | None = None) -> str:
    """`embed` inlines the bundle; `link` copies mermaid-<version>.min.js and its
    license next to the output so that several versions can share a directory."""
    version = resolve_mermaid_version(version)
    notice = mermaid_notice(version)
    if mode == "embed":
        return notice + f'\n<script data-mermaid-version="{version}">\n' + _bundle_text(version) + "\n</script>"
    if mode != "link":
        raise AssetError(f"unknown mermaid lib mode {mode!r}")
    if out_dir is None:
        raise AssetError("mermaid link mode needs an output directory")
    src = mermaid_bundle(version)
    if not src.is_file():
        raise AssetError(f"required asset is missing: {src}")
    _bundle_text(version)  # version consistency check
    js_name = f"mermaid-{version}.min.js"
    target = out_dir / js_name
    if target.resolve() != src.resolve():
        shutil.copyfile(src, target)
    shutil.copyfile(mermaid_license(version), out_dir / f"LICENSE.mermaid-{version}.txt")
    return notice + f'\n<script src="{js_name}" data-mermaid-version="{version}"></script>'


# --------------------------------------------------------------------------
# Mermaid ELK layout (@mermaid-js/layout-elk). Not vendored: elkjs is EPL-2.0,
# so the repository carries only the build recipe
# (references/vendor/mermaid-layout-elk/build/) and `setup --elk` builds
# <cache>/mermaid-layout-elk/<version>/{mermaid-layout-elk.min.js,LICENSE.txt}
# on the user's machine (elk_setup.py). Included in a document only when a
# diagram asks for ELK. figures.js registers it, and fails when a diagram asks
# for ELK but the bundle is absent (Mermaid itself would silently fall back to
# dagre).
# --------------------------------------------------------------------------

ELK_BUILD_DIR = VENDOR / "mermaid-layout-elk" / "build"


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "gospelo-md2html"


ELK_DIR = cache_dir() / "mermaid-layout-elk"

# Mermaid version -> layout-elk version rendered with it. A pairing is chosen
# per vendored Mermaid (the layout-elk release current when that Mermaid was
# released) and is never guessed for an unlisted Mermaid version.
MERMAID_LAYOUT_ELK = {"11.12.2": "0.2.0"}

_ELK_BUNDLE_VERSION_RE = re.compile(r'name:"@mermaid-js/layout-elk",version:"(\d+\.\d+\.\d+)"')

# ELK requests Mermaid recognises: `flowchart-elk`, `layout: elk` (front matter
# config or %%{init}%% directive, including elk.stress etc.), and the older
# `defaultRenderer: elk`. Over-matching only includes the bundle; it does not
# change how a diagram is drawn. Under-matching is caught in figures.js.
_ELK_REQUEST_RE = re.compile(
    r"^\s*flowchart-elk\b"
    r"|[\"']?\b(?:layout|defaultRenderer)[\"']?\s*:\s*[\"']?elk\b",
    re.MULTILINE,
)


def mermaid_requests_elk(source: str) -> bool:
    return bool(_ELK_REQUEST_RE.search(source))


def elk_version_for(mermaid_version: str | None) -> str:
    mermaid_version = resolve_mermaid_version(mermaid_version)
    elk = MERMAID_LAYOUT_ELK.get(mermaid_version)
    if elk is None:
        raise AssetError(
            f"a diagram requests the ELK layout, but no layout-elk is paired with Mermaid {mermaid_version} "
            f"(MERMAID_LAYOUT_ELK in assets.py; paired: {', '.join(sorted(MERMAID_LAYOUT_ELK)) or 'none'})"
        )
    return elk


def elk_bundle(version: str) -> Path:
    return ELK_DIR / version / "mermaid-layout-elk.min.js"


def elk_license(version: str) -> Path:
    return ELK_DIR / version / "LICENSE.txt"


def _elk_bundle_text(version: str) -> str:
    if not (elk_bundle(version).is_file() and elk_license(version).is_file()):
        raise AssetError(
            f"a diagram requests the ELK layout, but the layout-elk {version} bundle is not built "
            f"(expected {elk_bundle(version).parent}). Build it once with: "
            f"uv run {SKILL_DIR / 'scripts' / 'md2html.py'} setup --elk  (needs Node.js and npm)"
        )
    text = _read(elk_bundle(version))
    m = _ELK_BUNDLE_VERSION_RE.search(text)
    if not m:
        raise AssetError(f"{elk_bundle(version)} does not carry the @mermaid-js/layout-elk version")
    if m.group(1) != version:
        raise AssetError(f"{elk_bundle(version)} reports version {m.group(1)}, directory says {version}")
    return text


def elk_notice(version: str) -> str:
    license_text = _read(elk_license(version)).strip()
    if "--" in license_text:
        raise AssetError(f"{elk_license(version)} contains '--', which cannot appear inside an HTML comment")
    return (f"<!--\n@mermaid-js/layout-elk {version} (bundles elkjs, EPL-2.0) | {MERMAID_URL}\n\n"
            + license_text + "\n-->")


def elk_script_tag(mode: str, out_dir: Path | None, mermaid_version: str | None = None) -> str:
    """Same modes as mermaid_script_tag. Must come after the Mermaid tag and
    before figures.js."""
    version = elk_version_for(mermaid_version)
    text = _elk_bundle_text(version)  # existence and version consistency check
    notice = elk_notice(version)
    attr = f'data-mermaid-layout-elk-version="{version}"'
    if mode == "embed":
        return notice + f"\n<script {attr}>\n" + text + "\n</script>"
    if mode != "link":
        raise AssetError(f"unknown mermaid lib mode {mode!r}")
    if out_dir is None:
        raise AssetError("mermaid link mode needs an output directory")
    src = elk_bundle(version)
    js_name = f"mermaid-layout-elk-{version}.min.js"
    target = out_dir / js_name
    if target.resolve() != src.resolve():
        shutil.copyfile(src, target)
    shutil.copyfile(elk_license(version), out_dir / f"LICENSE.mermaid-layout-elk-{version}.txt")
    return notice + f'\n<script src="{js_name}" {attr}></script>'


# --------------------------------------------------------------------------
# Shiki (per-version vendoring, same pattern as Mermaid)
# --------------------------------------------------------------------------

SHIKI_COPYRIGHT = "Copyright (c) 2021 Pine Wu, Anthony Fu"
SHIKI_URL = "https://github.com/shikijs/shiki"


def shiki_versions() -> list[str]:
    if not SHIKI_DIR.is_dir():
        return []
    found = [p.name for p in SHIKI_DIR.iterdir()
             if p.is_dir() and _VERSION_RE.match(p.name) and (p / "shiki.min.js").is_file()]
    return sorted(found, key=_version_key)


def default_shiki_version() -> str | None:
    versions = shiki_versions()
    return versions[-1] if versions else None


def shiki_script_tag() -> str:
    version = default_shiki_version()
    if version is None:
        return ""
    src = SHIKI_DIR / version / "shiki.min.js"
    text = _read(src)
    return f'<script data-shiki-version="{version}">\n{text}\n</script>'


# --------------------------------------------------------------------------
# Font Awesome and page chrome
# --------------------------------------------------------------------------

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
