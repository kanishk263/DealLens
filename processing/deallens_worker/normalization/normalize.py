"""Normalisation of raw extracted line items into standard categories, units and sign conventions.

Raw values are never modified; this module only computes the normalised fields and records why."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from ..extraction.models import RawLineItem
from .rules import AUTO_MAP_THRESHOLD, match
from .taxonomy import EXPENSE_CATEGORIES

UNIT_SCALE = {"units": 1.0, "thousands": 1_000.0, "millions": 1_000_000.0}


@dataclass
class NormalizedItem:
    raw: RawLineItem
    category: Optional[str]
    mapping_status: str
    confidence: Optional[float]
    normalized_value: Optional[float]
    currency: str
    unit: str
    notes: list[str] = field(default_factory=list)
    alternatives: list[tuple[str, float]] = field(default_factory=list)


def classify(item: RawLineItem, document_category: str) -> tuple[Optional[str], str, Optional[float], list[tuple[str, float]], list[str]]:
    notes: list[str] = []
    statement = item.statement_type
    if statement == "supporting" or document_category in ("revenue_schedule",) and statement in ("unknown", "supporting"):
        if item.is_subtotal:
            return None, "unmapped", None, [], ["schedule_total_not_mapped"]
        grid = (item.source_sheet or item.source_table_reference or "").lower()
        aggregate = re.search(r"\b(all )?others?\b|\bremaining\b|\brest of\b|\bunallocated\b", item.original_label, re.I)
        is_customer = "customer" in grid or "customer" in item.original_label.lower()
        # Aggregated rows ("All other customers") are not single customers and must not drive concentration metrics.
        cat = "customer_revenue" if is_customer and not aggregate else "revenue_segment"
        return cat, "needs_review", 0.7, [], ["schedule_row_mapping_requires_confirmation"]
    matches = match(item.original_label, statement)
    if not matches:
        return None, "unmapped", None, [], notes
    best, conf = matches[0]
    ambiguous = len(matches) > 1 and matches[1][1] >= conf - 0.1
    if ambiguous:
        notes.append("ambiguous_label")
    status = "auto_mapped" if conf >= AUTO_MAP_THRESHOLD and not ambiguous else "needs_review"
    return best, status, round(conf, 3), matches[1:4], notes


def normalize_items(items: list[RawLineItem], submission_currency: str, submission_unit: str, document_category: str) -> list[NormalizedItem]:
    out: list[NormalizedItem] = []
    target_scale = UNIT_SCALE[submission_unit]
    for item in items:
        category, status, conf, alternatives, notes = classify(item, document_category)
        currency = item.detected_currency or submission_currency
        unit = item.detected_unit or submission_unit
        if not item.detected_currency:
            notes.append("currency_assumed_from_submission")
        if not item.detected_unit:
            notes.append("unit_assumed_from_submission")
        value = item.parsed.value
        normalized: Optional[float] = None
        if value is not None and not item.parsed.invalid:
            if currency != submission_currency:
                notes.append("currency_mismatch_not_converted")
            else:
                normalized = value * UNIT_SCALE[unit] / target_scale
                if unit != submission_unit:
                    notes.append(f"scaled_from_{unit}_to_{submission_unit}")
                if category in EXPENSE_CATEGORIES and normalized < 0:
                    normalized = -normalized
                    notes.append("expense_presented_negative_sign_normalised")
        if item.parsed.note:
            notes.append(item.parsed.note)
        out.append(NormalizedItem(raw=item, category=category, mapping_status=status, confidence=conf,
                                  normalized_value=normalized, currency=currency, unit=submission_unit if normalized is not None else unit,
                                  notes=notes, alternatives=alternatives))
    return out
