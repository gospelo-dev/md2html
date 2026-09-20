"""Custom font stacks via layout.fontFamily / codeFontFamily (--font-family / --code-font-family)
and the embedded BIZ UD font subsets (layout.embedFonts / --no-embed-fonts)."""

import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html import assets, fonts  # noqa: E402
from md2html.content import make_source_page  # noqa: E402
from md2html.formats import get_format  # noqa: E402
from md2html.layout import Layout, LayoutError, build_layout, layout_to_dict  # noqa: E402
from md2html.render import RenderContext, render_document  # noqa: E402
from md2html.scale import build_metrics  # noqa: E402


def render(layout: Layout, tmp_path: Path) -> str:
    page = {"id": "p01", "kind": "content", "title": None, "continued": False,
            "blocks": [{"id": "p01-b0", "type": "paragraph", "text": "x"}]}
    doc = {"version": 1, "meta": {"title": "T", "date": None, "source": None}, "pages": [make_source_page("# T"), page]}
    metrics = build_metrics(get_format(layout.page), layout.font_size, layout.title_scale, layout.columns,
                            layout.figure_side, layout.split_ratio)
    return render_document(doc, [page], RenderContext(metrics, layout, Path("."), tmp_path), None)


def test_base_css_uses_variables_with_default_stacks():
    css = assets.base_css()
    assert "var(--font-family, -apple-system" in css
    assert "var(--code-font-family, 'SFMono-Regular'" in css


def test_default_layout_emits_no_font_override(tmp_path):
    html = render(Layout(page="a4"), tmp_path)
    assert "--font-family:" not in html and "--code-font-family:" not in html


def test_custom_fonts_are_emitted_and_recorded(tmp_path):
    layout = build_layout(None, {"font_family": "'Noto Sans JP', sans-serif", "code_font_family": "'JetBrains Mono', monospace"})
    html = render(layout, tmp_path)
    assert "--font-family: 'Noto Sans JP', sans-serif;" in html
    assert "--code-font-family: 'JetBrains Mono', monospace;" in html
    d = layout_to_dict(layout)
    assert d["fontFamily"] == "'Noto Sans JP', sans-serif" and d["codeFontFamily"] == "'JetBrains Mono', monospace"
    merged = build_layout(None, {"font_family": None}, base=d)
    assert merged.font_family == "'Noto Sans JP', sans-serif"


def test_font_family_rejects_markup():
    with pytest.raises(LayoutError):
        build_layout(None, {"font_family": "x</style><script>"})
    with pytest.raises(LayoutError):
        build_layout(None, {"code_font_family": "   "})


# --- embedded web fonts (fonts.py) ---------------------------------------------

def test_vendored_fonts_exist_with_license():
    for f in fonts.VENDORED:
        assert (fonts.FONT_DIR / f.file).is_file(), f.file
    assert "SIL OPEN FONT LICENSE" in (fonts.FONT_DIR / "OFL.txt").read_text(encoding="utf-8")


def test_default_stacks_match_base_css():
    css = assets.base_css()
    assert f"var(--font-family, {fonts.DEFAULT_BODY_STACK})" in css
    assert f"var(--code-font-family, {fonts.DEFAULT_CODE_STACK})" in css


def test_faces_follow_the_stacks():
    def faces(body, code):
        return [(f.family, f.weight, roles) for f, roles in fonts.faces_to_embed(body, code)]
    assert faces(None, None) == [("BIZ UDPGothic", 400, ["body"]), ("BIZ UDPGothic", 700, ["bold"]),
                                 ("BIZ UDGothic", 400, ["code"])]
    assert faces("'BIZ UDGothic', sans-serif", None) == [("BIZ UDGothic", 400, ["body", "code"]), ("BIZ UDGothic", 700, ["bold"])]
    assert faces("'Noto Sans JP', sans-serif", "Menlo, monospace") == []


def test_subset_covers_only_the_used_characters():
    from fontTools.ttLib import TTFont
    data = fonts.subset_woff2(fonts.FONT_DIR / "BIZUDPGothic-Regular.woff2", "日本語 abc")
    assert len(data) < 20_000
    cmap = TTFont(io.BytesIO(data)).getBestCmap()
    assert all(ord(c) in cmap for c in "日本語abc")
    assert ord("英") not in cmap


def test_character_sets_route_text_to_the_faces_that_render_it():
    blocks = [{"type": "heading", "level": 2, "text": "見出し"},
              {"type": "paragraph", "text": "本文 **強調** `コード`"},
              {"type": "table", "header": ["列"], "rows": [["値"]]},
              {"type": "list", "ordered": False, "items": [{"text": "項", "children": [{"text": "子"}]}]},
              {"type": "code", "lang": None, "lines": ["print('挨拶')"]},
              {"type": "mermaid", "source": "graph LR; A[図]-->B"}]
    sets = fonts.character_sets(blocks, ["題"], "固定")
    for ch in "見出し本文強調列値項子図題固定続き0123456789/":
        assert ch in sets["body"], ch
    for ch in "見出し強調列題固定続き":
        assert ch in sets["bold"], ch
    for ch in "本文値項子":
        assert ch not in sets["bold"], ch
    for ch in "コード挨拶print(')":
        assert ch in sets["code"], ch
    assert "見" not in sets["code"] and "コ" not in sets["body"]


def test_font_face_is_embedded_and_measured_with(tmp_path):
    layout = Layout(page="a4")
    doc, page = sample_doc()
    css = fonts.embedded_font_css(page["blocks"], ["T"], layout)
    assert css.count("@font-face") == 3
    assert "font-family: 'BIZ UDPGothic'; font-weight: 700" in css
    assert "font-family: 'BIZ UDGothic'; font-weight: 400" in css
    assert "url(data:font/woff2;base64," in css
    html = render_with(layout, doc, page, tmp_path, css)
    assert html.index("@font-face") < html.index("--page-w:") < html.index("</style>")
    assert "@font-face" not in render_with(layout, doc, page, tmp_path, "")


def test_embed_fonts_off_emits_nothing():
    layout = build_layout(None, {"embed_fonts": False})
    _, page = sample_doc()
    assert fonts.embedded_font_css(page["blocks"], [], layout) == ""
    assert layout_to_dict(layout)["embedFonts"] is False
    other = build_layout(None, {"font_family": "Arial, sans-serif", "code_font_family": "Menlo, monospace"})
    assert fonts.embedded_font_css(page["blocks"], [], other) == ""


def sample_doc():
    page = {"id": "p01", "kind": "content", "title": None, "continued": False,
            "blocks": [{"id": "p01-b0", "type": "paragraph", "text": "埋め込み"}]}
    doc = {"version": 1, "meta": {"title": "T", "date": None, "source": None}, "pages": [make_source_page("# T"), page]}
    return doc, page


def render_with(layout: Layout, doc, page, tmp_path: Path, font_css: str) -> str:
    metrics = build_metrics(get_format(layout.page), layout.font_size, layout.title_scale, layout.columns,
                            layout.figure_side, layout.split_ratio)
    return render_document(doc, [page], RenderContext(metrics, layout, Path("."), tmp_path, font_css=font_css), None)
