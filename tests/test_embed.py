"""Gospelo Document envelope: embedding, escaping, head-only reading, and rejection of other files."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html.content import (  # noqa: E402
    DOC_SCRIPT_ID, HEAD_CHUNK, MIGRATION_URL, SIGNATURE, ContentError, default_html_path, embed_json,
    envelope_script, extract_from_html, load_document, make_envelope, make_source_page, read_head, save_document,
)
from md2html.layout import Layout, build_layout, layout_to_dict  # noqa: E402


def sample_doc():
    return {
        "version": 1,
        "meta": {"title": "T", "date": "2026-09-20", "source": "a.md", "lang": "ja"},
        "pages": [
            make_source_page("# T\n\n<script>x</script>\n"),
            {"id": "p01", "kind": "content", "title": None, "continued": False,
             "blocks": [{"type": "paragraph", "text": "a </script> b <b> & c"}], "extras": {"reviewed": True}},
        ],
    }


def wrap(env, filler=""):
    return ("<!DOCTYPE html>\n" + SIGNATURE + '\n<html data-gospelo-document="1"><head>\n' + envelope_script(env)
            + "\n<style>body{}</style></head><body>" + filler + "</body></html>")


def test_embed_escapes_markup_and_round_trips():
    doc = sample_doc()
    env = make_envelope(doc, {"page": "16x9"})
    text = embed_json(env)
    assert "</script" not in text and "<" not in text and ">" not in text and "&" not in text
    assert env["format"] == "gospelo-document" and env["version"] == 1 and env["generator"].startswith("gospelo-md2html")
    got, layout = extract_from_html(wrap(env))
    assert got["pages"] == doc["pages"] and got["meta"] == doc["meta"] and layout == {"page": "16x9"}


def test_layout_round_trip_and_cli_precedence():
    layout = Layout(page="16x9", font_size="14pt", overrides={"p05": {"columns": "single"}})
    env = make_envelope(sample_doc(), layout_to_dict(layout))
    _, got = extract_from_html(wrap(env))
    merged = build_layout(None, {"font_size": "12pt", "page": None}, base=got)
    assert merged.page == "16x9" and merged.font_size == "12pt"
    assert merged.overrides == {"p05": {"columns": "single"}}


def test_read_head_stops_before_the_tail(tmp_path):
    env = make_envelope(sample_doc(), {"page": "a4"})
    filler = "<!-- " + ("x" * (3 * HEAD_CHUNK)) + " -->"  # stands in for the Mermaid library
    path = tmp_path / "doc.gospelo.html"
    path.write_text(wrap(env, filler), encoding="utf-8")
    head = read_head(path)
    assert head.endswith("</script>") and len(head) < HEAD_CHUNK and "xxxx" not in head
    doc, layout = load_document(path)
    assert layout == {"page": "a4"} and doc["pages"][1]["blocks"][0]["id"] == "p01-b0"


def test_sidecar_json_round_trip(tmp_path):
    path = tmp_path / "doc.gospelo.json"
    save_document(sample_doc(), {"page": "a3"}, path)
    env = json.loads(path.read_text(encoding="utf-8"))
    assert env["format"] == "gospelo-document" and env["layout"] == {"page": "a3"}
    doc, layout = load_document(path)
    assert doc["meta"]["title"] == "T" and layout == {"page": "a3"}
    assert default_html_path(path).name == "doc.gospelo.html"
    assert default_html_path(tmp_path / "notes.md").name == "notes.gospelo.html"


def test_legacy_and_foreign_files_are_rejected_with_migration_url(tmp_path):
    legacy = tmp_path / "old.html"
    legacy.write_text('<!DOCTYPE html>\n<html lang="ja" data-mermaid-font-size="12.6px"><head></head><body>'
                      '<script type="application/json" id="md2html-content">{}</script></body></html>', encoding="utf-8")
    with pytest.raises(ContentError, match="earlier md2html release") as e:
        load_document(legacy)
    assert MIGRATION_URL in str(e.value)
    with pytest.raises(ContentError, match=MIGRATION_URL.replace(".", r"\.")):
        extract_from_html("<html><body>no envelope here</body></html>")
    bare = tmp_path / "content.json"
    bare.write_text(json.dumps(sample_doc()), encoding="utf-8")
    with pytest.raises(ContentError, match="not a Gospelo Document"):
        load_document(bare)


def test_unsupported_version_and_unknown_keys_are_rejected():
    env = make_envelope(sample_doc(), {})
    env["version"] = 2
    with pytest.raises(ContentError, match="unsupported"):
        extract_from_html(wrap(env))
    env = make_envelope(sample_doc(), {})
    env["pages"][1]["mystery"] = 1
    with pytest.raises(ContentError, match="unknown key"):
        extract_from_html(wrap(env))
    assert DOC_SCRIPT_ID == "gospelo-document"
