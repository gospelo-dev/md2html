"""Stage 2, segmentation: where the text may be broken into lines.

A Segmenter returns candidate positions (i means "between text[i-1] and
text[i]"). The default is BudouX's bundled Japanese model; its version and the
model file's sha256 go into the decision because a model update can move the
boundaries. Manual marks from normalisation override the model: ``allow``
adds positions, ``forbid`` removes them (forbid wins at the same index).
Kinsoku is applied afterwards (kinsoku.py), also to manual positions.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from .errors import KumihanError
from .normalize import Normalized


@runtime_checkable
class Segmenter(Protocol):
    name: str

    def boundaries(self, text: str) -> frozenset[int]:
        """Positions 0 < i < len(text) where a line may start."""
        ...

    def describe(self) -> dict[str, Any]:
        """JSON-ready identity (name, version, model hash) for the decision record."""
        ...


@dataclass(frozen=True)
class NoBreakSegmenter:
    """Never breaks. For labels and single-line headers (ellipsis fits)."""

    name: str = "nobreak"

    def boundaries(self, text: str) -> frozenset[int]:
        return frozenset()

    def describe(self) -> dict[str, Any]:
        return {"name": self.name}


@dataclass(frozen=True)
class EveryCharSegmenter:
    """Every position is a candidate; kinsoku alone decides. A fallback, not a default."""

    name: str = "everychar"

    def boundaries(self, text: str) -> frozenset[int]:
        return frozenset(range(1, len(text)))

    def describe(self) -> dict[str, Any]:
        return {"name": self.name}


class BudouXSegmenter:
    """Phrase boundaries from BudouX. ``model`` is a path to a model JSON; None uses
    the bundled Japanese model."""

    name = "budoux"

    def __init__(self, model: str | Path | None = None):
        import budoux  # local import: optional for adapters that bring their own Segmenter

        self.version: str = budoux.__version__
        if model is None:
            self.model_path = Path(budoux.__file__).parent / "models" / "ja.json"
            self.model_name = "ja"
            self._parser = budoux.load_default_japanese_parser()
        else:
            self.model_path = Path(model)
            self.model_name = self.model_path.stem
            import json
            self._parser = budoux.Parser(json.loads(self.model_path.read_text(encoding="utf-8")))
        self.model_sha256: str = hashlib.sha256(self.model_path.read_bytes()).hexdigest()

    def phrases(self, text: str) -> list[str]:
        if not text:
            return []
        parts = self._parser.parse(text)
        if "".join(parts) != text:
            raise KumihanError("BudouX altered the text while segmenting; refusing to guess boundaries")
        return parts

    def boundaries(self, text: str) -> frozenset[int]:
        out: set[int] = set()
        pos = 0
        for part in self.phrases(text)[:-1]:
            pos += len(part)
            out.add(pos)
        return frozenset(i for i in out if 0 < i < len(text))

    def describe(self) -> dict[str, Any]:
        return {"name": self.name, "version": self.version, "model": self.model_name, "sha256": self.model_sha256}


def candidate_breaks(normalized: Normalized, segmenter: Segmenter) -> frozenset[int]:
    """Segmenter boundaries with the manual marks applied (allow adds, forbid removes)."""
    text = normalized.text
    found = set(segmenter.boundaries(text)) | set(normalized.allow)
    found -= set(normalized.forbid)
    return frozenset(i for i in found if 0 < i < len(text))
