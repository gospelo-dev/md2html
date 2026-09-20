"""Per-version Mermaid vendoring, license notice, and version pinning in the layout."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"))

from md2html import assets  # noqa: E402
from md2html.layout import Layout, LayoutError, build_layout, layout_to_dict  # noqa: E402


def test_vendored_versions_are_discovered_and_newest_is_default():
    versions = assets.mermaid_versions()
    assert "11.12.2" in versions
    assert assets.default_mermaid_version() == versions[-1]
    assert assets.resolve_mermaid_version(None) == versions[-1]
    assert assets.resolve_mermaid_version("11.12.2") == "11.12.2"
    for v in versions:
        assert assets.mermaid_license(v).is_file(), f"LICENSE.txt missing for Mermaid {v}"


def test_unknown_version_is_an_error():
    with pytest.raises(assets.AssetError, match="not vendored"):
        assets.resolve_mermaid_version("0.0.1")


def test_embed_tag_carries_notice_and_version():
    tag = assets.mermaid_script_tag("embed", None, "11.12.2")
    head = tag[:1500]
    assert head.startswith("<!--")
    assert "Mermaid 11.12.2 | MIT License" in head
    assert "Knut Sveidqvist" in head
    assert "Permission is hereby granted" in head
    assert '<script data-mermaid-version="11.12.2">' in tag
    assert 'version:"11.12.2"' in tag  # the bundle itself


def test_link_mode_writes_versioned_bundle_and_license(tmp_path):
    tag = assets.mermaid_script_tag("link", tmp_path, "11.12.2")
    assert '<script src="mermaid-11.12.2.min.js" data-mermaid-version="11.12.2"></script>' in tag
    assert "MIT License" in tag
    assert (tmp_path / "mermaid-11.12.2.min.js").is_file()
    assert "Knut Sveidqvist" in (tmp_path / "LICENSE.mermaid-11.12.2.txt").read_text(encoding="utf-8")


def test_layout_round_trips_and_validates_mermaid_version():
    layout = Layout(mermaid_version="11.12.2")
    embedded = layout_to_dict(layout)
    assert embedded["mermaidVersion"] == "11.12.2"
    merged = build_layout(None, {"mermaid_version": None}, base=embedded)
    assert merged.mermaid_version == "11.12.2"
    overridden = build_layout(None, {"mermaid_version": "12.0.0"}, base=embedded)
    assert overridden.mermaid_version == "12.0.0"  # syntactically valid; vendoring is checked at render time
    with pytest.raises(LayoutError):
        build_layout(None, {"mermaid_version": "latest"})
