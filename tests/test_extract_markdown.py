"""Migration tool: extract the embedded Markdown from current and pre-1 containers."""

import json
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import extract_markdown as em  # noqa: E402
from md2html.content import envelope_script, make_envelope, make_source_page  # noqa: E402

MD = "# T\n\n<script>alert(1)</script>\n\nbody\n"


def content_doc():
    return {"version": 1, "meta": {"title": "T", "date": None, "source": None},
            "pages": [make_source_page(MD), {"id": "p01", "kind": "content", "title": None, "continued": False,
                                             "blocks": [{"type": "paragraph", "text": "x"}]}]}


def test_gospelo_html_and_json():
    env = make_envelope(content_doc(), {"page": "a4"})
    html = "<!DOCTYPE html>\n<html><head>" + envelope_script(env) + "</head><body></body></html>"
    assert em.extract(html) == (MD, "gospelo-document (html)")
    assert em.extract(json.dumps(env)) == (MD, "gospelo-document (json)")


def test_pre1_html_and_content_json():
    old_html = ('<html><body><script type="text/markdown" id="page-0" data-source="a.md">\n'
                + MD.replace("</script", "<\\/script") + "\n</script></body></html>")
    md, kind = em.extract(old_html)
    assert md == MD and kind.startswith("pre-1 md2html HTML")
    md, kind = em.extract(json.dumps(content_doc()))
    assert md == MD and kind == "pre-1 content JSON"


def test_unknown_input_is_an_error(tmp_path):
    with pytest.raises(em.ExtractError):
        em.extract("<html><body>nothing</body></html>")
    out = tmp_path / "x.md"
    src = tmp_path / "doc.gospelo.json"
    src.write_text(json.dumps(make_envelope(content_doc(), {})), encoding="utf-8")
    assert em.main([str(src), "-o", str(out)]) == 0
    assert out.read_text(encoding="utf-8") == MD
