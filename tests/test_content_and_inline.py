"""Content JSON validation, page-0 restore, inline splitting and Markdown import."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html import blocks as blocks_mod  # noqa: E402
from md2html.content import (  # noqa: E402
    ContentError, envelope_script, extract_from_html, get_source_markdown, make_envelope, make_source_page, validate_content,
)
from md2html.inline import plain_text, split_inline  # noqa: E402
from md2html.render import render_block  # noqa: E402
from md2html.scale import parse_font_size  # noqa: E402


def doc(pages):
    return {"version": 1, "meta": {"title": "T", "date": None, "source": None}, "pages": pages}


def page(**kw):
    base = {"id": "p01", "kind": "content", "title": None, "continued": False, "blocks": []}
    base.update(kw)
    return base


def test_valid_minimal_document():
    validate_content(doc([page(blocks=[{"type": "paragraph", "text": "hi"}])]))


def test_unknown_block_type_is_rejected():
    with pytest.raises(ContentError):
        validate_content(doc([page(blocks=[{"type": "widget"}])]))


def test_table_row_length_must_match_header():
    with pytest.raises(ContentError):
        validate_content(doc([page(blocks=[{"type": "table", "header": ["a", "b"], "rows": [["1"]]}])]))


def test_markdown_block_only_on_source_page():
    with pytest.raises(ContentError):
        validate_content(doc([page(blocks=[{"type": "markdown", "text": "x"}])]))
    validate_content(doc([make_source_page("# x"), page(id="p02", blocks=[{"type": "paragraph", "text": "y"}])]))


def test_source_page_must_be_first():
    with pytest.raises(ContentError):
        validate_content(doc([page(blocks=[{"type": "paragraph", "text": "y"}]), dict(make_source_page("# x"), id="p99")]))


def test_restore_round_trip_through_html():
    md = "# Title\n\n<script>alert(1)</script>\n\nbody"
    d = doc([make_source_page(md), page(id="p02", blocks=[{"type": "paragraph", "text": "y"}])])
    html = "<html><head>" + envelope_script(make_envelope(d, {"page": "a4"})) + "</head><body></body></html>"
    got, layout = extract_from_html(html)
    assert get_source_markdown(got) == md and layout == {"page": "a4"}


def test_font_size_units():
    assert abs(parse_font_size("11pt") - 14.6667) < 0.01
    assert parse_font_size("14px") == 14
    with pytest.raises(ValueError):
        parse_font_size("large")


def test_split_inline_keeps_formatting():
    text = "This is **bold text** and `code` here"
    plain = plain_text(text)
    idx = plain.index("text")
    head, tail = split_inline(text, idx)
    assert head == "This is **bold**"
    assert tail == "**text** and `code` here"


def test_split_inline_never_cuts_inside_code():
    text = "abc `def ghi` jkl"
    head, tail = split_inline(text, 6)
    assert head == "abc" and tail.startswith("`def ghi`")


def test_import_rescues_mermaid_from_details_and_drops_png():
    md = ("# Doc\n\n![diagram](images/x.png)\n\n<details><summary>Mermaid source</summary>\n\n"
          "```mermaid\ngraph LR\n  A --> B\n```\n\n</details>\n\n<details><summary>Other</summary>\n\nhidden\n\n</details>\n\ntext\n")
    notes = blocks_mod.ImportNotes()
    text = blocks_mod.preprocess_markdown(md, "drop", notes)
    blocks = blocks_mod.parse_blocks(text, False, notes)
    types = [b["type"] for b in blocks]
    assert types == ["heading", "mermaid", "paragraph"]
    assert blocks[1]["source"] == "graph LR\n  A --> B"
    assert notes.rescued_mermaid == 1 and notes.discarded_images == ["images/x.png"] and notes.dropped_details == ["hidden"]


def test_import_tables_lists_and_pagebreak():
    md = ("| a | b |\n| --- | ---: |\n| 1 | 2 |\n\n- x\n  - y\n- z\n\n<!-- pagebreak -->\n\n1. one\n2. two\n")
    notes = blocks_mod.ImportNotes()
    blocks = blocks_mod.parse_blocks(md, False, notes)
    assert blocks[0] == {"type": "table", "header": ["a", "b"], "rows": [["1", "2"]], "align": ["left", "right"]}
    assert blocks[1] == {"type": "list", "ordered": False, "items": [{"text": "x", "children": [{"text": "y"}]}, {"text": "z"}]}
    assert blocks[2] == {"type": "pagebreak"}
    assert blocks[3]["ordered"] is True and [i["text"] for i in blocks[3]["items"]] == ["one", "two"]


def test_code_block_in_a_list_item_ends_the_list_there():
    # numbered steps with a command under a step: the command used to be dropped and the paragraph
    # after it was joined to the step's text
    md = ("1. first\n\n   ```bash\n   git fetch origin\n   git pull\n   ```\n\n   after the code\n\n"
          "2. second\n3. third\n")
    notes = blocks_mod.ImportNotes()
    blocks = blocks_mod.parse_blocks(md, False, notes)
    assert blocks == [
        {"type": "list", "ordered": True, "items": [{"text": "first"}]},
        {"type": "code", "lang": "bash", "lines": ["git fetch origin", "git pull"]},
        {"type": "paragraph", "text": "after the code"},
        {"type": "list", "ordered": True, "items": [{"text": "second"}, {"text": "third"}], "start": 2},
    ]
    assert notes.dropped_list_blocks == []


def test_content_after_a_code_block_in_an_item_keeps_its_own_kind():
    md = "6. step\n\n   ```bash\n   make gate\n   ```\n\n   - note a\n   - note b\n\n7. next\n"
    blocks = blocks_mod.parse_blocks(md, False, blocks_mod.ImportNotes())
    assert [b["type"] for b in blocks] == ["list", "code", "list", "list"]
    assert blocks[0] == {"type": "list", "ordered": True, "items": [{"text": "step"}], "start": 6}
    assert blocks[2] == {"type": "list", "ordered": False, "items": [{"text": "note a"}, {"text": "note b"}]}
    assert blocks[3]["start"] == 7


def test_ordered_list_keeps_its_start_number():
    blocks = blocks_mod.parse_blocks("3. three\n4. four\n", False, blocks_mod.ImportNotes())
    assert blocks == [{"type": "list", "ordered": True, "items": [{"text": "three"}, {"text": "four"}], "start": 3}]


def test_bullet_children_of_a_numbered_item_are_recorded():
    md = "1. step\n   - note\n2. step two\n   1. sub\n"
    blocks = blocks_mod.parse_blocks(md, False, blocks_mod.ImportNotes())
    items = blocks[0]["items"]
    # differs from the parent: recorded. Same as the parent: omitted
    assert items[0] == {"text": "step", "children": [{"text": "note"}], "childrenOrdered": False}
    assert items[1] == {"text": "step two", "children": [{"text": "sub"}]}


def test_code_block_in_a_nested_item_is_reported():
    md = "- top\n  - nested\n\n    ```\n    x\n    ```\n"
    notes = blocks_mod.ImportNotes()
    blocks = blocks_mod.parse_blocks(md, False, notes)
    assert blocks[0]["items"][0]["children"] == [{"text": "nested"}]
    assert notes.dropped_list_blocks == ["fence: x"]


def test_children_use_their_own_list_kind():
    item = {"text": "step", "children": [{"text": "note"}], "childrenOrdered": False}
    html = render_block({"type": "list", "ordered": True, "items": [item, {"text": "b", "children": [{"text": "c"}]}]},
                        None, "single")
    assert html.startswith("<ol ")
    assert html.endswith('><li data-item="0">step<ul><li>note</li></ul></li>'
                         '<li data-item="1">b<ol><li>c</li></ol></li></ol>')


def test_children_ordered_is_validated():
    def with_item(item):
        return doc([page(blocks=[{"type": "list", "ordered": True, "items": [item]}])])

    validate_content(with_item({"text": "a", "children": [{"text": "b"}], "childrenOrdered": False}))
    with pytest.raises(ContentError):
        validate_content(with_item({"text": "a", "childrenOrdered": False}))
    with pytest.raises(ContentError):
        validate_content(with_item({"text": "a", "children": [{"text": "b"}], "childrenOrdered": "no"}))
