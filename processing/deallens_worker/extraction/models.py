from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional


@dataclass
class Cell:
    value: Any
    ref: str                 # e.g. "B7" (Excel), "R7C2" (CSV), "p2:t1:R5C3" (PDF)
    row: int                 # 1-based row in the source grid
    col: int                 # 1-based column in the source grid
    formula_missing_value: bool = False


@dataclass
class Grid:
    """A rectangular region of a document: an Excel sheet, a CSV file, or a PDF table/page."""
    name: str
    rows: list[list[Cell]]
    sheet: Optional[str] = None
    page: Optional[int] = None
    table_ref: Optional[str] = None


@dataclass(frozen=True)
class Period:
    label: str               # canonical label, e.g. "FY2023", "Q1 2024", "FY2025F"
    period_type: str         # annual | quarterly | monthly | ytd | unknown
    scenario: str            # actual | budget | forecast
    start: Optional[date]
    end: Optional[date]
    sort_key: tuple


@dataclass
class ParsedValue:
    value: Optional[float]
    invalid: bool = False
    note: Optional[str] = None


@dataclass
class RawLineItem:
    original_label: str
    period: Period
    raw_value: Optional[str]
    parsed: ParsedValue
    statement_type: str
    source_sheet: Optional[str]
    source_cell_reference: Optional[str]
    source_page_number: Optional[int]
    source_table_reference: Optional[str]
    source_row: Optional[int]
    source_column: Optional[int]
    extraction_method: str
    is_subtotal: bool = False
    detected_currency: Optional[str] = None
    detected_unit: Optional[str] = None


@dataclass
class ExtractionResult:
    items: list[RawLineItem] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    warnings: list[dict] = field(default_factory=list)
