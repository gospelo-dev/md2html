"""K01: FontFace reads the vendored BIZ UDPGothic Bold and exposes the values
measured in 07_measurements.md."""

import hashlib
import re
from fractions import Fraction
from pathlib import Path

import pytest
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

from conftest import BIZUD_BOLD, BIZUD_REGULAR

import kumihan
from kumihan import Bounds, FontError, FontFace


def em(face: FontFace, units: int) -> float:
    return round(units / face.upm, 3)


def test_package_exposes_version_and_errors():
    assert kumihan.__version__ == "0.1.0"
    assert issubclass(kumihan.FontError, kumihan.KumihanError)
    assert issubclass(kumihan.FitError, kumihan.KumihanError)
    assert issubclass(kumihan.DecisionMismatch, kumihan.KumihanError)


def test_engine_does_not_import_md2html():
    package = Path(kumihan.__file__).parent
    for src in package.rglob("*.py"):
        depth = len(src.relative_to(package).parts) - 1
        for line in src.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            assert not re.match(r"(from|import)\s+md2html\b", stripped), f"{src.name}: {stripped}"
            m = re.match(r"from\s+(\.+)", stripped)
            if m:
                dots = len(m.group(1))
                assert dots <= depth + 1, f"{src.name} escapes package: {stripped}"


def test_load_identity_and_metrics(bold_face: FontFace):
    f = bold_face
    assert f.path.name == "BIZUDPGothic-Bold.woff2" and f.index == 0
    assert f.sha256 == hashlib.sha256(BIZUD_BOLD.read_bytes()).hexdigest()
    assert f.upm == 2048 and f.glyph_count == 13932
    assert f.family == "BIZ UDPGothic" and f.weight == 700
    m = f.metrics
    assert (m.ascent, m.descent, m.line_gap) == (1802, -246, 0)
    assert (m.typo_ascender, m.typo_descender, m.typo_line_gap) == (1802, -246, 0)
    assert (m.win_ascent, m.win_descent) == (1802, 246)
    assert (m.x_height, m.cap_height) == (1108, 1567)
    assert f.ascent_norm == Fraction(1802, 2048)


def test_bizud_has_no_gpos_and_gsub_features(bold_face: FontFace):
    assert bold_face.features["GPOS"] == frozenset()
    assert not bold_face.has_feature("palt") and not bold_face.has_feature("kern")
    assert {"liga", "dlig", "vert", "fwid", "hwid"} <= bold_face.features["GSUB"]
    assert bold_face.has_feature("liga", "GSUB") and not bold_face.has_feature("liga", "GPOS")
    assert bold_face.axes == {} and bold_face.variations == {}


def test_sfnt_bytes_open_in_harfbuzz(bold_face: FontFace):
    assert bold_face.sfnt_bytes[:4] == b"\x00\x01\x00\x00"
    assert bold_face.hb_face.upem == 2048
    font = bold_face.hb_font()
    assert font.scale == (2048, 2048)
    buf = hb.Buffer()
    buf.add_str("国")
    buf.script, buf.language, buf.direction = "Hani", "ja", "ltr"
    hb.shape(font, buf, {})
    assert buf.glyph_positions[0].x_advance == 2048
    assert buf.glyph_infos[0].codepoint == bold_face.gid("国")


def test_ink_bounds_match_measurements(bold_face: FontFace):
    f = bold_face
    kuni = f.ink(f.gid("国"))
    assert [em(f, v) for v in kuni] == [0.062, -0.095, 0.938, 0.809]
    h = f.ink(f.gid("H"))
    assert [em(f, v) for v in h] == [0.091, -0.025, 0.749, 0.785]
    assert em(f, f.advance(f.gid("H"))) == 0.840
    assert em(f, f.advance(f.gid("、"))) == 0.600
    su = f.ink(f.gid("す"))
    assert em(f, f.advance(f.gid("す"))) == 0.970 and em(f, su.xmin) == 0.050
    assert all(isinstance(v, int) for v in kuni)


def test_space_glyph_is_empty(bold_face: FontFace):
    space = bold_face.gid(" ")
    assert space is not None
    assert bold_face.ink(space) == Bounds(0, 0, 0, 0) and bold_face.ink(space).is_empty
    assert bold_face.outline(space) == ""


def test_glyph_caches_are_per_gid(bold_face: FontFace):
    gid = bold_face.gid("生")
    assert bold_face.ink(gid) is bold_face.ink(gid)
    assert bold_face._recording(gid) is bold_face._recording(gid)
    assert bold_face.outline(gid) == bold_face.outline(gid)
    assert bold_face.gid("\U0001F600") is None  # emoji not in BIZ UD


def test_outline_is_integer_path_data_and_replays_through_pens(bold_face: FontFace):
    gid = bold_face.gid("生")
    d = bold_face.outline(gid)
    assert d.startswith("M") and d.endswith("Z") and "." not in d
    pen = SVGPathPen(None, ntos=lambda v: str(round(v)))
    bold_face.draw(gid, TransformPen(pen, (1, 0, 0, -1, 100, 200)))
    flipped = pen.getCommands()
    assert flipped != d and "." not in flipped
    assert flipped.count("M") == d.count("M")  # same contours, only moved and mirrored
    bounds = bold_face.ink(gid)
    assert bounds.width > 0 and bounds.height > 0


def test_describe_is_json_ready_without_paths(bold_face: FontFace):
    import json
    d = bold_face.describe()
    assert d["file"] == "BIZUDPGothic-Bold.woff2" and "/" not in d["file"]
    assert d["features"]["GPOS"] == [] and "liga" in d["features"]["GSUB"]
    assert json.dumps(d, sort_keys=True, separators=(",", ":")) == json.dumps(FontFace.load(BIZUD_BOLD).describe(), sort_keys=True, separators=(",", ":"))


def test_regular_face_shares_metrics_and_differs_in_weight():
    r = FontFace.load(BIZUD_REGULAR)
    assert r.weight == 400 and r.metrics.ascent == 1802 and r.features["GPOS"] == frozenset()


def test_load_errors(tmp_path):
    with pytest.raises(FontError):
        FontFace.load(tmp_path / "missing.ttf")
    bad = tmp_path / "bad.ttf"
    bad.write_bytes(b"not a font")
    with pytest.raises(FontError):
        FontFace.load(bad)
    with pytest.raises(FontError):
        FontFace.load(BIZUD_BOLD, variations={"wght": 700})  # BIZ UD is not variable
    with pytest.raises(FontError):
        FontFace.load(BIZUD_BOLD).glyph_name(999_999)
