"""Financial accuracy edge cases with hand-computed expected results (documented in docs/testing.md)."""
from datetime import date

import pytest

from deallens_worker.financial.dataset import Candidate, PeriodInfo, build_dataset, tolerance
from deallens_worker.financial.metrics import calculate
from deallens_worker.validation import reconciliation
from deallens_worker.validation.quality import LineRow, run_checks

P1 = PeriodInfo("p1", "FY2023", "annual", "actual", date(2023, 1, 1), date(2023, 12, 31), 1)
P2 = PeriodInfo("p2", "FY2024", "annual", "actual", date(2024, 1, 1), date(2024, 12, 31), 2)


def ds(values: dict, periods=(P1, P2)):
    cands = {}
    for (pid, cat), v in values.items():
        cands[(pid, cat)] = [Candidate(f"{pid}-{cat}", v, "auto_mapped", 0.95, 0, cat, f"ref {cat}")]
    return build_dataset(list(periods), cands, "USD", "thousands")


def m(results, key, pid="p2"):
    return next(r for r in results if r.key == key and r.period_id == pid)


def test_zero_revenue_makes_margins_and_dso_unavailable():
    r = calculate(ds({("p2", "revenue"): 0, ("p2", "gross_profit"): 0, ("p2", "accounts_receivable"): 50}))
    assert m(r, "gross_margin").status == "unavailable" and "zero" in m(r, "gross_margin").reason
    assert m(r, "dso").status == "unavailable"


def test_negative_ebitda_blocks_leverage_but_is_reported():
    r = calculate(ds({("p2", "revenue"): 1000, ("p2", "ebitda"): -120, ("p2", "short_term_debt"): 100, ("p2", "long_term_debt"): 400, ("p2", "cash"): 50}))
    assert m(r, "ebitda").value == -120
    assert m(r, "ebitda_margin").value == pytest.approx(-0.12)
    assert m(r, "net_debt").value == 450
    assert m(r, "net_debt_to_ebitda").status == "unavailable" and "negative" in m(r, "net_debt_to_ebitda").reason


def test_missing_prior_period_growth_unavailable():
    r = calculate(ds({("p2", "revenue"): 1000}, periods=(P2,)))
    assert m(r, "revenue_growth").status == "unavailable"


def test_non_comparable_periods_do_not_produce_growth():
    q = PeriodInfo("q", "Q1 2024", "quarterly", "actual", date(2024, 1, 1), date(2024, 3, 31), 3)
    r = calculate(ds({("p1", "revenue"): 1000, ("q", "revenue"): 300}, periods=(P1, q)))
    assert m(r, "revenue_growth", "q").status == "unavailable"


def test_zero_cogs_blocks_dio_and_dpo():
    r = calculate(ds({("p2", "revenue"): 100, ("p2", "cogs"): 0, ("p2", "inventory"): 10, ("p2", "accounts_payable"): 5, ("p2", "accounts_receivable"): 20}))
    assert m(r, "dio").status == "unavailable" and m(r, "dpo").status == "unavailable"
    assert m(r, "dso").value == pytest.approx(20 / 100 * 366)
    assert m(r, "cash_conversion_cycle").status == "unavailable"


def test_negative_working_capital_is_calculated_not_hidden():
    r = calculate(ds({("p2", "total_current_assets"): 300, ("p2", "total_current_liabilities"): 450}))
    assert m(r, "net_working_capital").value == -150


def test_missing_accounts_receivable():
    r = calculate(ds({("p2", "revenue"): 500, ("p2", "accounts_payable"): 40}))
    assert m(r, "dso").status == "unavailable"
    assert m(r, "trade_working_capital").status == "unavailable"


def test_dso_uses_average_balances_and_actual_days():
    r = calculate(ds({("p1", "accounts_receivable"): 100, ("p2", "accounts_receivable"): 140, ("p2", "revenue"): 1200}))
    assert m(r, "dso").value == pytest.approx(120 / 1200 * 366)


def test_gross_debt_with_only_one_component_is_a_warning():
    r = calculate(ds({("p2", "long_term_debt"): 400, ("p2", "cash"): 100}))
    assert m(r, "gross_debt").status == "warning"
    assert m(r, "net_debt").value == 300


def test_missing_net_debt_inputs():
    r = calculate(ds({("p2", "short_term_debt"): 10}))
    assert m(r, "net_debt").status == "unavailable"


def test_ebitda_bottom_up_when_ebit_not_reported():
    r = calculate(ds({("p2", "net_income"): 70, ("p2", "taxes"): 20, ("p2", "interest_expense"): 10, ("p2", "d_and_a"): 30, ("p2", "revenue"): 500}))
    assert m(r, "ebit").value == 100 and m(r, "ebit").inputs["basis"] == "bottom_up"
    assert m(r, "ebitda").value == 130 and m(r, "ebitda").inputs["basis"] == "calculated"


def test_free_cash_flow_definition():
    r = calculate(ds({("p2", "operating_cash_flow"): 80, ("p2", "capex"): 30, ("p2", "ebitda"): 100}))
    assert m(r, "free_cash_flow").value == 50
    assert m(r, "ocf_to_ebitda").value == pytest.approx(0.8)


def test_rounding_tolerance_in_balance_sheet_reconciliation():
    d = ds({("p2", "total_assets"): 1000.4, ("p2", "total_liabilities"): 600, ("p2", "equity"): 400})
    rec = reconciliation.balance_sheet(d, P2)
    assert rec.status == "reconciled" and tolerance(1000.4, 1000) == 1.0004
    d2 = ds({("p2", "total_assets"): 1010, ("p2", "total_liabilities"): 600, ("p2", "equity"): 400})
    assert reconciliation.balance_sheet(d2, P2).status == "variance"


def test_incomplete_balance_sheet_is_not_tested_not_reconciled():
    rec = reconciliation.balance_sheet(ds({("p2", "total_assets"): 1000}), P2)
    assert rec.status == "not_tested"


def test_mixed_currencies_raise_critical_issue():
    d = ds({("p2", "revenue"): 100})
    rows = [LineRow("a", "p2", "FY2024", "revenue", "auto_mapped", "income_statement", 100, False, [], "x", "USD", None, "d"),
            LineRow("b", "p2", "FY2024", "cogs", "auto_mapped", "income_statement", 50, False, [], "y", "EUR", None, "d")]
    issues = run_checks(d, rows, [], [], "USD", "thousands", date(2023, 1, 1), date(2024, 12, 31))
    mixed = [i for i in issues if i.issue_type == "mixed_currencies"]
    assert mixed and mixed[0].severity == "critical"


def test_conflicting_values_are_not_averaged():
    cands = {("p2", "revenue"): [Candidate("a", 100, "auto_mapped", 0.95, 0, "Revenue", "IS!B5"), Candidate("b", 130, "auto_mapped", 0.9, 1, "Sales", "IS!B9")]}
    d = build_dataset([P2], cands, "USD", "thousands")
    assert d.get("p2", "revenue").value == 100 and len(d.conflicts) == 1


def test_analyst_confirmed_value_wins():
    cands = {("p2", "revenue"): [Candidate("a", 100, "auto_mapped", 0.95, 0, "Revenue", "r1"), Candidate("b", 130, "analyst_confirmed", None, 1, "Sales", "r2")]}
    assert build_dataset([P2], cands, "USD", "thousands").get("p2", "revenue").value == 130


def test_significant_adjustments_flag():
    from deallens_worker.financial.red_flags import evaluate
    d = ds({("p2", "revenue"): 1000, ("p2", "ebitda"): 100})
    flags = evaluate(d, calculate(d), [{"financial_period_id": "p2", "amount": 15.0, "sign": 1, "status": "approved"}], [])
    assert any(f.rule_key == "significant_ebitda_adjustments" for f in flags)
    flags = evaluate(d, calculate(d), [{"financial_period_id": "p2", "amount": 5.0, "sign": 1, "status": "rejected"}], [])
    assert not any(f.rule_key == "significant_ebitda_adjustments" for f in flags)
