"""Automated data-quality checks. Wording is neutral: issues are potential inconsistencies that
require investigation, not conclusions about the company."""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

from ..financial.dataset import Dataset
from ..normalization.taxonomy import CATEGORIES, EXPENSE_CATEGORIES
from .reconciliation import Reconciliation

THRESHOLDS = json.loads((Path(__file__).resolve().parents[2] / "config" / "thresholds.json").read_text())["data_quality"]


@dataclass
class LineRow:
    id: str
    period_id: str
    period_label: str
    category: Optional[str]
    mapping_status: str
    statement_type: str
    parsed_value: Optional[float]
    invalid: bool
    notes: list[str]
    reference: str
    currency: Optional[str]
    detected_unit: Optional[str]
    document_id: str


@dataclass
class DocumentInfo:
    id: str
    filename: str
    status: str
    possible_duplicate_of: Optional[str]
    warnings: list[dict] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class Issue:
    issue_key: str
    issue_type: str
    severity: str
    title: str
    description: str
    suggested_resolution: str
    source_references: list = field(default_factory=list)
    period_id: Optional[str] = None
    client_visible: bool = True


def _refs(rows, limit=20):
    return [{"line_item_id": r.id, "reference": r.reference, "label": r.category or "unmapped"} for r in rows[:limit]]


def run_checks(ds: Dataset, rows: list[LineRow], docs: list[DocumentInfo], recs: list[Reconciliation],
               submission_currency: str, submission_unit: str, period_start: date, period_end: date) -> list[Issue]:
    issues: list[Issue] = []
    add = issues.append
    mapped = [r for r in rows if r.category and r.mapping_status in ("auto_mapped", "analyst_mapped", "analyst_confirmed")]
    statements = {r.statement_type for r in mapped} | {_home(r.category) for r in mapped}

    # Document-level outcomes
    for d in docs:
        if d.status in ("failed", "unsupported"):
            add(Issue(f"document_failed:{d.id}", "document_processing_failed", "critical", f"Document could not be processed: {d.filename}",
                      d.error or "The document could not be processed.", "Replace the file with a supported, text-based version and resubmit.",
                      [{"document_id": d.id}]))
        if d.possible_duplicate_of:
            add(Issue(f"duplicate_document:{d.id}", "possible_duplicate_upload", "low", f"Possible duplicate upload: {d.filename}",
                      "A document with an identical checksum was previously uploaded for this company.",
                      "Confirm whether this file was uploaded intentionally; remove it if it is a duplicate.", [{"document_id": d.id, "duplicate_of": d.possible_duplicate_of}]))
        for w in d.warnings:
            if w.get("code") == "DUPLICATE_PERIOD_COLUMN":
                add(Issue(f"duplicate_period:{d.id}:{w.get('grid')}:{w.get('period')}", "duplicate_reporting_period", "medium",
                          f"Duplicate period column {w.get('period')}", w["message"], "Remove or relabel duplicate period columns in the source.",
                          [{"document_id": d.id, "grid": w.get("grid")}]))
            elif w.get("code") in ("NO_PERIOD_HEADER", "NO_LABEL_COLUMN"):
                add(Issue(f"layout:{d.id}:{w.get('grid')}", "unrecognised_layout", "low", f"Table not recognised in {d.filename}",
                          f"{w['message']} (table: {w.get('grid')})", "If this table contains financial data, restructure it with periods as column headers.",
                          [{"document_id": d.id, "grid": w.get("grid")}]))

    # Required statements
    for st, sev, title in (("income_statement", "high", "Income statement"), ("balance_sheet", "medium", "Balance sheet"), ("cash_flow", "medium", "Cash flow statement")):
        if st not in statements:
            add(Issue(f"missing_statement:{st}", "missing_required_statement", sev, f"{title} not identified",
                      f"No mapped line items were identified for the {title.lower()}.",
                      f"Upload the {title.lower()} or map its line items in the data review.", []))

    # Periods
    actual = ds.actual_periods()
    annual = [p for p in actual if p.period_type == "annual"]
    if not actual:
        add(Issue("missing_periods", "missing_reporting_periods", "critical", "No historical reporting periods identified",
                  "No actual-period columns were recognised in the uploaded documents.", "Check that period headers (e.g. FY2023) are present.", []))
    min_periods = THRESHOLDS["min_annual_periods"]["value"]
    if 0 < len(annual) < min_periods:
        add(Issue("incomplete_history", "incomplete_historical_periods", "low", f"Only {len(annual)} annual period(s) available",
                  f"Trend analysis normally uses at least {min_periods} historical annual periods (illustrative default).",
                  "Provide additional historical periods if available.", []))
    years = sorted(p.end.year for p in annual if p.end)
    gaps = [y for a, b in zip(years, years[1:]) for y in range(a + 1, b)]
    if gaps:
        add(Issue("period_gaps", "missing_reporting_periods", "medium", "Gaps between annual periods",
                  f"Missing annual period(s): {', '.join(f'FY{y}' for y in gaps)}.", "Provide the missing periods or confirm they are not applicable.", []))
    outside = [p for p in actual if p.end and not (period_start <= p.end <= period_end)]
    if outside:
        add(Issue("periods_outside_scope", "periods_outside_declared_range", "informational", "Periods outside the declared reporting period",
                  f"{', '.join(p.label for p in outside)} fall outside {period_start} – {period_end}.", "Confirm the declared reporting period.", []))

    # Line-item values
    invalid = [r for r in rows if r.invalid]
    if invalid:
        formula = [r for r in invalid if "formula_without_cached_value" in r.notes]
        add(Issue("invalid_numeric_values", "invalid_numeric_values", "medium", f"{len(invalid)} value(s) could not be read as numbers",
                  "Some cells contain text, spreadsheet errors or formulas without calculated values." +
                  (f" {len(formula)} formula cell(s) have no cached value (the file was saved without recalculation)." if formula else ""),
                  "Open the source file, recalculate, replace error values and re-upload.", _refs(invalid)))
    currencies = {r.currency for r in rows if r.currency}
    if len(currencies) > 1 or (currencies and submission_currency not in currencies):
        add(Issue("mixed_currencies", "mixed_currencies", "critical", "Mixed or unexpected currencies",
                  f"Detected currencies: {', '.join(sorted(currencies))}; submission currency is {submission_currency}. Values in other currencies were not converted.",
                  "Provide all statements in the submission currency or document the FX rates to apply.", _refs([r for r in rows if r.currency != submission_currency])))
    units = {r.detected_unit for r in rows if r.detected_unit}
    if len(units) > 1:
        add(Issue("inconsistent_units", "inconsistent_units", "high", "Inconsistent units across documents",
                  f"Documents are presented in different units ({', '.join(sorted(units))}). Values were scaled to {submission_unit}.",
                  "Confirm the unit of each statement; correct mappings if a unit indicator was misread.", []))
    elif units and submission_unit not in units:
        add(Issue("unit_scaled", "inconsistent_units", "informational", "Values scaled to the submission unit",
                  f"Documents state values in {next(iter(units))}; they were scaled to {submission_unit}.", "No action needed if the declared unit is correct.", []))

    unmapped = [r for r in rows if r.mapping_status == "unmapped" and not r.invalid]
    review = [r for r in rows if r.mapping_status == "needs_review"]
    if unmapped:
        add(Issue("unmapped_items", "unmapped_line_items", "medium" if len(unmapped) > 5 else "low", f"{len(unmapped)} line item value(s) not mapped",
                  "These source labels did not match a standard category and are excluded from calculations until mapped.",
                  "Map or exclude them in the financial data review.", _refs(unmapped), client_visible=False))
    if review:
        add(Issue("mapping_review", "uncertain_mappings", "low", f"{len(review)} mapping(s) need analyst review",
                  "These labels matched a category with low confidence or ambiguously and are excluded until confirmed.",
                  "Confirm or correct the proposed categories.", _refs(review), client_visible=False))

    for c in ds.conflicts:
        label = CATEGORIES.get(c["category"], c["category"])
        add(Issue(f"conflict:{c['category']}:{c['period_id']}", "duplicate_line_items", "high", f"Conflicting values for {label}",
                  f"{len(c['values'])} different values were mapped to {label} in the same period. The analyst-confirmed or highest-confidence value was used.",
                  "Confirm which value is correct and exclude the others.", c["values"], c["period_id"]))
    for d in ds.duplicates:
        label = CATEGORIES.get(d["category"], d["category"])
        add(Issue(f"duplicate:{d['category']}:{d['period_id']}", "duplicate_line_items", "informational", f"{label} reported more than once",
                  "The same value appears in more than one place (e.g. two documents). Values agree.", "No action needed unless the documents differ in scope.",
                  d["values"], d["period_id"], client_visible=False))

    # Key figures
    for p in actual:
        if not ds.get(p.id, "revenue"):
            add(Issue(f"missing_revenue:{p.id}", "missing_key_figure", "high", f"Revenue missing for {p.label}", "No revenue figure is mapped for this period.",
                      "Map the revenue line or provide the income statement for this period.", [], p.id))
        if not (ds.get(p.id, "net_income") or ds.get(p.id, "ebit") or ds.get(p.id, "ebitda")):
            add(Issue(f"missing_profit:{p.id}", "missing_key_figure", "high", f"No profit measure for {p.label}",
                      "None of net income, EBIT or EBITDA is mapped for this period.", "Map a profit line or provide the full income statement.", [], p.id))
        if "cash_flow" in statements and not ds.get(p.id, "operating_cash_flow"):
            add(Issue(f"missing_ocf:{p.id}", "missing_cash_flow_values", "medium", f"Operating cash flow missing for {p.label}",
                      "A cash flow statement was provided but operating cash flow was not identified for this period.", "Map the operating cash flow subtotal.", [], p.id))
        for cat in ("revenue", "total_assets", "accounts_receivable", "inventory", "cash"):
            s = ds.get(p.id, cat)
            if s and s.value < 0:
                add(Issue(f"negative:{cat}:{p.id}", "negative_value_requires_investigation", "medium", f"Negative {CATEGORIES[cat].lower()} in {p.label}",
                          f"{CATEGORIES[cat]} is negative ({s.value:,.0f}), which requires investigation (possible sign or mapping error).",
                          "Confirm the sign convention in the source document.", [{"line_item_id": s.line_item_ids[0], "reference": s.reference}], p.id))

    # Sign conventions: expense categories presented with mixed signs across periods
    by_cat = defaultdict(list)
    for r in mapped:
        if r.category in EXPENSE_CATEGORIES and r.parsed_value not in (None, 0):
            by_cat[r.category].append(r)
    for cat, rs in by_cat.items():
        signs = {r.parsed_value > 0 for r in rs}
        if len(signs) > 1:
            add(Issue(f"sign:{cat}", "unexpected_sign_convention", "low", f"Mixed sign convention for {CATEGORIES[cat].lower()}",
                      "This expense is shown as positive in some places and negative in others. DealLens normalises expenses to positive amounts.",
                      "Confirm whether any period contains a reversal or credit.", _refs(rs)))

    # Large movements
    pct = THRESHOLDS["large_movement_pct"]["value"]
    for a, b in zip(actual, actual[1:]):
        if a.period_type != b.period_type:
            continue
        for cat in ("revenue", "cogs", "sga", "accounts_receivable", "inventory", "accounts_payable", "short_term_debt", "long_term_debt"):
            x, y = ds.get(a.id, cat), ds.get(b.id, cat)
            if x and y and abs(x.value) > 0 and abs(y.value / x.value - 1) > pct:
                add(Issue(f"movement:{cat}:{b.id}", "large_period_movement", "low", f"Unusual movement in {CATEGORIES[cat].lower()} ({a.label} → {b.label})",
                          f"{CATEGORIES[cat]} changed by {(y.value / x.value - 1):+.0%} (threshold {pct:.0%}, illustrative).",
                          "Obtain an explanation for the movement.", [{"reference": x.reference}, {"reference": y.reference}], b.id))

    # Reconciliations
    for rec in recs:
        if rec.status == "variance":
            name = "Balance sheet does not balance" if rec.check_key == "balance_sheet" else "Cash roll-forward does not reconcile"
            add(Issue(f"recon:{rec.check_key}:{rec.period_id}", "reconciliation_variance", "high", f"{name} ({rec.period_label})",
                      f"{rec.details.get('formula')}: difference of {rec.variance:,.1f} (tolerance {rec.tolerance:,.1f}). This is a potential inconsistency requiring investigation.",
                      "Check for missing or mis-mapped line items and sign conventions.", [{"reference": r} for r in rec.details.get("references", [])], rec.period_id))
        elif rec.status == "not_tested" and rec.check_key == "balance_sheet" and "balance_sheet" in statements:
            add(Issue(f"recon_not_tested:{rec.check_key}:{rec.period_id}", "reconciliation_not_tested", "informational",
                      f"Balance sheet check not performed ({rec.period_label})", rec.details.get("reason", "Inputs missing."),
                      "Map total assets, total liabilities and total equity.", [], rec.period_id))
    return issues


def _home(category: Optional[str]) -> Optional[str]:
    from ..normalization.taxonomy import STATEMENT_OF
    return STATEMENT_OF.get(category) if category else None
