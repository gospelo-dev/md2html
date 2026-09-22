"""kumihan: a deterministic typesetting engine for short Japanese / Latin text.

Text + Style + width -> glyph positions -> SVG outlines. The engine knows
nothing about md2html (paper sizes, F, Markdown); adapters translate their
context into Block / Fit / FontSet and call Typesetter.layout().

Numbers are fractions.Fraction until the placing stage rounds them once to
integer font units. The same input yields the same bytes. AI, if any, only
picks among enumerated candidates; the engine completes without it.

Depends on uharfbuzz, fonttools[woff] and budoux. resvg_py is optional (PNG).
"""

from __future__ import annotations

from .errors import DecisionMismatch, FitError, FontError, KumihanError, LintError
from .font import Axis, Bounds, FontFace, VerticalMetrics
from .kinsoku import Kinsoku, feasible
from .normalize import Normalized, normalize
from .segment import BudouXSegmenter, EveryCharSegmenter, NoBreakSegmenter, Segmenter, candidate_breaks
from .shape import Shaped, ShapedGlyph, shape, split_runs

# Recorded in every Decision as engine "kumihan/<version>". Bump when rules,
# rounding or output formatting change so cached decisions are redone.
__version__ = "0.1.0"

__all__ = [
    "Axis",
    "Bounds",
    "BudouXSegmenter",
    "DecisionMismatch",
    "EveryCharSegmenter",
    "FitError",
    "FontError",
    "FontFace",
    "Kinsoku",
    "KumihanError",
    "LintError",
    "NoBreakSegmenter",
    "Normalized",
    "Segmenter",
    "Shaped",
    "ShapedGlyph",
    "VerticalMetrics",
    "__version__",
    "candidate_breaks",
    "feasible",
    "normalize",
    "shape",
    "split_runs",
]
