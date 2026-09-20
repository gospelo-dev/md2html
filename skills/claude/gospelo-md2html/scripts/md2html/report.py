"""Report output: stdout summary and --report JSON (docs/07 section 5.4)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .scale import Metrics


def build_report(metrics: Metrics, columns: str, verify: list[dict[str, Any]],
                 spills: list[dict[str, Any]], warnings: list[str], notes: dict[str, Any] | None = None) -> dict[str, Any]:
    pages = []
    for p in verify:
        entry = {
            "id": p["id"],
            "layoutMode": p["mode"],
            "usedPx": p["usedPx"],
            "remainingPx": max(0, p["contentHeightPx"] - p["usedPx"]),
            "remainingLines": int(max(0, p["contentHeightPx"] - p["usedPx"]) // metrics.line_px),
            "overflowPx": p["overflowPx"],
            "figure": p.get("figure"),
            "blocks": p["blocks"],
            "warnings": [],
        }
        if p.get("titleTruncated"):
            entry["warnings"].append("header title truncated")
        if p.get("figureOverflowPx"):
            entry["warnings"].append(f"figure column overflows by {p['figureOverflowPx']}px")
        fig = p.get("figure")
        if fig and fig.get("scale") is not None and fig["scale"] < 0.5:
            entry["warnings"].append(f"figure {fig['id']} scaled to {fig['scale']:.2f}; text may be too small")
        for b in p["blocks"]:
            if b.get("scale") is not None and b["scale"] < 0.5:
                entry["warnings"].append(f"figure {b['id']} scaled to {b['scale']:.2f}; text may be too small")
        pages.append(entry)
    report = {
        "layout": {
            "page": metrics.fmt.id,
            "fontSizePx": round(metrics.F, 2),
            "columns": columns,
            "contentHeightPx": round(metrics.content_h_px),
            "contentWidthPx": round(metrics.content_w_px),
            "textColumnWidthPx": round(metrics.text_col_px) if columns == "split" else round(metrics.content_w_px),
            "lineHeightPx": round(metrics.line_px, 2),
        },
        "pageCount": len(pages),
        "pages": pages,
        "spills": spills,
        "warnings": warnings,
    }
    if notes:
        report["import"] = notes
    return report


def write_report(report: dict[str, Any], path: Path) -> None:
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def print_summary(report: dict[str, Any], label: str) -> None:
    lay = report["layout"]
    print(f"[{label}] {lay['page']} font {lay['fontSizePx']}px columns={lay['columns']} pages={report['pageCount']}")
    for p in report["pages"]:
        line = f"  {p['id']:<8} {p['layoutMode']:<12} used {p['usedPx']:>5}px  remaining {p['remainingPx']:>5}px ({p['remainingLines']} lines)"
        if p["overflowPx"]:
            line += f"  OVERFLOW {p['overflowPx']}px"
        print(line)
        for w in p["warnings"]:
            print(f"           warning: {w}")
    for s in report["spills"]:
        print(f"  spill: {s['from']} -> {s['to']} blocks={','.join(s['blocks'])}")
    for w in report["warnings"]:
        print(f"  warning: {w}")
    imp = report.get("import")
    if imp:
        for k, v in imp.items():
            if v:
                print(f"  import {k}: {v}")
