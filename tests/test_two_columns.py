"""Two-column (column order: left, then right) pagination with fixed heights (no browser). Run:
    uv run --with pytest --with markdown-it-py --with mdit-py-plugins pytest <repo>/tests
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html.paginate import BlockHeight, PaginateContext, is_wide, paginate, spill_pages  # noqa: E402

LINE = 24.0


COL_BOX = (400.0, 490.0)     # one column: 400px wide, up to 490px tall
BAND_BOX = (830.0, 300.0)    # full width: 830px wide, up to 300px tall (0.6 of the page)


def ctx(heights, capacity=500.0, slide=False, span=None):
    return PaginateContext(is_slide=slide, columns="two", capacity=capacity, line_px=LINE,
                           heights=dict(heights), heights_single=dict(heights), doc_title="Doc",
                           span_override=span or {}, col_box=COL_BOX, band_box=BAND_BOX)


def para(i, h):
    return {"type": "paragraph", "text": f"p{i}", "id": f"b{i}"}, BlockHeight(h, 0, 10)


def layout_of(page):
    return page.to_json()["_layout"]


def ids(page):
    return [b["id"] for b in page.to_json()["blocks"]]


def test_n_order_fills_left_column_then_right():
    blocks, heights = [], {}
    for i in range(6):
        b, h = para(i, 100)
        blocks.append(b)
        heights[b["id"]] = h
    pages = paginate(blocks, ctx(heights, capacity=350))
    assert len(pages) == 1
    assert ids(pages[0]) == [f"b{i}" for i in range(6)]
    (cols,) = layout_of(pages[0])
    assert cols["kind"] == "cols"
    assert cols["left"] == [0, 1, 2] and cols["right"] == [3, 4, 5]


def test_overflow_of_the_right_column_starts_a_continuation_page():
    blocks, heights = [], {}
    for i in range(8):
        b, h = para(i, 100)
        blocks.append(b)
        heights[b["id"]] = h
    pages = paginate(blocks, ctx(heights, capacity=350), initial_title="T")
    assert [len(p.to_json()["blocks"]) for p in pages] == [6, 2]
    assert pages[1].continued is True and pages[1].title == "T"


def test_wide_table_becomes_a_band_and_takes_its_heading_along():
    heading = {"type": "heading", "level": 3, "text": "H", "id": "h"}
    table = {"type": "table", "header": ["a", "b", "c", "d"], "rows": [["1", "2", "3", "4"]], "id": "t"}
    p0, h0 = para(0, 100)
    heights = {"h": BlockHeight(30, 20, 5), "t": BlockHeight(80, 0, 10, thead=30, rows=[50]), "b0": h0}
    c = ctx(heights)
    assert is_wide(table, c)
    pages = paginate([p0, heading, table], c)
    layout = layout_of(pages[0])
    assert [seg["kind"] for seg in layout] == ["cols", "wide", "wide"]
    assert ids(pages[0]) == ["b0", "h", "t"]
    assert layout[1]["index"] == 1 and layout[2]["index"] == 2


def test_narrow_table_and_paragraph_stay_in_the_columns():
    table = {"type": "table", "header": ["a", "b", "c"], "rows": [["1", "2", "3"]], "id": "t"}
    heights = {"t": BlockHeight(80, 0, 10, thead=30, rows=[50])}
    assert not is_wide(table, ctx(heights))


def test_figure_becomes_a_band_when_that_renders_it_larger():
    wide = {"type": "mermaid", "source": "graph LR; A-->B", "id": "w"}
    tall = {"type": "mermaid", "source": "graph TB; A-->B", "id": "t"}
    heights = {"w": BlockHeight(200, 0, 10, intrinsic_w=800, intrinsic_h=400),   # column 0.5, band 0.75
               "t": BlockHeight(490, 0, 10, intrinsic_w=400, intrinsic_h=600)}   # column 0.82, band 0.5
    c = ctx(heights)
    assert is_wide(wide, c)
    assert not is_wide(tall, c)


def test_span_override_forces_a_band_or_a_column():
    p0, h0 = para(0, 100)
    heights = {"b0": h0}
    assert is_wide(p0, ctx(heights, span={"b0": 2}))
    code = {"type": "code", "lang": None, "lines": ["x"], "id": "c"}
    heights["c"] = BlockHeight(40, 0, 10, lines=[20], padding=20)
    assert not is_wide(code, ctx(heights, span={"c": 1}))


def test_figure_floats_to_the_empty_right_column_and_text_keeps_flowing_left():
    heading = {"type": "heading", "level": 3, "text": "H", "id": "h"}
    fig = {"type": "mermaid", "source": "graph TB; A-->B", "id": "f"}
    lst = {"type": "list", "ordered": False, "items": [{"text": "x"}], "id": "l"}
    heights = {"h": BlockHeight(30, 20, 5), "f": BlockHeight(460, 0, 10, intrinsic_w=100, intrinsic_h=300),
               "l": BlockHeight(120, 0, 10)}
    pages = paginate([heading, fig, lst], ctx(heights, capacity=500))
    assert len(pages) == 1
    assert ids(pages[0]) == ["h", "f", "l"]
    (cols,) = layout_of(pages[0])
    assert cols["left"] == [0, 2] and cols["right"] == [1]


def test_balancing_never_makes_the_region_taller():
    """Regression: balancing at a section break used to move the text that flowed
    beside a floated figure into the figure's column, overflowing the page."""
    heading = {"type": "heading", "level": 3, "text": "H", "id": "h"}
    fig = {"type": "mermaid", "source": "graph TB; A-->B", "id": "f"}
    l1 = {"type": "list", "ordered": False, "items": [{"text": "x"}], "id": "l1"}
    l2 = {"type": "list", "ordered": False, "items": [{"text": "y"}], "id": "l2"}
    h2 = {"type": "heading", "level": 2, "text": "Next", "id": "h2"}
    p1, hp1 = para(1, 50)
    heights = {"h": BlockHeight(30, 20, 5), "f": BlockHeight(460, 0, 10, intrinsic_w=100, intrinsic_h=300),
               "l1": BlockHeight(120, 0, 10), "l2": BlockHeight(200, 0, 10), "h2": BlockHeight(30, 20, 5), "b1": hp1}
    pages = paginate([heading, fig, l1, l2, h2, p1], ctx(heights, capacity=500, slide=True))
    first = pages[0]
    (cols,) = layout_of(first)
    assert cols["left"] == [0, 2, 3] and cols["right"] == [1]
    right_height = sum(heights[i].outer for i in ["f"])
    assert right_height <= 500
    assert pages[1].title == "Next"


def test_page_end_is_not_balanced_left_column_fills_first():
    blocks, heights = [], {}
    for i in range(6):
        b, h = para(i, 100)
        blocks.append(b)
        heights[b["id"]] = h
    pages = paginate(blocks, ctx(heights, capacity=500))
    (cols,) = layout_of(pages[0])
    assert cols["left"] == [0, 1, 2, 3] and cols["right"] == [4, 5]


def test_balancing_does_not_strand_a_lone_heading():
    """Regression: a page holding only a heading and an unsplittable code block was
    balanced into heading | code, leaving the heading alone in the left column."""
    heading = {"type": "heading", "level": 3, "text": "H", "id": "h"}
    code = {"type": "code", "lang": "json", "lines": ["x"] * 4, "id": "c"}
    table = {"type": "table", "header": ["a", "b", "c", "d"], "rows": [["1", "2", "3", "4"]], "id": "t"}
    heights = {"h": BlockHeight(30, 20, 5), "c": BlockHeight(250, 10, 20, lines=[60] * 4, padding=10),
               "t": BlockHeight(80, 0, 10, thead=30, rows=[50])}
    pages = paginate([heading, code, table], ctx(heights, capacity=500))
    cols, band = layout_of(pages[0])
    assert band["kind"] == "wide"
    assert cols["left"] == [0, 1] and cols["right"] == []


def test_short_region_is_not_balanced():
    p0, h0 = para(0, 60)
    p1, h1 = para(1, 60)
    pages = paginate([p0, p1], ctx({"b0": h0, "b1": h1}, capacity=500))
    (cols,) = layout_of(pages[0])
    assert cols["left"] == [0, 1] and cols["right"] == []


def test_spill_page_keeps_layout_and_unique_continuation_ids():
    page = {"id": "p05", "kind": "content", "title": "T", "continued": False,
            "blocks": [{"type": "paragraph", "text": "a", "id": "p05-b0"},
                       {"type": "paragraph", "text": "b", "id": "p05-b1"},
                       {"type": "paragraph", "text": "c", "id": "p05-b2"}]}
    heights = {"p05-b0": BlockHeight(300, 0, 10), "p05-b1": BlockHeight(300, 0, 10), "p05-b2": BlockHeight(300, 0, 10)}
    new_pages, spills = spill_pages([page], lambda cols: ctx(heights, capacity=400), lambda p: "two",
                                    existing_ids={"p05-2"})
    assert [p["id"] for p in new_pages] == ["p05", "p05-3"]
    assert new_pages[0]["_layout"][0]["left"] == [0] and new_pages[0]["_layout"][0]["right"] == [1]
    assert spills[0].blocks == ["p05-b2"]
