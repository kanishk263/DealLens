"""Assembles the per-period category values the metrics engine consumes, from mapped line items.

Selection rule when a category has several candidate values in one period: prefer analyst-confirmed
or analyst-mapped items, then higher confidence, then the earliest-uploaded document. Candidates whose
values disagree beyond rounding tolerance are reported as conflicts (never silently averaged)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

USABLE_STATUSES = {"auto_mapped", "analyst_mapped", "analyst_confirmed"}
STATUS_RANK = {"analyst_confirmed": 0, "analyst_mapped": 0, "auto_mapped": 1}


@dataclass
class PeriodInfo:
    id: str
    label: str
    period_type: str
    scenario: str
    start: Optional[date]
    end: Optional[date]
    sort_order: int

    @property
    def days(self) -> Optional[int]:
        if self.start and self.end:
            return (self.end - self.start).days + 1
        return None


@dataclass
class Candidate:
    line_item_id: str
    value: float
    mapping_status: str
    confidence: Optional[float]
    document_order: int
    label: str
    reference: str


@dataclass
class Selected:
    value: float
    line_item_ids: list[str]
    reference: str
    label: str


@dataclass
class Dataset:
    periods: list[PeriodInfo]
    values: dict[str, dict[str, Selected]] = field(default_factory=dict)       # period_id -> category -> value
    conflicts: list[dict] = field(default_factory=list)
    duplicates: list[dict] = field(default_factory=list)
    currency: str = "USD"
    unit: str = "thousands"

    def get(self, period_id: str, category: str) -> Optional[Selected]:
        return self.values.get(period_id, {}).get(category)

    def actual_periods(self) -> list[PeriodInfo]:
        return sorted((p for p in self.periods if p.scenario == "actual"), key=lambda p: (p.end or date.min, p.sort_order))


def tolerance(a: float, b: float) -> float:
    """Rounding tolerance: one presentation unit or 0.1% of magnitude, whichever is larger."""
    return max(1.0, 0.001 * max(abs(a), abs(b)))


def build_dataset(periods: list[PeriodInfo], candidates: dict[tuple[str, str], list[Candidate]], currency: str, unit: str) -> Dataset:
    ds = Dataset(periods=periods, currency=currency, unit=unit)
    for (period_id, category), cands in candidates.items():
        usable = [c for c in cands if c.mapping_status in USABLE_STATUSES]
        if not usable:
            continue
        usable.sort(key=lambda c: (STATUS_RANK.get(c.mapping_status, 2), -(c.confidence or 0), c.document_order))
        chosen = usable[0]
        others = usable[1:]
        if others:
            disagreeing = [o for o in others if abs(o.value - chosen.value) > tolerance(o.value, chosen.value)]
            record = {"period_id": period_id, "category": category, "chosen": chosen.line_item_id,
                      "values": [{"line_item_id": c.line_item_id, "value": c.value, "reference": c.reference, "label": c.label} for c in usable]}
            (ds.conflicts if disagreeing else ds.duplicates).append(record)
        ds.values.setdefault(period_id, {})[category] = Selected(chosen.value, [chosen.line_item_id], chosen.reference, chosen.label)
    return ds
