"""Mermaid ELK layout: detection, vendored bundle, inclusion in documents, and
(with Chromium) rendering without a silent fallback to dagre."""

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "skills" / "claude" / "gospelo-md2html" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from md2html import assets  # noqa: E402
from md2html.content import make_source_page  # noqa: E402
from md2html.formats import get_format  # noqa: E402
from md2html.layout import Layout  # noqa: E402
from md2html.render import RenderContext, render_document, render_measure_document  # noqa: E402
from md2html.scale import build_metrics  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "elk_flowchart.md"
ELK_VERSION = assets.MERMAID_LAYOUT_ELK["11.12.2"]


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------

@pytest.mark.parametrize("source", [
    '%%{init: {"layout": "elk"}}%%\nflowchart TD\n  A --> B',
    "%%{init: {'layout': 'elk'}}%%\nflowchart TD\n  A --> B",
    "---\nconfig:\n  layout: elk\n---\nflowchart TD\n  A --> B",
    "---\nconfig:\n  layout: elk.stress\n---\nflowchart TD\n  A --> B",
    "flowchart-elk TD\n  A --> B",
    "  flowchart-elk LR\n  A --> B",
    "---\nconfig:\n  flowchart:\n    defaultRenderer: elk\n---\nflowchart TD\n  A --> B",
])
def test_elk_requests_are_detected(source):
    assert assets.mermaid_requests_elk(source)


@pytest.mark.parametrize("source", [
    "flowchart TD\n  A --> B",
    "flowchart TD\n  elk[Elk] --> B",
    "---\nconfig:\n  layout: dagre\n---\nflowchart TD\n  A --> B",
    "sequenceDiagram\n  A->>B: layout",
])
def test_other_diagrams_are_not_elk(source):
    assert not assets.mermaid_requests_elk(source)


# --------------------------------------------------------------------------
# bundle: built by `setup --elk` into the user cache, never committed
# --------------------------------------------------------------------------

def _built() -> bool:
    return assets.elk_bundle(ELK_VERSION).is_file() and assets.elk_license(ELK_VERSION).is_file()


needs_built = pytest.mark.skipif(not _built(), reason="ELK bundle not built (md2html.py setup --elk)")


@pytest.fixture
def fake_elk(tmp_path, monkeypatch):
    """A stand-in bundle in a temporary ELK_DIR, for tests that do not run it."""
    d = tmp_path / "elk" / ELK_VERSION
    d.mkdir(parents=True)
    (d / "mermaid-layout-elk.min.js").write_text(
        f'(()=>{{var p={{name:"@mermaid-js/layout-elk",version:"{ELK_VERSION}"}};'
        'window.__mermaidLayoutElk={version:p.version,layouts:[]};})();', encoding="utf-8")
    (d / "LICENSE.txt").write_text("elkjs 0.9.3 | EPL-2.0\nEclipse Public License - v 2.0\n", encoding="utf-8")
    monkeypatch.setattr(assets, "ELK_DIR", tmp_path / "elk")
    return d


def test_the_bundle_is_not_in_the_repository():
    vendor = assets.VENDOR / "mermaid-layout-elk"
    assert sorted(p.name for p in vendor.iterdir()) == ["build"]
    assert ROOT not in assets.ELK_DIR.parents and assets.SKILL_DIR not in assets.ELK_DIR.parents
    recipe = (assets.ELK_BUILD_DIR / "package.json").read_text(encoding="utf-8")
    assert f'"@mermaid-js/layout-elk": "{ELK_VERSION}"' in recipe and '"elkjs": "0.9.3"' in recipe


def test_cache_dir_follows_xdg_cache_home(monkeypatch, tmp_path):
    monkeypatch.delenv("GOSPELO_MD2HTML_CACHE_DIR", raising=False)
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    assert assets.cache_dir() == tmp_path / "gospelo-md2html"


def test_cache_dir_override(monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "xdg"))
    monkeypatch.setenv("GOSPELO_MD2HTML_CACHE_DIR", str(tmp_path / "mine"))
    assert assets.cache_dir() == tmp_path / "mine"


@needs_built
def test_built_bundle_and_license():
    text = assets.elk_bundle(ELK_VERSION).read_text(encoding="utf-8")
    assert "window.__mermaidLayoutElk=" in text
    assert "import(" not in text  # one IIFE, no ESM chunks left
    license_text = assets.elk_license(ELK_VERSION).read_text(encoding="utf-8")
    for needle in (f"@mermaid-js/layout-elk {ELK_VERSION} | MIT", "elkjs 0.9.3 | EPL-2.0",
                   "Eclipse Public License - v 2.0", "d3-shape", "d3-path", "Permission is hereby granted"):
        assert needle in license_text


@needs_built
def test_figures_js_knows_the_bundled_layout_names():
    names = re.search(r"ELK_LAYOUT_NAMES = \[([^\]]*)\]", assets.figures_js()).group(1)
    bundle = assets.elk_bundle(ELK_VERSION).read_text(encoding="utf-8")
    for name in re.findall(r'"([^"]+)"', names):
        assert f'"{name}"' in bundle, name


def test_every_vendored_mermaid_is_paired_with_layout_elk():
    for v in assets.mermaid_versions():
        assert assets.elk_version_for(v)


def test_embed_tag_carries_notice_and_version(fake_elk):
    tag = assets.elk_script_tag("embed", None, "11.12.2")
    assert tag.startswith(f"<!--\n@mermaid-js/layout-elk {ELK_VERSION} (bundles elkjs, EPL-2.0)")
    assert "Eclipse Public License - v 2.0" in tag.split("-->")[0]
    assert f'<script data-mermaid-layout-elk-version="{ELK_VERSION}">' in tag
    assert "window.__mermaidLayoutElk=" in tag


def test_link_mode_writes_versioned_bundle_and_license(fake_elk, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    tag = assets.elk_script_tag("link", out, "11.12.2")
    js = f"mermaid-layout-elk-{ELK_VERSION}.min.js"
    assert f'<script src="{js}" data-mermaid-layout-elk-version="{ELK_VERSION}"></script>' in tag
    assert (out / js).is_file()
    assert "EPL-2.0" in (out / f"LICENSE.mermaid-layout-elk-{ELK_VERSION}.txt").read_text(encoding="utf-8")


def test_unpaired_mermaid_version_is_an_error(monkeypatch):
    monkeypatch.setattr(assets, "MERMAID_LAYOUT_ELK", {})
    with pytest.raises(assets.AssetError, match="no layout-elk is paired with Mermaid 11.12.2"):
        assets.elk_script_tag("embed", None, "11.12.2")


def test_bundle_version_mismatch_is_an_error(fake_elk):
    (fake_elk / "mermaid-layout-elk.min.js").write_text('x={name:"@mermaid-js/layout-elk",version:"9.9.9"}',
                                                        encoding="utf-8")
    with pytest.raises(assets.AssetError, match="reports version 9.9.9"):
        assets.elk_script_tag("embed", None, "11.12.2")


def test_unbuilt_bundle_is_an_error_that_names_setup(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, "ELK_DIR", tmp_path)
    with pytest.raises(assets.AssetError, match=r"is not built .* setup --elk"):
        assets.elk_script_tag("embed", None, "11.12.2")


# --------------------------------------------------------------------------
# inclusion in documents
# --------------------------------------------------------------------------

ELK_SRC = "---\nconfig:\n  layout: elk\n---\nflowchart TD\n  A --> B"
PLAIN_SRC = "flowchart TD\n  A --> B"
ELK_TAG = "data-mermaid-layout-elk-version="


def _ctx(layout: Layout, svgs=None, tmp_path=None) -> RenderContext:
    metrics = build_metrics(get_format(layout.page), layout.font_size, layout.title_scale, layout.columns,
                            layout.figure_side, layout.split_ratio)
    return RenderContext(metrics, layout, Path("."), tmp_path, False, svgs)


def _doc(source: str):
    page = {"id": "p01", "kind": "content", "title": "T", "continued": False,
            "blocks": [{"id": "p01-b0", "type": "mermaid", "source": source}]}
    doc = {"version": 1, "meta": {"title": "T", "date": None, "source": None},
           "pages": [make_source_page("# T"), page]}
    return doc, [page]


def test_measure_document_includes_elk_only_when_requested(fake_elk):
    blocks = [{"id": "b0", "type": "mermaid", "source": ELK_SRC}]
    html = render_measure_document(blocks, _ctx(Layout(page="a4")))
    assert ELK_TAG in html
    assert html.index('data-mermaid-version="') < html.index(ELK_TAG) < html.index("registerElk(")
    plain = render_measure_document([{"id": "b0", "type": "mermaid", "source": PLAIN_SRC}], _ctx(Layout(page="a4")))
    assert ELK_TAG not in plain


def test_final_document_includes_elk_until_the_diagram_is_prerendered(fake_elk, tmp_path):
    doc, pages = _doc(ELK_SRC)
    assert ELK_TAG in render_document(doc, pages, _ctx(Layout(page="a4"), None, tmp_path), None)
    svg = '<svg viewBox="0 0 10 10"><g/></svg>'
    done = render_document(doc, pages, _ctx(Layout(page="a4"), {"p01-b0": svg}, tmp_path), None)
    assert ELK_TAG not in done and "EPL-2.0" not in done


def test_measure_document_with_elk_but_no_bundle_is_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, "ELK_DIR", tmp_path / "absent")
    blocks = [{"id": "b0", "type": "mermaid", "source": ELK_SRC}]
    with pytest.raises(assets.AssetError, match="setup --elk"):
        render_measure_document(blocks, _ctx(Layout(page="a4")))


def test_document_without_elk_needs_no_bundle(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, "ELK_DIR", tmp_path / "absent")  # would raise if it were looked up
    doc, pages = _doc(PLAIN_SRC)
    html = render_document(doc, pages, _ctx(Layout(page="a4", mermaid_lib="embed"), None, tmp_path), None)
    assert ELK_TAG not in html and "EPL-2.0" not in html


# --------------------------------------------------------------------------
# rendering (needs Chromium; skipped without it)
# --------------------------------------------------------------------------

def _browser():
    sync_api = pytest.importorskip("playwright.sync_api")
    pw = sync_api.sync_playwright().start()
    try:
        return pw, pw.chromium.launch()
    except Exception as e:  # noqa: BLE001 - Chromium not installed
        pw.stop()
        pytest.skip(f"Chromium is not available: {e}")


def _import(md: Path, out: Path, *extra: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / "md2html.py"), "import", str(md), "-o", str(out),
                           "--page", "a4", *extra], capture_output=True, text=True, env=env)


def _probe(browser, html: Path, block_elk: bool = False) -> dict:
    page = browser.new_page()
    if block_elk:
        page.route("**/mermaid-layout-elk-*.min.js", lambda route: route.abort())
    page.goto(html.resolve().as_uri())
    page.wait_for_function("document.documentElement.dataset.figures", timeout=60000)
    info = page.evaluate("""() => ({
        figures: document.documentElement.dataset.figures,
        error: document.documentElement.dataset.figuresError || '',
        viewBoxes: Array.from(document.querySelectorAll('figure.figure svg[aria-roledescription]'))
            .map(s => s.getAttribute('viewBox')),
    })""")
    page.close()
    return info


@pytest.fixture(scope="module")
def browser():
    if not _built():
        pytest.skip("ELK bundle not built (md2html.py setup --elk)")
    pw, b = _browser()
    yield b
    b.close()
    pw.stop()


def _assert_elk_drawn(view_boxes: list[str]) -> None:
    assert len(view_boxes) == 4
    elk, dagre = view_boxes[:3], view_boxes[3]
    assert len(set(elk)) == 1, elk  # the three ways of asking give the same ELK drawing
    assert elk[0] != dagre  # ... which is not the dagre drawing of the same graph


@pytest.mark.parametrize("lib", ["embed", "link"])
def test_elk_is_drawn_in_browser_rendered_documents(browser, tmp_path, lib):
    out = tmp_path / "elk.gospelo.html"
    r = _import(FIXTURE, out, "--mermaid-lib", lib)
    assert r.returncode == 0, r.stderr
    info = _probe(browser, out)
    assert info["figures"] == "done", info["error"]
    _assert_elk_drawn(info["viewBoxes"])


def test_prerendered_document_keeps_the_elk_drawing(browser, tmp_path):
    out = tmp_path / "elk.gospelo.html"
    r = _import(FIXTURE, out)  # default: prerender
    assert r.returncode == 0, r.stderr
    html = out.read_text(encoding="utf-8")
    assert ELK_TAG not in html
    view_boxes = re.findall(r'<svg[^>]*aria-roledescription="flowchart[^"]*"[^>]*viewBox="([^"]+)"', html)
    if not view_boxes:
        view_boxes = re.findall(r'<svg[^>]*viewBox="([^"]+)"[^>]*aria-roledescription="flowchart', html)
    _assert_elk_drawn(view_boxes)


def test_failed_bundle_load_is_an_error_not_a_fallback(browser, tmp_path):
    out = tmp_path / "elk.gospelo.html"
    assert _import(FIXTURE, out, "--mermaid-lib", "link").returncode == 0
    info = _probe(browser, out, block_elk=True)
    assert info["figures"] == "error"
    assert "the ELK layout bundle failed to load" in info["error"]


def test_import_without_the_bundle_fails_and_names_setup(tmp_path):
    # not XDG_CACHE_HOME: on Linux that also hides Playwright's Chromium
    env = dict(os.environ, GOSPELO_MD2HTML_CACHE_DIR=str(tmp_path / "empty-cache"))
    r = _import(FIXTURE, tmp_path / "elk.gospelo.html", env=env)
    if "Executable doesn't exist" in r.stderr:
        pytest.skip("Chromium is not available")
    assert r.returncode == 1
    assert "the layout-elk" in r.stderr and "is not built" in r.stderr and "setup --elk" in r.stderr
    assert not (tmp_path / "elk.gospelo.html").exists()


@needs_built
def test_unknown_elk_layout_name_fails_the_import(tmp_path):
    md = tmp_path / "bad.md"
    md.write_text("# bad\n\n```mermaid\n---\nconfig:\n  layout: elk.layered\n---\nflowchart TD\n  A --> B\n```\n",
                  encoding="utf-8")
    pytest.importorskip("playwright.sync_api")
    r = _import(md, tmp_path / "bad.gospelo.html")
    if "Executable doesn't exist" in r.stderr:
        pytest.skip("Chromium is not available")
    assert r.returncode == 1
    assert "diagram requests layout elk.layered, which is not an ELK layout" in r.stderr
