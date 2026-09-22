"""Shared fixtures for the kumihan engine tests. The engine lives in the skill's
scripts/ directory next to md2html but must not import from it."""

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent.parent / "skills" / "claude" / "gospelo-md2html" / "scripts"
FONT_DIR = SCRIPTS.parent / "references" / "vendor" / "fonts" / "bizud"
BIZUD_BOLD = FONT_DIR / "BIZUDPGothic-Bold.woff2"
BIZUD_REGULAR = FONT_DIR / "BIZUDPGothic-Regular.woff2"

sys.path.insert(0, str(SCRIPTS))


@pytest.fixture(scope="session")
def bold_face():
    from kumihan import FontFace
    return FontFace.load(BIZUD_BOLD)
