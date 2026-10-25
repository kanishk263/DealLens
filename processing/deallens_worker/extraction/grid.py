"""Layout detection over a generic cell grid.

Strategy (deterministic, explainable):
1. Scan the top of the grid for statement titles, currency and unit indicators.
2. Find the header row: the first row (within MAX_HEADER_SCAN rows) with >=1 period header and no more
   numeric data than headers. Duplicate period headers in one row are reported.
3. The label column is the text-heaviest column to the left of the first period column.
4. Every subsequent row with a label and at least one non-empty value becomes line items, one per period
   column. Rows with a label but no values are section headings, which may switch statement context.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Optional

from .models import Cell, ExtractionResult, Grid, Period, RawLineItem
from .periods import infer_date_period_types, parse_period
from .values import parse_value

MAX_HEADER_SCAN = 30

STATEMENT_PATTERNS = [
    (re.compile(r"income statement|profit (and|&) loss|p\s*&\s*l\b|statement of (comprehensive )?income|statement of operations", re.I), "income_statement"),
    (re.compile(r"balance sheet|statement of financial position", re.I), "balance_sheet"),
    (re.compile(r"cash ?flow", re.I), "cash_flow"),
]
CURRENCY_PATTERNS = [
    (re.compile(r"\bUSD\b|US\$|\$"), "USD"), (re.compile(r"\bGBP\b|£"), "GBP"), (re.compile(r"\bEUR\b|€"), "EUR"),
    (re.compile(r"\bINR\b|₹"), "INR"), (re.compile(r"\bJPY\b|¥"), "JPY"), (re.compile(r"\bAUD\b"), "AUD"),
    (re.compile(r"\bCAD\b"), "CAD"), (re.compile(r"\bCHF\b"), "CHF"),
]
UNIT_PATTERNS = [
    (re.compile(r"in millions|\(millions\)|\bmillions\b|\$m\b|\bm\)|'?000,?000s?|\bmn\b", re.I), "millions"),
    (re.compile(r"in thousands|\(thousands\)|\bthousands\b|'000s?|000s|\$k\b|\(k\)|\bk\)", re.I), "thousands"),
    (re.compile(r"in units|\bunits\b|whole (dollars|pounds|euros)", re.I), "units"),
]
SUBTOTAL = re.compile(r"^(total|net|gross|subtotal|sub-total)\b|\btotal\b", re.I)


def detect_statement(text: str) -> Optional[str]:
    for pattern, kind in STATEMENT_PATTERNS:
        if pattern.search(text):
            return kind
    return None


def detect_currency(text: str) -> Optional[str]:
    for pattern, code in CURRENCY_PATTERNS:
        if pattern.search(text):
            return code
    return None


def detect_unit(text: str) -> Optional[str]:
    for pattern, unit in UNIT_PATTERNS:
        if pattern.search(text):
            return unit
    return None


def _text(cell: Cell) -> str:
    return "" if cell.value is None else str(cell.value).strip()


def _is_texty(cell: Cell) -> bool:
    t = _text(cell)
    return bool(t) and parse_value(cell.value).value is None and parse_period(cell.value) is None


def extract_grid(grid: Grid, method: str, default_statement: str, fye: tuple[int, int], result: ExtractionResult) -> None:
    rows = [r for r in grid.rows if any(c.value not in (None, "") for c in r)]
    if not rows:
        return

    statement = detect_statement(grid.name) or default_statement
    currency = unit = None
    header_index = None
    period_cols: dict[int, Period] = {}

    for i, row in enumerate(rows[:MAX_HEADER_SCAN]):
        row_text = " ".join(_text(c) for c in row)
        statement = detect_statement(row_text) or statement
        currency = currency or detect_currency(row_text)
        unit = unit or detect_unit(row_text)
        found = {c.col: p for c in row if (p := parse_period(c.value, *fye)) is not None}
        if found:
            numeric = sum(1 for c in row if parse_value(c.value).value is not None and parse_period(c.value, *fye) is None)
            if numeric <= len(found):
                header_index, period_cols = i, found
                break

    if header_index is None:
        result.warnings.append({"code": "NO_PERIOD_HEADER", "grid": grid.name,
                                "message": "No reporting-period header row was recognised; the table was skipped."})
        return

    inferred = infer_date_period_types(list(period_cols.values()))
    period_cols = dict(zip(period_cols.keys(), inferred))
    labels = Counter(p.label for p in period_cols.values())
    for label, n in labels.items():
        if n > 1:
            result.warnings.append({"code": "DUPLICATE_PERIOD_COLUMN", "grid": grid.name, "period": label,
                                    "message": f"Period {label} appears in {n} columns of '{grid.name}'. Only the first column was used."})
    seen: set[str] = set()
    first_cols: dict[int, Period] = {}
    for col in sorted(period_cols):
        if period_cols[col].label not in seen:
            seen.add(period_cols[col].label)
            first_cols[col] = period_cols[col]

    first_period_col = min(first_cols)
    body = rows[header_index + 1:]
    candidates = Counter(c.col for r in body for c in r if c.col < first_period_col and _is_texty(c))
    if not candidates:
        result.warnings.append({"code": "NO_LABEL_COLUMN", "grid": grid.name, "message": "No line-item label column was found."})
        return
    label_col = candidates.most_common(1)[0][0]

    for row in body:
        by_col = {c.col: c for c in row}
        label_cell = by_col.get(label_col)
        label = _text(label_cell) if label_cell else ""
        if not label:
            continue
        value_cells = [(by_col.get(col), period) for col, period in first_cols.items()]
        if all(c is None or c.value in (None, "") for c, _ in value_cells):
            heading = detect_statement(label)
            if heading:
                statement = heading
            unit = detect_unit(label) or unit
            continue
        for cell, period in value_cells:
            if cell is None or (cell.value in (None, "") and not cell.formula_missing_value):
                continue
            parsed = parse_value(cell.value)
            if cell.formula_missing_value:
                parsed.invalid, parsed.note = True, "formula_without_cached_value"
            if parsed.note == "percentage":
                continue  # ratio rows (e.g. "Gross margin %") are not ledger values; DealLens recalculates ratios.
            result.items.append(RawLineItem(
                original_label=label,
                period=period,
                raw_value=None if cell.value is None else str(cell.value),
                parsed=parsed,
                statement_type=statement or "unknown",
                source_sheet=grid.sheet,
                source_cell_reference=cell.ref if method.startswith("excel") else None,
                source_page_number=grid.page,
                source_table_reference=grid.table_ref or (cell.ref if not method.startswith("excel") else None),
                source_row=cell.row,
                source_column=cell.col,
                extraction_method=method,
                is_subtotal=bool(SUBTOTAL.search(label)),
                detected_currency=currency,
                detected_unit=unit,
            ))
