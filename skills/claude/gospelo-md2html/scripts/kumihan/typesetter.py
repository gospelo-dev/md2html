"""Typesetter: the top-level API that runs the full pipeline.

    ts = Typesetter(face)
    layout = ts.layout("text", width_em, rules, line_height, fit)
    svg = emit_svg(layout)   # K07

    # replay from a saved decision
    layout2 = ts.replay(layout.decision)
    assert layout2.decision.to_json() == layout.decision.to_json()
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from .decision import Decision, _version, collect_versions, text_hash
from .errors import DecisionMismatch
from .fit import Fit, FitResult, try_fit
from .font import FontFace
from .kinsoku import Kinsoku, feasible
from .linebreak import BreakResult, Chooser
from .normalize import normalize
from .place import Placement, place
from .segment import BudouXSegmenter, Segmenter, candidate_breaks
from .shape import shape
from .space import SpacingRules, Spaced, apply_spacing, ZERO


@dataclass(frozen=True)
class Layout:
    text: str
    placement: Placement
    spaced: Spaced
    fit_result: FitResult
    decision: Decision


class Typesetter:
    def __init__(
        self,
        face: FontFace,
        segmenter: Segmenter | None = None,
        kinsoku: Kinsoku | None = None,
    ):
        self.face = face
        self.segmenter = segmenter or BudouXSegmenter()
        self.kinsoku = kinsoku or Kinsoku.default()

    def layout(
        self,
        text: str,
        width_em: Fraction,
        rules: SpacingRules | None = None,
        line_height: Fraction = Fraction(13, 10),
        fit: Fit | None = None,
        tracking: Fraction = ZERO,
        features: dict[str, bool] | None = None,
        chooser: Chooser | None = None,
    ) -> Layout:
        if rules is None:
            rules = SpacingRules.heading()
        if fit is None:
            fit = Fit.wrap_shrink()

        norm = normalize(text)
        candidates = candidate_breaks(norm, self.segmenter)
        feas = feasible(norm.text, candidates, self.kinsoku)
        shaped = shape(self.face, norm.text, features)
        spaced = apply_spacing(shaped, rules, tracking)
        fit_result = try_fit(spaced, width_em, feas, fit, chooser)
        placement = place(fit_result, width_em, line_height)

        chosen = fit_result.breaks.candidates[fit_result.breaks.chosen]
        decision = Decision(
            engine=f"kumihan/{_version()}",
            text=norm.text,
            text_hash=text_hash(norm.text),
            font=self.face.describe(),
            segmenter=self.segmenter.describe(),
            params={
                "spacing": rules.describe(),
                "lineHeight": float(line_height),
                "tracking": float(tracking),
                "fit": fit.describe(),
            },
            lines=chosen.lines,
            scale=float(fit_result.scale),
            warnings=fit_result.warnings,
            versions=collect_versions(),
            kinsoku=self.kinsoku.describe(),
        )
        return Layout(
            text=norm.text,
            placement=placement,
            spaced=spaced,
            fit_result=fit_result,
            decision=decision,
        )

    def replay(self, decision: Decision) -> Layout:
        decision.verify(self.face.sha256)
        text = decision.text
        rules_d = decision.params.get("spacing", {})
        rules = SpacingRules(
            g_max_kana=Fraction(rules_d["gMaxKana"]).limit_denominator(10000),
            g_min=Fraction(rules_d["gMin"]).limit_denominator(10000),
            a_je=Fraction(rules_d["aJE"]).limit_denominator(10000),
            punct_run=Fraction(rules_d["punctRun"]).limit_denominator(10000),
            trim_start=rules_d["trimStart"],
            trim_end=rules_d["trimEnd"],
        )
        line_height = Fraction(decision.params["lineHeight"]).limit_denominator(10000)
        tracking = Fraction(decision.params["tracking"]).limit_denominator(10000)
        features_d = decision.params.get("features")
        features = dict(features_d) if features_d else None

        shaped = shape(self.face, text, features)
        spaced = apply_spacing(shaped, rules, tracking)

        lines = decision.lines
        scale = Fraction(decision.scale).limit_denominator(100000)
        from .linebreak import BreakCandidate, BreakResult, line_ink_width
        widths = tuple(line_ink_width(spaced, s, e) for s, e in lines)
        cand = BreakCandidate(
            positions=tuple(lines[i][0] for i in range(1, len(lines))),
            lines=lines,
            widths=widths,
            score=ZERO,
        )
        breaks = BreakResult(chosen=0, candidates=(cand,), num_lines=len(lines))
        fit_result = FitResult(spaced, breaks, scale, tuple(decision.warnings))

        width_em = Fraction(self.face.upm) * Fraction(1) / Fraction(1)
        if decision.params.get("fit", {}).get("strategy") != "none":
            width_em = Fraction(10**9)
        placement = place(fit_result, width_em, line_height)

        new_decision = Decision(
            engine=decision.engine,
            text=text,
            text_hash=decision.text_hash,
            font=self.face.describe(),
            segmenter=self.segmenter.describe(),
            params=decision.params,
            lines=decision.lines,
            scale=decision.scale,
            warnings=decision.warnings,
            versions=collect_versions(),
            kinsoku=decision.kinsoku,
        )
        return Layout(
            text=text,
            placement=placement,
            spaced=spaced,
            fit_result=fit_result,
            decision=new_decision,
        )
