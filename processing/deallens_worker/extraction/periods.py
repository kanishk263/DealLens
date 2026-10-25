"""Detection of reporting-period column headers (FY2023, 2024F, Q1 2024, Dec-23, dates...)."""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime, timedelta
from typing import Optional

from .models import Period

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_name) if m})

_SCENARIO_WORDS = [
    (re.compile(r"\b(budget|bud|plan)\b", re.I), "budget"),
    (re.compile(r"\b(forecast|fcst|projected|projection|estimate|est)\b", re.I), "forecast"),
    (re.compile(r"\b(actual|actuals|act|audited|unaudited)\b", re.I), "actual"),
]


def _year(text: str) -> Optional[int]:
    y = int(text)
    if y < 100:
        y += 2000 if y < 70 else 1900
    return y if 1980 <= y <= 2100 else None


def _month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def _fy_dates(fy: int, fye_month: int, fye_day: int) -> tuple[date, date]:
    end_day = min(fye_day, calendar.monthrange(fy, fye_month)[1])
    end = date(fy, fye_month, end_day)
    start = (end.replace(year=fy - 1) + timedelta(days=1)) if not (fye_month == 2 and end_day == 29) else date(fy - 1, 3, 1)
    return start, end


def parse_period(raw, fye_month: int = 12, fye_day: int = 31) -> Optional[Period]:
    """Parse a header cell into a Period, or None if it is not a period header.

    `fye_month`/`fye_day` give the fiscal-year end used to date annual labels such as FY2023.
    """
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)) and float(raw).is_integer() and 1980 <= int(raw) <= 2100:
        raw = str(int(raw))
    if isinstance(raw, datetime):
        raw = raw.date()
    if isinstance(raw, date):
        return Period(label=raw.strftime("%b-%Y"), period_type="unknown", scenario="actual", start=None, end=raw,
                      sort_key=(raw.toordinal(), 0))
    text = str(raw).strip()
    if not text or len(text) > 40:
        return None

    scenario = "actual"
    for pattern, sc in _SCENARIO_WORDS:
        if pattern.search(text):
            scenario = sc
            text = pattern.sub("", text).strip(" -:/()")
            break

    t = text.replace("’", "'").strip()
    # Suffix letters: 2023A / FY24F / 2025E / 2024B
    m = re.fullmatch(r"(?:FY|CY)?\s*'?(\d{2}|\d{4})\s*([AFEBP])", t, re.I)
    if m:
        y = _year(m.group(1))
        if y is None:
            return None
        scenario = {"A": "actual", "F": "forecast", "E": "forecast", "P": "forecast", "B": "budget"}[m.group(2).upper()]
        start, end = _fy_dates(y, fye_month, fye_day)
        return _annual(y, scenario, start, end)

    m = re.fullmatch(r"(?:FY|CY|YE|year(?:\s+ended)?)?\s*'?(\d{4}|\d{2})", t, re.I)
    if m and (len(m.group(1)) == 4 or re.match(r"(?:FY|CY|YE)", t, re.I)):
        y = _year(m.group(1))
        if y is None:
            return None
        start, end = _fy_dates(y, fye_month, fye_day)
        return _annual(y, scenario, start, end)

    m = re.fullmatch(r"FY\s*(\d{2}|\d{4})\s*/\s*(\d{2}|\d{4})", t, re.I)
    if m:
        y = _year(m.group(2))
        if y is None:
            return None
        start, end = _fy_dates(y, fye_month, fye_day)
        return _annual(y, scenario, start, end)

    m = re.fullmatch(r"(?:Q([1-4])\s*[-' ]?\s*(?:FY)?\s*(\d{4}|\d{2}))|(?:(\d{4})\s*[-' ]?\s*Q([1-4]))", t, re.I)
    if m:
        q = int(m.group(1) or m.group(4))
        y = _year(m.group(2) or m.group(3))
        if y is None:
            return None
        end = _month_end(y, q * 3)
        start = date(y, q * 3 - 2, 1)
        return Period(label=f"Q{q} {y}{_suffix(scenario)}", period_type="quarterly", scenario=scenario, start=start, end=end,
                      sort_key=(end.toordinal(), 1))

    m = re.fullmatch(r"H([12])\s*[-' ]?\s*(\d{4}|\d{2})", t, re.I)
    if m:
        h, y = int(m.group(1)), _year(m.group(2))
        if y is None:
            return None
        end = _month_end(y, 6 * h)
        return Period(label=f"H{h} {y}{_suffix(scenario)}", period_type="ytd" if h == 1 else "unknown", scenario=scenario,
                      start=date(y, 6 * h - 5, 1), end=end, sort_key=(end.toordinal(), 1))

    m = re.fullmatch(r"(?:(\d{1,2})[\s\-/])?([A-Za-z]{3,9})[\s\-/']*(\d{4}|\d{2})", t)
    if m and m.group(2).lower() in MONTHS:
        mo, y = MONTHS[m.group(2).lower()], _year(m.group(3))
        if y is None:
            return None
        end = _month_end(y, mo)
        return Period(label=f"{calendar.month_abbr[mo]}-{y}{_suffix(scenario)}", period_type="unknown", scenario=scenario,
                      start=None, end=end, sort_key=(end.toordinal(), 0))

    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
        return Period(label=d.strftime("%b-%Y") + _suffix(scenario), period_type="unknown", scenario=scenario, start=None, end=d,
                      sort_key=(d.toordinal(), 0))
    return None


def _suffix(scenario: str) -> str:
    return {"actual": "", "budget": " Budget", "forecast": " Forecast"}[scenario]


def _annual(y: int, scenario: str, start: date, end: date) -> Period:
    return Period(label=f"FY{y}{_suffix(scenario)}", period_type="annual", scenario=scenario, start=start, end=end,
                  sort_key=(end.toordinal(), 2))


def infer_date_period_types(periods: list[Period]) -> list[Period]:
    """Month/date headers have unknown length; infer annual/quarterly/monthly from their spacing."""
    dated = [p for p in periods if p.period_type == "unknown" and p.end]
    if len(dated) < 2:
        return [_as_annual_if_single(p) for p in periods]
    ends = sorted(p.end for p in dated)
    gaps = [(b - a).days for a, b in zip(ends, ends[1:])]
    avg = sum(gaps) / len(gaps)
    kind = "annual" if 330 <= avg <= 400 else "quarterly" if 80 <= avg <= 100 else "monthly" if 25 <= avg <= 35 else "unknown"
    out = []
    for p in periods:
        if p.period_type == "unknown" and p.end and kind != "unknown":
            months = {"annual": 12, "quarterly": 3, "monthly": 1}[kind]
            label = f"FY{p.end.year}{_suffix(p.scenario)}" if kind == "annual" else p.label
            out.append(Period(label=label, period_type=kind, scenario=p.scenario, start=_months_before(p.end, months),
                              end=p.end, sort_key=p.sort_key))
        else:
            out.append(p)
    return out


def _months_before(end: date, months: int) -> date:
    """First day of the period of `months` length ending on month-end `end`."""
    total = end.year * 12 + (end.month - 1) - months + 1
    return date(total // 12, total % 12 + 1, 1)


def _as_annual_if_single(p: Period) -> Period:
    return p
