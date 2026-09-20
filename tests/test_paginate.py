"""Pagination rules with fixed heights (no browser). Run:
    uv run --with pytest --with markdown-it-py --with mdit-py-plugins pytest <skill>/tests
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html.paginate import BlockHeight, PaginateContext, paginate, spill_pages, flatten_for_reflow  # noqa: E402

LINE = 24.0


def ctx(blocks, capacity=500.0, slide=False, columns="single", col_heights=None, single_heights=None):
    single = single_heights or {}
    col = col_heights or single
    return PaginateContext(is_slide=slide, columns=columns, capacity=capacity, line_px=LINE,
                           heights=dict(col), heights_single=dict(single), doc_title="Doc")


def para(i, h, text="a b c"):
    return {"type": "paragraph", "text": text, "id": f"b{i}"}, BlockHeight(h, 0, 10)


def test_blocks_flow_until_capacity():
    blocks, heights = [], {}
    for i in range(6):
        b, h = para(i, 100)
        blocks.append(b)
        heights[b["id"]] = h
    pages = paginate(blocks, ctx(blocks, capacity=350, single_heights=heights))
    assert [len(p.blocks) for p in pages] == [3, 3]


def test_heading_keeps_with_next():
    blocks = [{"type": "paragraph", "text": "x", "id": "b0"},
              {"type": "heading", "level": 3, "text": "H", "id": "b1"},
              {"type": "paragraph", "text": "y", "id": "b2"}]
    heights = {"b0": BlockHeight(400, 0, 10), "b1": BlockHeight(30, 20, 5), "b2": BlockHeight(200, 0, 10)}
    pages = paginate(blocks, ctx(blocks, capacity=500, single_heights=heights))
    assert [b["id"] for b in pages[0].blocks] == ["b0"]
    assert [b["id"] for b in pages[1].blocks] == ["b1", "b2"]


def test_heading_follows_a_block_moved_whole():
    blocks = [{"type": "paragraph", "text": "x", "id": "b0"},
              {"type": "heading", "level": 2, "text": "H", "id": "b1"},
              {"type": "table", "header": ["h"], "rows": [["1"], ["2"], ["3"], ["4"]], "id": "b2"}]
    heights = {"b0": BlockHeight(300, 0, 10), "b1": BlockHeight(30, 20, 5),
               "b2": BlockHeight(30 + 4 * 40, 0, 10, thead=30, rows=[40] * 4)}
    pages = paginate(blocks, ctx(blocks, capacity=450, single_heights=heights))
    assert [b["id"] for b in pages[0].blocks] == ["b0"]
    assert [b["id"] for b in pages[1].blocks] == ["b1", "b2"]


def test_heading_reserves_full_figure_height_in_single_mode():
    blocks = [{"type": "paragraph", "text": "x", "id": "b0"},
              {"type": "heading", "level": 3, "text": "H", "id": "b1"},
              {"type": "image", "src": "a.png", "alt": "", "id": "b2"}]
    heights = {"b0": BlockHeight(200, 0, 10), "b1": BlockHeight(30, 20, 5), "b2": BlockHeight(300, 0, 10)}
    pages = paginate(blocks, ctx(blocks, capacity=400, single_heights=heights))
    assert [b["id"] for b in pages[1].blocks] == ["b1", "b2"]


def test_table_splits_by_rows_with_min_three():
    rows = [[str(i)] for i in range(10)]
    table = {"type": "table", "header": ["h"], "rows": rows, "id": "t"}
    heights = {"t": BlockHeight(30 + 10 * 40, 0, 10, thead=30, rows=[40] * 10, line_height=20)}
    pages = paginate([table], ctx([table], capacity=300, single_heights=heights))
    assert pages[0].blocks[0]["rows"] == rows[:6]
    assert pages[1].blocks[0]["continued"] is True
    assert pages[1].blocks[0]["rows"] == rows[6:]


def test_table_is_not_split_when_it_fits_on_a_fresh_page():
    filler = {"type": "paragraph", "text": "p", "id": "p"}
    table = {"type": "table", "header": ["h"], "rows": [["1"], ["2"], ["3"], ["4"]], "id": "t"}
    heights = {"p": BlockHeight(300, 0, 10), "t": BlockHeight(30 + 4 * 40, 0, 10, thead=30, rows=[40] * 4)}
    pages = paginate([filler, table], ctx([filler, table], capacity=400, single_heights=heights))
    assert len(pages) == 2 and "continued" not in pages[1].blocks[0]


def test_code_under_16_lines_is_not_split():
    code = {"type": "code", "lang": None, "lines": ["x"] * 10, "id": "c"}
    filler = {"type": "paragraph", "text": "p", "id": "p"}
    heights = {"p": BlockHeight(300, 0, 10), "c": BlockHeight(10 * 20 + 20, 0, 10, lines=[20] * 10, padding=20)}
    pages = paginate([filler, code], ctx([filler, code], capacity=400, single_heights=heights))
    assert len(pages) == 2 and len(pages[1].blocks[0]["lines"]) == 10


def test_ordered_list_continues_numbering():
    lst = {"type": "list", "ordered": True, "items": [{"text": str(i)} for i in range(6)], "id": "l"}
    heights = {"l": BlockHeight(6 * 50, 0, 10, items=[50] * 6)}
    pages = paginate([lst], ctx([lst], capacity=200, single_heights=heights))
    # 3 items (150px) fit under capacity 200 minus the 10px bottom margin; the tail starts at item 4
    assert [i["text"] for i in pages[0].blocks[0]["items"]] == ["0", "1", "2"]
    assert pages[1].blocks[0]["start"] == 4


def test_slide_h2_becomes_title_and_figure_goes_to_slot():
    blocks = [{"type": "heading", "level": 1, "text": "Deck", "id": "b0"},
              {"type": "heading", "level": 2, "text": "Sec", "id": "b1"},
              {"type": "paragraph", "text": "p", "id": "b2"},
              {"type": "mermaid", "source": "graph LR; A-->B", "id": "b3"},
              {"type": "mermaid", "source": "graph LR; C-->D", "id": "b4"}]
    heights = {"b2": BlockHeight(50, 0, 10), "b3": BlockHeight(200, 0, 10), "b4": BlockHeight(200, 0, 10)}
    pages = paginate(blocks, ctx(blocks, capacity=500, slide=True, columns="split", single_heights=heights))
    assert pages[0].kind == "cover"
    assert pages[1].title == "Sec" and pages[1].figure["id"] == "b3"
    assert all(b["type"] != "heading" or b["level"] != 2 for b in pages[1].blocks)
    assert pages[2].continued is True and pages[2].figure["id"] == "b4"


def test_single_committed_page_rejects_late_figure():
    blocks = [{"type": "paragraph", "text": "wide", "id": "b0"},
              {"type": "mermaid", "source": "graph LR; A-->B", "id": "b1"}]
    col = {"b0": BlockHeight(600, 0, 10), "b1": BlockHeight(100, 0, 10)}
    single = {"b0": BlockHeight(300, 0, 10), "b1": BlockHeight(100, 0, 10)}
    pages = paginate(blocks, ctx(blocks, capacity=500, columns="split", col_heights=col, single_heights=single))
    assert pages[0].figure is None and pages[0].single_committed
    assert pages[1].figure["id"] == "b1"


def test_spill_keeps_page_ids_and_adds_suffix():
    page = {"id": "p05", "kind": "content", "title": "T", "continued": False,
            "blocks": [{"type": "paragraph", "text": "a", "id": "p05-b0"}, {"type": "paragraph", "text": "b", "id": "p05-b1"}]}
    heights = {"p05-b0": BlockHeight(300, 0, 10), "p05-b1": BlockHeight(300, 0, 10)}
    new_pages, spills = spill_pages([page], lambda cols: ctx([], capacity=400, single_heights=heights), lambda p: "single")
    assert [p["id"] for p in new_pages] == ["p05", "p05-2"]
    assert new_pages[1]["continued"] is True and new_pages[1]["title"] == "T"
    assert spills[0].source == "p05" and spills[0].target == "p05-2"


def test_reflow_merges_continued_tables():
    pages = [{"id": "p1", "kind": "content", "title": None, "continued": False,
              "blocks": [{"type": "table", "header": ["h"], "rows": [["1"]]}]},
             {"id": "p2", "kind": "content", "title": None, "continued": False,
              "blocks": [{"type": "table", "header": ["h"], "rows": [["2"]], "continued": True}]}]
    flat = flatten_for_reflow(pages)
    assert len(flat) == 1 and flat[0]["rows"] == [["1"], ["2"]]
