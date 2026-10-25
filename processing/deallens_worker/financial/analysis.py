"""Pure analysis core shared by the worker and tests: dataset → metrics, reconciliations, quality issues, red flags."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from ..validation import quality, reconciliation
from . import metrics as metrics_mod
from . import red_flags as red_flags_mod
from .dataset import Candidate, Dataset, PeriodInfo, build_dataset

SEGMENT_CATEGORIES = {"customer_revenue", "revenue_segment"}


def candidate_key(period_id: str, category: str, label: str) -> tuple[str, str]:
    """Segment/customer rows are kept per label; every other category has one value per period."""
    if category in SEGMENT_CATEGORIES:
        return period_id, f"{category}:{label.strip().lower()}"
    return period_id, category


@dataclass
class AnalysisOutput:
    dataset: Dataset
    metrics: list
    reconciliations: list
    issues: list
    flags: list


def analyse(periods: list[PeriodInfo], candidates: dict[tuple[str, str], list[Candidate]], rows: list[quality.LineRow],
            docs: list[quality.DocumentInfo], adjustments: list[dict], currency: str, unit: str,
            period_start: date, period_end: date) -> AnalysisOutput:
    ds = build_dataset(periods, candidates, currency, unit)
    results = metrics_mod.calculate(ds)
    recs = reconciliation.run(ds)
    issues = quality.run_checks(ds, rows, docs, recs, currency, unit, period_start, period_end)
    flags = red_flags_mod.evaluate(ds, results, adjustments, recs)
    return AnalysisOutput(ds, results, recs, issues, flags)
