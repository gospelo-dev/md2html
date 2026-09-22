"""Exception hierarchy. Everything the engine raises on purpose derives from KumihanError."""

from __future__ import annotations


class KumihanError(Exception):
    """Base class for engine errors."""


class FontError(KumihanError):
    """A font file could not be read, or lacks what the engine needs."""


class FitError(KumihanError):
    """The text does not fit the width under the given Fit strategy.

    Carries the enumerated candidates and warnings so an adapter (or an AI
    rewrite step) can act on them.
    """

    def __init__(self, message: str, candidates: list | None = None, warnings: list[str] | None = None):
        super().__init__(message)
        self.candidates = candidates or []
        self.warnings = warnings or []


class LintError(KumihanError):
    """A lint check classed as an error failed (overflow, kinsoku, contrast)."""


class DecisionMismatch(KumihanError):
    """replay() was given a decision whose font, engine or text does not match."""
