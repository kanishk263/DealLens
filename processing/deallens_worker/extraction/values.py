"""Parsing of numeric cell values as presented in financial statements."""
from __future__ import annotations

import math
import re
from datetime import date, datetime

from .models import ParsedValue

_DASHES = {"-", "–", "—", "--", "‒"}
_MISSING = {"", "n/a", "na", "n.a.", "nm", "n.m.", "none", "null", "#n/a", "tbc", "tbd"}
_EXCEL_ERRORS = {"#ref!", "#value!", "#div/0!", "#name?", "#num!", "#null!", "#n/a"}
_CURRENCY_CHARS = re.compile(r"[$£€₹¥]|\b(?:usd|gbp|eur|inr|jpy|aud|cad|chf)\b", re.I)
_NUMBER = re.compile(r"^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$")


def parse_value(raw) -> ParsedValue:
    """Return the numeric value of a cell, preserving why a value could not be parsed.

    Conventions: parentheses and trailing minus denote negatives; dashes denote nil (0); currency
    symbols and thousands separators are ignored; percentages are returned as fractions with a note.
    """
    if raw is None:
        return ParsedValue(None)
    if isinstance(raw, bool):
        return ParsedValue(None, invalid=True, note="boolean_value")
    if isinstance(raw, (int, float)):
        if isinstance(raw, float) and (math.isnan(raw) or math.isinf(raw)):
            return ParsedValue(None, invalid=True, note="non_finite")
        return ParsedValue(float(raw))
    if isinstance(raw, (datetime, date)):
        return ParsedValue(None, invalid=True, note="date_in_value_cell")

    text = str(raw).strip().replace(" ", " ")
    low = text.lower()
    if low in _MISSING:
        return ParsedValue(None)
    if low in _EXCEL_ERRORS:
        return ParsedValue(None, invalid=True, note="spreadsheet_error_value")
    if text in _DASHES:
        return ParsedValue(0.0, note="dash_as_nil")

    negative = False
    s = _CURRENCY_CHARS.sub("", text).replace(" ", "")
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    if s.endswith("-") and len(s) > 1:
        negative, s = True, s[:-1]
    if s.startswith("-") or s.startswith("−"):
        negative, s = (not negative), s[1:]
    elif s.startswith("+"):
        s = s[1:]
    percent = s.endswith("%")
    if percent:
        s = s[:-1]
    if not _NUMBER.match(s):
        return ParsedValue(None, invalid=True, note="not_a_number")
    value = float(s.replace(",", ""))
    if negative:
        value = -value
    if percent:
        return ParsedValue(value / 100.0, note="percentage")
    return ParsedValue(value)


def looks_numeric(raw) -> bool:
    p = parse_value(raw)
    return p.value is not None and p.note != "percentage"
