#!/usr/bin/env python3
"""Draw the layout figures used by docs/DESIGN.md and docs/DESIGN_ja.md.

Every dimension comes from the tool's own formats.py / scale.py, so the
figures are to scale. SVGs are written next to this script and rendered to
PNG (2x) with Playwright:

    uv run --with playwright python assets/design/make_figures.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html.formats import MM_TO_PX, get_format  # noqa: E402
from md2html.scale import build_metrics  # noqa: E402

FONT = "'Helvetica Neue', Helvetica, Arial, 'Hiragino Sans', 'Noto Sans JP', sans-serif"
INK = "#2C2C2C"
GREY = "#666666"
LIGHT = "#94A3B8"
TEAL = "#0D9488"
TEAL_BG = "#F0FDFA"
GREY_BG = "#F8FAFC"
MARGIN_BG = "#EEF2F5"

L = {
    "en": {
        "anatomy_title": "Page anatomy, to scale",
        "slide": "16:9 slide, body 14pt (F = 18.67px)",
        "a4": "A4 portrait, body 11pt (F = 14.67px)",
        "margin_v": "top / bottom margin",
        "margin_h": "side margin",
        "header": "header band = title x 2.0 (2.5F)",
        "gap": "gap F",
        "content": "content area",
        "col": "column",
        "gutter": "gap 1.5F",
        "footer": "footer in the bottom margin, text min(0.75F, 0.36M)",
        "single": "single column",
        "chars": "chars/line",
        "lines": "lines/page",
        "scale_title": "Type scale and vertical rhythm (F = body size)",
        "rhythm": "space above / below",
        "h1": "h1 1.6F", "h2": "h2 1.35F", "h3": "h3 1.15F", "body": "body 1.0F",
        "table": "table 0.9F", "code": "code 0.85F", "caption": "caption 0.8F",
        "footer_t": "footer 0.75F",
        "r_h2_above": "1.8F", "r_h2_below": "0.6F", "r_para": "0.7F", "r_h3_above": "1.4F", "r_h3_below": "0.4F",
        "r_table_above": "0.5F", "r_table_below": "1.0F",
        "para": "paragraph", "tbl": "table",
        "columns_title": "Two columns in column order (16:9, to scale)",
        "n_order": "column order: down the left column, then the right (a mirrored N)",
        "band": "band: table with 4+ columns, code, wide figure",
        "float": "a figure that does not fit the left column|floats to the top of the empty right column",
        "resume": "columns resume after the band",
        "split_title": "A long table across pages (A4)",
        "page": "page",
        "thead": "header row",
        "repeat": "header repeated on every page, caption \"(続き)\"",
        "min3": "at least 3 rows in the first fragment",
        "rowsplit": "split at a row boundary, at measured row heights",
        "cont": "(続き)",
        "rows": "rows",
    },
    "ja": {
        "anatomy_title": "版面の構成 (実寸比)",
        "slide": "16:9 スライド、本文 14pt (F = 18.67px)",
        "a4": "A4 縦、本文 11pt (F = 14.67px)",
        "margin_v": "上下余白",
        "margin_h": "左右余白",
        "header": "ヘッダー帯 = タイトル x 2.0 (2.5F)",
        "gap": "間隔 F",
        "content": "本文領域",
        "col": "段",
        "gutter": "段間 1.5F",
        "footer": "フッターは下余白の帯の中。文字 min(0.75F, 0.36M)",
        "single": "単段",
        "chars": "字/行",
        "lines": "行/ページ",
        "scale_title": "文字の階層と縦のリズム (F = 本文サイズ)",
        "rhythm": "上下の空き",
        "h1": "h1 1.6F", "h2": "h2 1.35F", "h3": "h3 1.15F", "body": "本文 1.0F",
        "table": "表 0.9F", "code": "コード 0.85F", "caption": "キャプション 0.8F",
        "footer_t": "フッター 0.75F",
        "r_h2_above": "1.8F", "r_h2_below": "0.6F", "r_para": "0.7F", "r_h3_above": "1.4F", "r_h3_below": "0.4F",
        "r_table_above": "0.5F", "r_table_below": "1.0F",
        "para": "段落", "tbl": "表",
        "columns_title": "2 段組 (左段 → 右段) (16:9、実寸比)",
        "n_order": "左段を上から下へ、次に右段へ (И の形)",
        "band": "帯: 4 列以上の表、コード、横長の図",
        "float": "左段に入らない図は空いている右段へ浮動",
        "resume": "帯の後は再び 2 段",
        "split_title": "長い表のページ分割 (A4)",
        "page": "ページ",
        "thead": "ヘッダー行",
        "repeat": "各ページでヘッダーを繰り返し、「(続き)」を付ける",
        "min3": "前半は 3 行以上",
        "rowsplit": "実測した行高で、行境界で分割",
        "cont": "(続き)",
        "rows": "行",
    },
}


class SVG:
    def __init__(self, w: float, h: float):
        self.w, self.h = w, h
        self.parts: list[str] = []

    def rect(self, x, y, w, h, fill="#FFFFFF", stroke=GREY, sw=1.0, dash=None, rx=0):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def text(self, x, y, s, size=12, anchor="start", weight="normal", fill=INK, family=FONT):
        s = s.replace("&", "&amp;").replace("<", "&lt;")
        self.parts.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{s}</text>')

    def line(self, x1, y1, x2, y2, stroke=GREY, sw=1.0, dash=None, marker=False):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = ' marker-end="url(#arrow)"' if marker else ""
        self.parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{stroke}" stroke-width="{sw}"{d}{m}/>')

    def dim_h(self, x1, x2, y, label, size=11):
        """Horizontal dimension line with ticks and a centred label above."""
        self.line(x1, y, x2, y, stroke=TEAL, sw=1)
        for x in (x1, x2):
            self.line(x, y - 4, x, y + 4, stroke=TEAL, sw=1)
        self.text((x1 + x2) / 2, y - 5, label, size=size, anchor="middle", fill=TEAL)

    def dim_v(self, x, y1, y2, label, size=11, side="right"):
        self.line(x, y1, x, y2, stroke=TEAL, sw=1)
        for y in (y1, y2):
            self.line(x - 4, y, x + 4, y, stroke=TEAL, sw=1)
        if side == "right":
            self.text(x + 6, (y1 + y2) / 2 + 4, label, size=size, anchor="start", fill=TEAL)
        else:
            self.text(x - 6, (y1 + y2) / 2 + 4, label, size=size, anchor="end", fill=TEAL)

    def lines(self, x, y, w, n, step, color=LIGHT, sw=2, last_frac=0.6):
        """Text-line placeholders."""
        for i in range(n):
            ww = w * (last_frac if i == n - 1 else 1.0)
            self.line(x, y + i * step, x + ww, y + i * step, stroke=color, sw=sw)

    def save(self, path: Path):
        body = "\n".join(self.parts)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">\n'
               '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">'
               f'<path d="M0,0 L8,4 L0,8 z" fill="{TEAL}"/></marker></defs>\n'
               f'<rect width="{self.w}" height="{self.h}" fill="#FFFFFF"/>\n{body}\n</svg>\n')
        path.write_text(svg, encoding="utf-8")


def metrics(page_id: str):
    fmt = get_format(page_id)
    return build_metrics(fmt, None, 1.25, None, "right", 0.5)


# --------------------------------------------------------------------------
# figure 1: page anatomy
# --------------------------------------------------------------------------

def draw_page(svg: SVG, m, ox: float, oy: float, s: float, t: dict, two_columns: bool, title: str):
    pw, ph = m.page_w_px * s, m.page_h_px * s
    mv, mh = m.margin_v_px * s, m.margin_h_px * s
    svg.text(ox, oy - 12, title, size=13, weight="bold")
    svg.rect(ox, oy, pw, ph, fill=MARGIN_BG, stroke=GREY, sw=1.2)
    y = oy + mv
    x = ox + mh
    cw = m.content_w_px * s
    if m.fmt.is_slide:
        hb = m.header_band_px * s
        svg.rect(x, y, cw, hb, fill=TEAL_BG, stroke=TEAL, sw=1)
        svg.text(x + 6, y + hb * 0.62, t["header"], size=10, fill=TEAL)
        y += hb
        svg.text(x + cw - 4, y + m.header_gap_px * s * 0.85, t["gap"], size=8, anchor="end", fill=GREY)
        y += m.header_gap_px * s
    ch = m.content_h_px * s
    svg.rect(x, y, cw, ch, fill="#FFFFFF", stroke=LIGHT, sw=1, dash="4 3")
    if two_columns:
        colw, g = m.col2_px * s, m.gutter_px * s
        for cx in (x, x + colw + g):
            svg.rect(cx, y, colw, ch, fill="#FFFFFF", stroke=TEAL, sw=1)
            svg.lines(cx + 8, y + 22, colw - 16, int((ch - 20) / 14), 14)
            svg.text(cx + 8, y + 12, f'{t["col"]} {m.col2_px:.0f}px', size=9, fill=TEAL)
        svg.dim_h(x + colw, x + colw + g, y - 6, t["gutter"], size=9)
    else:
        svg.lines(x + 8, y + 22, cw - 16, int((ch - 20) / 14), 14)
        svg.text(x + 8, y + 12, f'{t["single"]} {m.content_w_px:.0f}px', size=9, fill=TEAL)
    fy = oy + ph - mv
    svg.text(x, fy + mv * 0.62, t["footer"], size=9, fill=GREY)
    # dimensions
    svg.dim_v(ox - 14, oy, oy + mv, f'{m.fmt.margin_v_mm:g}mm', side="left")
    svg.dim_h(ox, ox + mh, oy + ph + 16, f'{m.fmt.margin_h_mm:g}mm')
    svg.dim_v(ox + pw + 14, y, y + ch, f'{m.content_h_px:.0f}px', side="right")
    svg.text(ox + pw / 2, oy + ph + 40, f'{m.fmt.width_mm:g} x {m.fmt.height_mm:g}mm, {t["margin_v"]} {m.fmt.margin_v_mm:g}mm, {t["margin_h"]} {m.fmt.margin_h_mm:g}mm',
             size=10, anchor="middle", fill=GREY)
    svg.text(ox + pw / 2, oy + ph + 58, f'{t["content"]} {m.content_w_px:.0f} x {m.content_h_px:.0f}px', size=10, anchor="middle", fill=GREY)


def fig_anatomy(lang: str, out: Path):
    t = L[lang]
    s = 0.42
    m16, ma4 = metrics("16x9"), metrics("a4")
    svg = SVG(1240, 700)
    svg.text(20, 30, t["anatomy_title"], size=18, weight="bold")
    draw_page(svg, m16, 60, 70, s, t, True, t["slide"])
    draw_page(svg, ma4, 760, 70, s, t, False, t["a4"])
    chars16 = int(m16.col2_px / m16.F)
    charsa4 = int(ma4.content_w_px / ma4.F)
    svg.text(60 + m16.page_w_px * s / 2, 70 + m16.page_h_px * s + 76, f'{chars16} {t["chars"]} ({t["col"]}), {int(m16.content_h_px / m16.line_px)} {t["lines"]}', size=10, anchor="middle", fill=GREY)
    svg.text(760 + ma4.page_w_px * s / 2, 70 + ma4.page_h_px * s + 76, f'{charsa4} {t["chars"]}, {int(ma4.content_h_px / ma4.line_px)} {t["lines"]}', size=10, anchor="middle", fill=GREY)
    svg.save(out)


# --------------------------------------------------------------------------
# figure 2: type scale and vertical rhythm
# --------------------------------------------------------------------------

def fig_scale(lang: str, out: Path):
    t = L[lang]
    F = 26.0  # drawing size of F
    svg = SVG(1240, 760)
    svg.text(20, 30, t["scale_title"], size=18, weight="bold")
    sample = "Gospelo 見出し Aa" if lang == "ja" else "Gospelo Heading Aa"
    rows = [("h1", 1.6, "bold"), ("h2", 1.35, "bold"), ("h3", 1.15, "bold"), ("body", 1.0, "normal"),
            ("table", 0.9, "normal"), ("code", 0.85, "normal"), ("caption", 0.8, "normal"), ("footer_t", 0.75, "normal")]
    y = 80
    for key, k, w in rows:
        size = F * k
        svg.rect(140, y - size, size * 3.2, size, fill=TEAL_BG, stroke="none")
        svg.line(140, y, 140 + F * 5.2, y, stroke=LIGHT, sw=0.5)
        family = "Menlo, 'SFMono-Regular', monospace" if key == "code" else FONT
        svg.text(140, y - size * 0.18, sample, size=size, weight=w, family=family)
        svg.text(130, y - size * 0.25, t[key], size=11, anchor="end", fill=TEAL)
        y += size + 16
    # rhythm panel
    x0 = 700
    svg.text(x0, 60, t["rhythm"], size=13, weight="bold")
    y = 80
    def block(label, h, fill="#FFFFFF", stroke=GREY):
        nonlocal y
        svg.rect(x0, y, 420, h, fill=fill, stroke=stroke)
        svg.text(x0 + 8, y + h / 2 + 4, label, size=11)
        y += h
    def space(label, k):
        nonlocal y
        h = F * k * 0.9
        svg.rect(x0, y, 420, h, fill=TEAL_BG, stroke="none")
        svg.line(x0, y, x0 + 420, y, stroke=TEAL, sw=0.6, dash="3 3")
        svg.text(x0 + 428, y + h / 2 + 4, label, size=11, fill=TEAL)
        y += h
    block(t["para"], F * 1.6 * 2)
    space(t["r_para"], 0.7)
    space(t["r_h2_above"], 1.8)
    block("h2", F * 1.35 * 1.3, fill="#FFFFFF", stroke=TEAL)
    space(t["r_h2_below"], 0.6)
    block(t["para"], F * 1.6 * 2)
    space(t["r_h3_above"], 1.4)
    block("h3", F * 1.15 * 1.3, fill="#FFFFFF", stroke=TEAL)
    space(t["r_h3_below"], 0.4)
    block(t["para"], F * 1.6 * 1)
    space(t["r_table_above"], 0.5)
    block(t["tbl"], F * 1.45 * 2, fill=GREY_BG)
    space(t["r_table_below"], 1.0)
    block(t["para"], F * 1.6 * 1)
    svg.save(out)


# --------------------------------------------------------------------------
# figure 3: two columns in column order (left, then right), band and float
# --------------------------------------------------------------------------

def fig_columns(lang: str, out: Path):
    t = L[lang]
    m = metrics("16x9")
    s = 0.7
    svg = SVG(1240, 600)
    svg.text(20, 30, t["columns_title"], size=18, weight="bold")
    ox, oy = 60, 60
    pw, ph = m.page_w_px * s, m.page_h_px * s
    svg.rect(ox, oy, pw, ph, fill=MARGIN_BG, stroke=GREY, sw=1.2)
    x = ox + m.margin_h_px * s
    y = oy + m.margin_v_px * s
    cw = m.content_w_px * s
    hb = m.header_band_px * s
    svg.rect(x, y, cw, hb, fill=TEAL_BG, stroke=TEAL)
    svg.text(x + 6, y + hb * 0.62, "h2", size=11, fill=TEAL)
    y += hb + m.header_gap_px * s
    ch = m.content_h_px * s
    colw, g = m.col2_px * s, m.gutter_px * s
    xl, xr = x, x + colw + g
    # segment 1: two columns
    seg1_h = ch * 0.52
    def num_block(cx, cy, w, h, n, label, fill="#FFFFFF", stroke=GREY):
        svg.rect(cx, cy, w, h, fill=fill, stroke=stroke)
        svg.text(cx + 6, cy + 14, f"{n} {label}", size=10)
    lbl_head = "見出し" if lang == "ja" else "heading"
    lbl_para = t["para"]
    lbl_list = "リスト" if lang == "ja" else "list"
    lbl_fig = "図" if lang == "ja" else "figure"
    lbl_tbl3 = "表 (3 列)" if lang == "ja" else "table (3 columns)"
    num_block(xl, y, colw, 22, 1, lbl_head)
    num_block(xl, y + 26, colw, 70, 2, lbl_para)
    num_block(xl, y + 100, colw, 60, 3, lbl_list)
    num_block(xl, y + 164, colw, seg1_h - 164, 5, lbl_para)
    num_block(xr, y, colw, 110, 4, lbl_fig, fill=TEAL_BG, stroke=TEAL)
    num_block(xr, y + 114, colw, 60, 6, lbl_tbl3, fill=GREY_BG)
    num_block(xr, y + 178, colw, seg1_h - 178, 7, lbl_para)
    # band
    by = y + seg1_h + 10
    bh = ch * 0.22
    svg.rect(x, by, cw, bh, fill=GREY_BG, stroke=TEAL, sw=1.2)
    svg.text(x + 6, by + 14, f'8 {t["band"]}', size=10, fill=TEAL)
    # segment 2
    y2 = by + bh + 10
    h2 = y + ch - y2
    num_block(xl, y2, colw, h2, 9, lbl_para)
    num_block(xr, y2, colw, h2, 10, lbl_para)
    # reading-order arrows
    ax = ox + pw + 30
    svg.line(ax, y, ax, y + seg1_h - 4, stroke=TEAL, sw=1.5, marker=True)
    svg.line(ax + 16, y, ax + 16, y + seg1_h - 4, stroke=TEAL, sw=1.5, marker=True, dash="4 3")
    tx = ax + 30
    svg.text(tx, y + 12, t["n_order"], size=11, fill=TEAL)
    svg.text(tx, y + 30, "1 -> 2 -> 3 -> 5", size=10, fill=GREY)
    svg.text(tx, y + 46, "4 -> 6 -> 7", size=10, fill=GREY)
    for i, part in enumerate(t["float"].split("|")):
        svg.text(tx, y + 90 + i * 15, part, size=10, fill=GREY)
    svg.text(tx, by + 14, t["resume"], size=11, fill=TEAL)
    svg.text(tx, by + 30, "9 -> 10", size=10, fill=GREY)
    svg.save(out)


# --------------------------------------------------------------------------
# figure 4: table split across pages
# --------------------------------------------------------------------------

def fig_split(lang: str, out: Path):
    t = L[lang]
    m = metrics("a4")
    s = 0.44
    svg = SVG(1240, 680)
    svg.text(20, 30, t["split_title"], size=18, weight="bold")
    pw, ph = m.page_w_px * s, m.page_h_px * s
    mv, mh = m.margin_v_px * s, m.margin_h_px * s
    row_h = 13
    first_rows = 0
    for i, ox in enumerate((60, 60 + pw + 120)):
        oy = 60
        svg.rect(ox, oy, pw, ph, fill=MARGIN_BG, stroke=GREY, sw=1.2)
        x, y = ox + mh, oy + mv
        cw = m.content_w_px * s
        svg.text(ox + pw / 2, oy - 8, f'{t["page"]} {i + 1}', size=12, anchor="middle", weight="bold")
        if i == 0:
            svg.rect(x, y, cw * 0.5, 14, fill="#FFFFFF", stroke=GREY)
            svg.text(x + 4, y + 11, "h2", size=9)
            y += 22
            svg.lines(x, y + 6, cw, 3, 8)
            y += 30
        else:
            svg.text(x, y + 10, t["cont"], size=9, fill=GREY)
            y += 16
        # header row
        svg.rect(x, y, cw, row_h, fill=TEAL_BG, stroke=TEAL)
        svg.text(x + 4, y + 10, t["thead"], size=9, fill=TEAL)
        y += row_h
        n = int((oy + ph - mv - y) / row_h) if i == 0 else 12
        start = 1 if i == 0 else first_rows + 1
        if i == 0:
            first_rows = n
        for r in range(n):
            svg.rect(x, y, cw, row_h, fill="#FFFFFF", stroke="#DDDDDD", sw=0.6)
            svg.text(x + 4, y + 10, f"{start + r}", size=8, fill=GREY)
            y += row_h
        if i == 1:
            svg.lines(x, y + 12, cw, 2, 8)
        fy = oy + ph - mv
        svg.line(x, fy, x + cw, fy, stroke=LIGHT, sw=0.5, dash="3 3")
    # annotations
    ax = 60 + pw + 10
    svg.text(ax + 50, 60 + ph / 2 - 10, "→", size=28, anchor="middle", fill=TEAL)
    svg.text(60, 60 + ph + 40, f'1. {t["rowsplit"]}', size=11)
    svg.text(60, 60 + ph + 60, f'2. {t["repeat"]}', size=11)
    svg.text(60, 60 + ph + 80, f'3. {t["min3"]}', size=11)
    svg.save(out)


FIGS = {"page-anatomy": fig_anatomy, "type-scale": fig_scale, "two-columns": fig_columns, "table-split": fig_split}


def render_png(svgs: list[Path]) -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=2)
        for svg in svgs:
            pg.goto(svg.resolve().as_uri())
            el = pg.query_selector("svg")
            el.screenshot(path=str(svg.with_suffix(".png")), type="png")
            print("rendered", svg.with_suffix(".png").name)
        b.close()


def main() -> int:
    tmp = Path("/tmp/md2html_figs")
    tmp.mkdir(exist_ok=True)
    svgs = []
    for name, fn in FIGS.items():
        for lang in ("en", "ja"):
            path = tmp / f"{name}.{lang}.svg"
            fn(lang, path)
            svgs.append(path)
    render_png(svgs)
    for svg in svgs:
        png = svg.with_suffix(".png")
        (HERE / png.name).write_bytes(png.read_bytes())
    return 0


if __name__ == "__main__":
    sys.exit(main())
