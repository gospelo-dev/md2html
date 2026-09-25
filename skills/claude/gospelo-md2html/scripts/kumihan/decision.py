"""Decision: a JSON-serialisable record of every choice the pipeline made.

Replay feeds the recorded break positions and scale back into the pipeline
so the same Layout comes out without re-running the chooser. Font sha256
and engine version mismatches raise DecisionMismatch.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from .errors import DecisionMismatch

def _version() -> str:
    from . import __version__
    return __version__


@dataclass(frozen=True)
class Decision:
    engine: str
    text: str
    text_hash: str
    font: dict[str, Any]
    segmenter: dict[str, Any]
    params: dict[str, Any]
    lines: tuple[tuple[int, int], ...]
    scale: float
    warnings: tuple[str, ...]
    versions: dict[str, str]
    kinsoku: dict[str, Any] = field(default_factory=dict)
    ai: dict[str, Any] | None = None

    def to_json(self) -> str:
        d: dict[str, Any] = {
            "ai": self.ai,
            "engine": self.engine,
            "font": self.font,
            "kinsoku": self.kinsoku,
            "lines": [list(r) for r in self.lines],
            "params": self.params,
            "scale": self.scale,
            "segmenter": self.segmenter,
            "text": self.text,
            "textHash": self.text_hash,
            "versions": self.versions,
            "warnings": list(self.warnings),
        }
        return json.dumps(d, sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_json(cls, s: str) -> Decision:
        d = json.loads(s)
        return cls(
            engine=d["engine"],
            text=d["text"],
            text_hash=d["textHash"],
            font=d["font"],
            segmenter=d.get("segmenter", {}),
            params=d.get("params", {}),
            lines=tuple(tuple(r) for r in d["lines"]),
            scale=d["scale"],
            warnings=tuple(d.get("warnings", [])),
            versions=d.get("versions", {}),
            kinsoku=d.get("kinsoku", {}),
            ai=d.get("ai"),
        )

    def verify(self, face_sha256: str) -> None:
        if self.engine != f"kumihan/{_version()}":
            raise DecisionMismatch(
                f"engine mismatch: decision has {self.engine}, "
                f"current is kumihan/{_version()}")
        if self.font.get("sha256") != face_sha256:
            raise DecisionMismatch(
                f"font sha256 mismatch: decision has {self.font.get('sha256')}, "
                f"current is {face_sha256}")


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def collect_versions() -> dict[str, str]:
    import sys
    vs: dict[str, str] = {"python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"}
    try:
        import uharfbuzz as hb
        vs["uharfbuzz"] = hb.version_string()
    except ImportError:
        pass
    try:
        import fontTools
        vs["fonttools"] = fontTools.version
    except (ImportError, AttributeError):
        pass
    try:
        import budoux
        vs["budoux"] = budoux.__version__
    except ImportError:
        pass
    return vs
