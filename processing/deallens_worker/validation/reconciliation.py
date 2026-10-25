"""Statement reconciliations. A check whose inputs are missing is 'not_tested' — never 'reconciled'."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..financial.dataset import Dataset, PeriodInfo, tolerance


@dataclass
class Reconciliation:
    check_key: str
    period_id: str
    period_label: str
    status: str                      # reconciled | variance | not_tested
    lhs: Optional[float] = None
    rhs: Optional[float] = None
    variance: Optional[float] = None
    tolerance: Optional[float] = None
    details: dict = field(default_factory=dict)


def balance_sheet(ds: Dataset, p: PeriodInfo) -> Reconciliation:
    assets = ds.get(p.id, "total_assets")
    tle = ds.get(p.id, "total_liabilities_and_equity")
    liab, eq = ds.get(p.id, "total_liabilities"), ds.get(p.id, "equity")
    if not assets:
        return Reconciliation("balance_sheet", p.id, p.label, "not_tested", details={"reason": "Total assets not reported."})
    if liab and eq:
        rhs, basis, refs = liab.value + eq.value, "total liabilities + total equity", [liab.reference, eq.reference]
    elif tle:
        rhs, basis, refs = tle.value, "total liabilities and equity (reported)", [tle.reference]
    else:
        return Reconciliation("balance_sheet", p.id, p.label, "not_tested", lhs=assets.value,
                              details={"reason": "Total liabilities and equity are not both reported."})
    var = assets.value - rhs
    tol = tolerance(assets.value, rhs)
    return Reconciliation("balance_sheet", p.id, p.label, "reconciled" if abs(var) <= tol else "variance", assets.value, rhs, var, tol,
                          {"formula": "Assets = Liabilities + Equity", "rhs_basis": basis, "references": [assets.reference, *refs]})


def cash_roll_forward(ds: Dataset, p: PeriodInfo, prior: Optional[PeriodInfo]) -> Reconciliation:
    change, ending = ds.get(p.id, "change_in_cash"), ds.get(p.id, "ending_cash") or ds.get(p.id, "cash")
    beginning = ds.get(p.id, "beginning_cash")
    basis = "beginning cash reported in cash flow statement"
    if not beginning and prior:
        beginning = ds.get(prior.id, "ending_cash") or ds.get(prior.id, "cash")
        basis = f"prior period ({prior.label}) closing cash"
    if not (change and ending and beginning):
        missing = [n for n, v in (("beginning cash", beginning), ("net change in cash", change), ("ending cash", ending)) if not v]
        return Reconciliation("cash_roll_forward", p.id, p.label, "not_tested", details={"reason": f"Missing: {', '.join(missing)}."})
    lhs = beginning.value + change.value
    var = lhs - ending.value
    tol = tolerance(lhs, ending.value)
    return Reconciliation("cash_roll_forward", p.id, p.label, "reconciled" if abs(var) <= tol else "variance", lhs, ending.value, var, tol,
                          {"formula": "Beginning cash + Net change in cash = Ending cash", "beginning_basis": basis,
                           "references": [beginning.reference, change.reference, ending.reference]})


def run(ds: Dataset) -> list[Reconciliation]:
    out = []
    periods = ds.actual_periods()
    for i, p in enumerate(periods):
        prior = next((q for q in reversed(periods[:i]) if q.period_type == p.period_type), None)
        out.append(balance_sheet(ds, p))
        out.append(cash_roll_forward(ds, p, prior))
    return out
