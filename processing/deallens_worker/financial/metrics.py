"""Financial metrics engine (formula version v1).

Every function returns MetricResult objects with the inputs used, the derivation path and the source
line-item ids, or an explicit 'unavailable' result with the reason. Nothing is estimated silently.
Definitions are documented in docs/financial-methodology.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .dataset import Dataset, PeriodInfo, Selected

FORMULA_VERSION = "v1"
DAYS_FALLBACK = {"annual": 365, "quarterly": 91, "monthly": 30}
MARGIN_DENOMINATOR_MIN = 1e-9


@dataclass
class MetricResult:
    key: str
    period_id: Optional[str]
    value: Optional[float]
    status: str                       # calculated | reported | warning | unavailable
    reason: Optional[str] = None
    inputs: dict = field(default_factory=dict)
    line_item_ids: list[str] = field(default_factory=list)
    is_ratio: bool = False


def _unavailable(key: str, pid: Optional[str], reason: str, **inputs) -> MetricResult:
    return MetricResult(key, pid, None, "unavailable", reason, inputs)


class Calculator:
    def __init__(self, ds: Dataset):
        self.ds = ds
        self.results: dict[tuple[str, Optional[str]], MetricResult] = {}

    # ---- helpers -----------------------------------------------------------------------------
    def v(self, pid: str, cat: str) -> Optional[Selected]:
        return self.ds.get(pid, cat)

    def m(self, key: str, pid: Optional[str]) -> Optional[MetricResult]:
        r = self.results.get((key, pid))
        return r if r and r.value is not None else None

    def put(self, r: MetricResult) -> MetricResult:
        self.results[(r.key, r.period_id)] = r
        return r

    @staticmethod
    def ids(*items) -> list[str]:
        out: list[str] = []
        for i in items:
            if isinstance(i, Selected):
                out += i.line_item_ids
            elif isinstance(i, MetricResult):
                out += i.line_item_ids
        return list(dict.fromkeys(out))

    def prior(self, p: PeriodInfo) -> Optional[PeriodInfo]:
        """The immediately preceding comparable period (same type, consecutive)."""
        actual = [x for x in self.ds.actual_periods() if x.period_type == p.period_type]
        idx = next((i for i, x in enumerate(actual) if x.id == p.id), None)
        return actual[idx - 1] if idx else None

    def days(self, p: PeriodInfo) -> tuple[Optional[int], str]:
        if p.days:
            return p.days, "actual calendar days in period"
        if p.period_type in DAYS_FALLBACK:
            return DAYS_FALLBACK[p.period_type], f"{DAYS_FALLBACK[p.period_type]}-day convention for {p.period_type} periods"
        return None, "period length unknown"

    # ---- calculation -------------------------------------------------------------------------
    def run(self) -> list[MetricResult]:
        periods = self.ds.actual_periods()
        for p in periods:
            self.income_statement(p)
        for p in periods:
            self.growth(p)
            self.balance_sheet(p)
            self.cash_flow(p)
        self.multi_period(periods)
        self.supporting(periods)
        self.forecast_variance()
        return list(self.results.values())

    def income_statement(self, p: PeriodInfo) -> None:
        pid = p.id
        rev, cogs, gp_rep = self.v(pid, "revenue"), self.v(pid, "cogs"), self.v(pid, "gross_profit")
        if rev:
            self.put(MetricResult("revenue", pid, rev.value, "reported", inputs={"revenue": rev.value}, line_item_ids=self.ids(rev)))
        else:
            self.put(_unavailable("revenue", pid, "No revenue line item mapped for this period."))

        # Gross profit: reported, else Revenue − COGS. Both are kept when available.
        if rev and cogs:
            calc = rev.value - cogs.value
            self.put(MetricResult("gross_profit_calculated", pid, calc, "calculated", inputs={"revenue": rev.value, "cogs": cogs.value,
                     "formula": "Revenue − COGS"}, line_item_ids=self.ids(rev, cogs)))
        if gp_rep:
            self.put(MetricResult("gross_profit", pid, gp_rep.value, "reported", inputs={"basis": "reported"}, line_item_ids=self.ids(gp_rep)))
        elif rev and cogs:
            self.put(MetricResult("gross_profit", pid, rev.value - cogs.value, "calculated",
                                  inputs={"basis": "calculated", "revenue": rev.value, "cogs": cogs.value}, line_item_ids=self.ids(rev, cogs)))
        else:
            self.put(_unavailable("gross_profit", pid, "Needs reported gross profit, or both revenue and cost of goods sold."))
        self.margin("gross_margin", pid, "gross_profit")

        # EBIT: reported, else bottom-up (NI + taxes + interest), else top-down (GP − opex − D&A).
        ebit_rep, d_and_a = self.v(pid, "ebit"), self.v(pid, "d_and_a")
        ni, tax, interest = self.v(pid, "net_income"), self.v(pid, "taxes"), self.v(pid, "interest_expense")
        interest_income = self.v(pid, "interest_income")
        gp = self.m("gross_profit", pid)
        if ebit_rep:
            self.put(MetricResult("ebit", pid, ebit_rep.value, "reported", inputs={"basis": "reported"}, line_item_ids=self.ids(ebit_rep)))
        elif ni and tax and interest:
            val = ni.value + tax.value + interest.value - (interest_income.value if interest_income else 0.0)
            self.put(MetricResult("ebit", pid, val, "calculated", inputs={"basis": "bottom_up", "net_income": ni.value, "taxes": tax.value,
                     "interest_expense": interest.value, "interest_income": interest_income.value if interest_income else 0.0,
                     "formula": "Net income + Taxes + Interest expense − Interest income"}, line_item_ids=self.ids(ni, tax, interest, interest_income)))
        elif gp and d_and_a:
            opex = [self.v(pid, c) for c in ("sga", "rnd", "other_operating_expenses")]
            present = [o for o in opex if o]
            if present:
                val = gp.value - sum(o.value for o in present) - d_and_a.value
                self.put(MetricResult("ebit", pid, val, "warning",
                         "Derived top-down from gross profit less operating expenses and D&A; completeness of operating expenses is not verified.",
                         inputs={"basis": "top_down", "gross_profit": gp.value, "operating_expenses": sum(o.value for o in present), "d_and_a": d_and_a.value},
                         line_item_ids=self.ids(gp, d_and_a, *present)))
            else:
                self.put(_unavailable("ebit", pid, "No operating expense lines mapped to derive EBIT."))
        else:
            self.put(_unavailable("ebit", pid, "Needs reported EBIT, or net income + taxes + interest, or gross profit, operating expenses and D&A."))
        self.margin("ebit_margin", pid, "ebit")

        # EBITDA: reported vs calculated are kept distinct; the selected EBITDA states its basis.
        ebitda_rep = self.v(pid, "ebitda")
        ebit = self.m("ebit", pid)
        if ebitda_rep:
            self.put(MetricResult("ebitda_reported", pid, ebitda_rep.value, "reported", line_item_ids=self.ids(ebitda_rep)))
        if ebit and d_and_a:
            self.put(MetricResult("ebitda_calculated", pid, ebit.value + d_and_a.value, "calculated",
                                  inputs={"ebit": ebit.value, "ebit_basis": ebit.inputs.get("basis"), "d_and_a": d_and_a.value, "formula": "EBIT + D&A"},
                                  line_item_ids=self.ids(ebit, d_and_a)))
        if ebitda_rep:
            self.put(MetricResult("ebitda", pid, ebitda_rep.value, "reported", inputs={"basis": "reported"}, line_item_ids=self.ids(ebitda_rep)))
        elif self.m("ebitda_calculated", pid):
            c = self.m("ebitda_calculated", pid)
            self.put(MetricResult("ebitda", pid, c.value, "calculated", inputs={"basis": "calculated", **c.inputs}, line_item_ids=c.line_item_ids))
        else:
            self.put(_unavailable("ebitda", pid, "Needs reported EBITDA, or EBIT and depreciation & amortisation."))
        self.margin("ebitda_margin", pid, "ebitda")

        if ni:
            self.put(MetricResult("net_income", pid, ni.value, "reported", line_item_ids=self.ids(ni)))
        else:
            self.put(_unavailable("net_income", pid, "No net income line item mapped."))
        self.margin("net_margin", pid, "net_income")

        if ebit and interest:
            if interest.value > 0:
                self.put(MetricResult("interest_coverage", pid, ebit.value / interest.value, "calculated", is_ratio=True,
                                      inputs={"ebit": ebit.value, "interest_expense": interest.value, "formula": "EBIT / Interest expense"},
                                      line_item_ids=self.ids(ebit, interest)))
            else:
                self.put(_unavailable("interest_coverage", pid, "Interest expense is zero; coverage is not meaningful."))
        else:
            self.put(_unavailable("interest_coverage", pid, "Needs EBIT and interest expense."))

    def margin(self, key: str, pid: str, numerator: str) -> None:
        num, rev = self.m(numerator, pid), self.m("revenue", pid)
        if not num or not rev:
            self.put(_unavailable(key, pid, f"Needs {numerator.replace('_', ' ')} and revenue."))
        elif rev.value <= MARGIN_DENOMINATOR_MIN:
            self.put(_unavailable(key, pid, "Revenue is zero or negative; margin is not meaningful."))
        else:
            self.put(MetricResult(key, pid, num.value / rev.value, num.status if num.status == "warning" else "calculated", num.reason,
                                  inputs={numerator: num.value, "revenue": rev.value, "formula": f"{numerator} / revenue"},
                                  line_item_ids=self.ids(num, rev), is_ratio=True))

    def growth(self, p: PeriodInfo) -> None:
        prev = self.prior(p)
        for key, base in (("revenue_growth", "revenue"), ("ebitda_growth", "ebitda"), ("net_income_growth", "net_income")):
            cur = self.m(base, p.id)
            if not prev:
                self.put(_unavailable(key, p.id, "No prior comparable period of the same length."))
                continue
            old = self.m(base, prev.id)
            if not cur or not old:
                self.put(_unavailable(key, p.id, f"Needs {base.replace('_', ' ')} in both periods."))
            elif old.value <= 0:
                self.put(_unavailable(key, p.id, f"Prior-period {base.replace('_', ' ')} is zero or negative; percentage growth is not meaningful."))
            else:
                self.put(MetricResult(key, p.id, cur.value / old.value - 1, "calculated", is_ratio=True,
                                      inputs={"current": cur.value, "prior": old.value, "prior_period": prev.label, "formula": "current / prior − 1"},
                                      line_item_ids=self.ids(cur, old)))
        for key in ("gross_margin", "ebitda_margin", "ebit_margin", "net_margin"):
            cur = self.m(key, p.id)
            old = self.m(key, prev.id) if prev else None
            if cur and old:
                self.put(MetricResult(f"{key}_change", p.id, cur.value - old.value, "calculated", is_ratio=True,
                                      inputs={"current": cur.value, "prior": old.value, "prior_period": prev.label, "unit": "percentage points (fraction)"},
                                      line_item_ids=self.ids(cur, old)))

    def _avg(self, p: PeriodInfo, cat: str) -> tuple[Optional[float], list[str], str]:
        cur = self.v(p.id, cat)
        if not cur:
            return None, [], ""
        prev = self.prior(p)
        old = self.v(prev.id, cat) if prev else None
        if old:
            return (cur.value + old.value) / 2, self.ids(cur, old), "average of opening and closing balances"
        return cur.value, self.ids(cur), "closing balance (no prior period available for averaging)"

    def balance_sheet(self, p: PeriodInfo) -> None:
        pid = p.id
        ca, cl = self.v(pid, "total_current_assets"), self.v(pid, "total_current_liabilities")
        cash, ar, inv, ap = (self.v(pid, c) for c in ("cash", "accounts_receivable", "inventory", "accounts_payable"))
        std, ltd = self.v(pid, "short_term_debt"), self.v(pid, "long_term_debt")

        if ca and cl:
            self.put(MetricResult("net_working_capital", pid, ca.value - cl.value, "calculated",
                                  inputs={"current_assets": ca.value, "current_liabilities": cl.value, "formula": "Current assets − Current liabilities"},
                                  line_item_ids=self.ids(ca, cl)))
            op_ca = ca.value - (cash.value if cash else 0.0)
            op_cl = cl.value - (std.value if std else 0.0)
            self.put(MetricResult("operating_working_capital", pid, op_ca - op_cl, "calculated" if cash else "warning",
                                  None if cash else "Cash not reported; current assets used without excluding cash.",
                                  inputs={"current_assets_ex_cash": op_ca, "current_liabilities_ex_debt": op_cl,
                                          "formula": "(Current assets − Cash) − (Current liabilities − Short-term debt)"},
                                  line_item_ids=self.ids(ca, cl, cash, std)))
        else:
            self.put(_unavailable("net_working_capital", pid, "Needs total current assets and total current liabilities."))

        if ar and ap:
            inv_val = inv.value if inv else 0.0
            self.put(MetricResult("trade_working_capital", pid, ar.value + inv_val - ap.value, "calculated" if inv else "warning",
                                  None if inv else "Inventory not reported; treated as nil.",
                                  inputs={"accounts_receivable": ar.value, "inventory": inv_val, "accounts_payable": ap.value,
                                          "formula": "Accounts receivable + Inventory − Accounts payable"}, line_item_ids=self.ids(ar, inv, ap)))
        else:
            self.put(_unavailable("trade_working_capital", pid, "Needs accounts receivable and accounts payable."))

        days, convention = self.days(p)
        rev, cogs = self.m("revenue", pid), self.v(pid, "cogs")
        for key, cat, denom, denom_name in (("dso", "accounts_receivable", rev, "revenue"), ("dio", "inventory", cogs, "cogs"), ("dpo", "accounts_payable", cogs, "cogs")):
            avg, ids, basis = self._avg(p, cat)
            if avg is None:
                self.put(_unavailable(key, pid, f"No {cat.replace('_', ' ')} balance mapped."))
            elif denom is None:
                self.put(_unavailable(key, pid, f"Needs {denom_name} for the period."))
            elif denom.value <= 0:
                self.put(_unavailable(key, pid, f"{denom_name.upper() if denom_name == 'cogs' else 'Revenue'} is zero or negative; days metric is not meaningful."))
            elif days is None:
                self.put(_unavailable(key, pid, "Period length is unknown."))
            else:
                self.put(MetricResult(key, pid, avg / denom.value * days, "calculated",
                                      inputs={"average_balance": avg, "balance_basis": basis, denom_name: denom.value, "days": days,
                                              "days_convention": convention, "formula": f"Average {cat.replace('_', ' ')} / {denom_name} × days"},
                                      line_item_ids=ids + self.ids(denom)))
        dso, dio, dpo = self.m("dso", pid), self.m("dio", pid), self.m("dpo", pid)
        if dso and dpo:
            no_inventory = dio is None
            self.put(MetricResult("cash_conversion_cycle", pid, dso.value + (dio.value if dio else 0.0) - dpo.value,
                                  "warning" if no_inventory else "calculated", "DIO unavailable; treated as zero." if no_inventory else None,
                                  inputs={"dso": dso.value, "dio": dio.value if dio else None, "dpo": dpo.value, "formula": "DSO + DIO − DPO"},
                                  line_item_ids=self.ids(dso, dio, dpo)))
        else:
            self.put(_unavailable("cash_conversion_cycle", pid, "Needs DSO and DPO."))

        # Debt: only explicitly mapped borrowings. Leases and other liabilities are NOT assumed to be debt.
        if std or ltd:
            gross = (std.value if std else 0.0) + (ltd.value if ltd else 0.0)
            partial = not (std and ltd)
            self.put(MetricResult("gross_debt", pid, gross, "warning" if partial else "calculated",
                                  f"Only {'short-term' if std else 'long-term'} debt is reported; the other component is treated as nil." if partial else None,
                                  inputs={"short_term_debt": std.value if std else None, "long_term_debt": ltd.value if ltd else None,
                                          "excludes": "lease liabilities and non-interest-bearing liabilities"}, line_item_ids=self.ids(std, ltd)))
        else:
            self.put(_unavailable("gross_debt", pid, "No borrowings mapped. Liabilities are not assumed to be interest-bearing debt."))
        if cash:
            self.put(MetricResult("cash", pid, cash.value, "reported", line_item_ids=self.ids(cash)))
        gd = self.m("gross_debt", pid)
        if gd and cash:
            self.put(MetricResult("net_debt", pid, gd.value - cash.value, gd.status, gd.reason,
                                  inputs={"gross_debt": gd.value, "cash": cash.value, "formula": "Gross debt − Cash and cash equivalents"},
                                  line_item_ids=self.ids(gd, cash)))
        else:
            self.put(_unavailable("net_debt", pid, "Needs gross debt and cash."))
        ebitda = self.m("ebitda", pid)
        for key, base in (("debt_to_ebitda", "gross_debt"), ("net_debt_to_ebitda", "net_debt")):
            b = self.m(base, pid)
            if not b or not ebitda:
                self.put(_unavailable(key, pid, f"Needs {base.replace('_', ' ')} and EBITDA."))
            elif p.period_type != "annual":
                self.put(_unavailable(key, pid, "Leverage requires annual (or LTM) EBITDA; this period is not annual."))
            elif ebitda.value <= 0:
                self.put(_unavailable(key, pid, "EBITDA is zero or negative; leverage multiple is not meaningful."))
            else:
                self.put(MetricResult(key, pid, b.value / ebitda.value, "calculated", is_ratio=True,
                                      inputs={base: b.value, "ebitda": ebitda.value, "ebitda_basis": ebitda.inputs.get("basis"), "formula": f"{base} / EBITDA"},
                                      line_item_ids=self.ids(b, ebitda)))

    def cash_flow(self, p: PeriodInfo) -> None:
        pid = p.id
        for key in ("operating_cash_flow", "investing_cash_flow", "financing_cash_flow"):
            s = self.v(pid, key)
            self.put(MetricResult(key, pid, s.value, "reported", line_item_ids=self.ids(s)) if s else _unavailable(key, pid, "Not reported in the cash flow statement."))
        capex = self.v(pid, "capex")
        if capex:
            self.put(MetricResult("capex", pid, capex.value, "reported", inputs={"sign": "positive magnitude"}, line_item_ids=self.ids(capex)))
        else:
            self.put(_unavailable("capex", pid, "Capital expenditure not identified."))
        ocf = self.m("operating_cash_flow", pid)
        if ocf and capex:
            self.put(MetricResult("free_cash_flow", pid, ocf.value - capex.value, "calculated",
                                  inputs={"operating_cash_flow": ocf.value, "capex": capex.value, "formula": "Operating cash flow − Capital expenditure",
                                          "definition_note": "One of several FCF definitions; excludes lease payments and interest reclassification."},
                                  line_item_ids=self.ids(ocf, capex)))
        else:
            self.put(_unavailable("free_cash_flow", pid, "Needs operating cash flow and capital expenditure."))
        ebitda = self.m("ebitda", pid)
        for key, base in (("ocf_to_ebitda", "operating_cash_flow"), ("fcf_conversion", "free_cash_flow")):
            b = self.m(base, pid)
            if b and ebitda and ebitda.value > 0:
                self.put(MetricResult(key, pid, b.value / ebitda.value, "calculated", is_ratio=True,
                                      inputs={base: b.value, "ebitda": ebitda.value, "formula": f"{base} / EBITDA"}, line_item_ids=self.ids(b, ebitda)))
            else:
                self.put(_unavailable(key, pid, "Needs positive EBITDA and the cash flow measure."))

    def multi_period(self, periods: list[PeriodInfo]) -> None:
        annual = [p for p in periods if p.period_type == "annual" and self.m("revenue", p.id)]
        if len(annual) < 2:
            if periods:
                self.put(_unavailable("revenue_cagr", periods[-1].id, "Needs revenue for at least two annual periods."))
            return
        first, last = annual[0], annual[-1]
        years = len(annual) - 1
        r0, r1 = self.m("revenue", first.id), self.m("revenue", last.id)
        gaps = [(b.end.year - a.end.year) for a, b in zip(annual, annual[1:]) if a.end and b.end]
        if any(g != 1 for g in gaps):
            self.put(_unavailable("revenue_cagr", last.id, "Annual periods are not consecutive."))
        elif r0.value <= 0 or r1.value <= 0:
            self.put(_unavailable("revenue_cagr", last.id, "CAGR requires positive revenue in the first and last periods."))
        else:
            self.put(MetricResult("revenue_cagr", last.id, (r1.value / r0.value) ** (1 / years) - 1, "calculated", is_ratio=True,
                                  inputs={"first_period": first.label, "last_period": last.label, "first": r0.value, "last": r1.value, "years": years,
                                          "formula": "(last / first)^(1/years) − 1"}, line_item_ids=self.ids(r0, r1)))

    def supporting(self, periods: list[PeriodInfo]) -> None:
        for p in periods:
            customers = {k: v for k, v in self.ds.values.get(p.id, {}).items() if k.startswith("customer_revenue")}
            rev = self.m("revenue", p.id)
            if customers and rev and rev.value > 0:
                vals = sorted((v.value for v in customers.values()), reverse=True)
                self.put(MetricResult("top_customer_share", p.id, vals[0] / rev.value, "calculated", is_ratio=True,
                                      inputs={"top_customer_revenue": vals[0], "revenue": rev.value}))
                self.put(MetricResult("top5_customer_share", p.id, sum(vals[:5]) / rev.value, "calculated", is_ratio=True,
                                      inputs={"top5_revenue": sum(vals[:5]), "revenue": rev.value}))

    def forecast_variance(self) -> None:
        actual = {p.end: p for p in self.ds.periods if p.scenario == "actual" and p.end}
        for p in self.ds.periods:
            if p.scenario in ("budget", "forecast") and p.end in actual:
                a = self.v(actual[p.end].id, "revenue")
                f = self.v(p.id, "revenue")
                if a and f and f.value:
                    self.put(MetricResult(f"revenue_vs_{p.scenario}", actual[p.end].id, a.value / f.value - 1, "calculated", is_ratio=True,
                                          inputs={"actual": a.value, p.scenario: f.value, "comparison_period": p.label, "formula": "actual / plan − 1"},
                                          line_item_ids=self.ids(a, f)))


def calculate(ds: Dataset) -> list[MetricResult]:
    return Calculator(ds).run()
