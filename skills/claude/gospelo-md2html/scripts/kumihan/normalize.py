"""Stage 1, normalisation: NFC, one space for runs of ASCII whitespace, and the
manual break marks U+200B (break allowed) / U+2060 (break forbidden) lifted out
of the string into position sets.

Content is never changed beyond that: full-width alphanumerics stay full-width
unless ``ascii_fold`` is requested, trailing punctuation stays, case stays.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

BREAK_ALLOWED = "​"    # zero width space
BREAK_FORBIDDEN = "⁠"  # word joiner

_ASCII_WS = re.compile(r"[ \t\r\n\f\v]+")
_FULL_WIDTH_ALNUM = {chr(c): chr(c - 0xFEE0) for c in range(0xFF10, 0xFF5B)
                     if chr(c - 0xFEE0).isalnum()}


@dataclass(frozen=True)
class Normalized:
    text: str
    allow: frozenset[int] = field(default_factory=frozenset)    # positions where a break is requested
    forbid: frozenset[int] = field(default_factory=frozenset)   # positions where a break is refused
    options: dict = field(default_factory=dict)


def normalize(text: str, *, ascii_fold: bool = False) -> Normalized:
    """Normalise ``text`` and extract manual break marks.

    Positions in ``allow`` / ``forbid`` index the returned text: a mark between
    text[i-1] and text[i] is recorded as i. Marks at either end are dropped.
    """
    s = unicodedata.normalize("NFC", text)
    s = _ASCII_WS.sub(" ", s).strip()
    if ascii_fold:
        s = "".join(_FULL_WIDTH_ALNUM.get(ch, ch) for ch in s)
    out: list[str] = []
    allow: set[int] = set()
    forbid: set[int] = set()
    for ch in s:
        if ch == BREAK_ALLOWED:
            allow.add(len(out))
        elif ch == BREAK_FORBIDDEN:
            forbid.add(len(out))
        else:
            out.append(ch)
    clean = "".join(out)
    inside = range(1, len(clean))
    return Normalized(
        text=clean,
        allow=frozenset(i for i in allow if i in inside),
        forbid=frozenset(i for i in forbid if i in inside),
        options={"asciiFold": ascii_fold},
    )
