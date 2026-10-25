from datetime import date

import pytest

from deallens_worker.extraction.periods import infer_date_period_types, parse_period
from deallens_worker.extraction.values import parse_value


@pytest.mark.parametrize("raw,expected", [
    (1234, 1234.0), ("1,234", 1234.0), ("(1,234)", -1234.0), ("1,234-", -1234.0), ("$ 2,500.50", 2500.5),
    ("-350", -350.0), ("−350", -350.0), ("USD 1,000", 1000.0), ("—", 0.0), ("-", 0.0),
])
def test_parse_value_numbers(raw, expected):
    assert parse_value(raw).value == pytest.approx(expected)


@pytest.mark.parametrize("raw", ["n/a", "", None, "NM"])
def test_parse_value_missing(raw):
    p = parse_value(raw)
    assert p.value is None and not p.invalid


@pytest.mark.parametrize("raw,note", [("abc", "not_a_number"), ("#REF!", "spreadsheet_error_value"), (True, "boolean_value"), ("1.2.3", "not_a_number")])
def test_parse_value_invalid(raw, note):
    p = parse_value(raw)
    assert p.invalid and p.note == note


def test_percent_is_fraction():
    p = parse_value("12.5%")
    assert p.value == pytest.approx(0.125) and p.note == "percentage"


@pytest.mark.parametrize("raw,label,ptype,scenario", [
    ("FY2023", "FY2023", "annual", "actual"), ("2022", "FY2022", "annual", "actual"), (2021, "FY2021", "annual", "actual"),
    ("2024F", "FY2024 Forecast", "annual", "forecast"), ("FY24B", "FY2024 Budget", "annual", "budget"),
    ("Budget 2024", "FY2024 Budget", "annual", "budget"), ("2023A", "FY2023", "annual", "actual"),
    ("Q1 2024", "Q1 2024", "quarterly", "actual"), ("2024 Q3", "Q3 2024", "quarterly", "actual"),
    ("Dec-23", "Dec-2023", "unknown", "actual"),
])
def test_parse_period(raw, label, ptype, scenario):
    p = parse_period(raw)
    assert p is not None and (p.label, p.period_type, p.scenario) == (label, ptype, scenario)


def test_fiscal_year_end_respected():
    p = parse_period("FY2023", fye_month=6, fye_day=30)
    assert p.end == date(2023, 6, 30) and p.start == date(2022, 7, 1)


@pytest.mark.parametrize("raw", ["Revenue", "Notes", "1500", "12", None, "Total"])
def test_non_periods(raw):
    assert parse_period(raw) is None


def test_infer_annual_from_dates():
    ps = [parse_period(date(2021, 12, 31)), parse_period(date(2022, 12, 31)), parse_period(date(2023, 12, 31))]
    out = infer_date_period_types(ps)
    assert [p.label for p in out] == ["FY2021", "FY2022", "FY2023"]
    assert all(p.period_type == "annual" for p in out)
