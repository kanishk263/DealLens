"""Deterministic, explainable red-flag rules. Thresholds come from config/thresholds.json.

A red flag indicates a matter requiring investigation; it is not evidence of misconduct."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .dataset import Dataset, PeriodInfo
from .metrics import MetricResult

CONFIG = json.loads((Path(__file__).resolve().parents[2] / "config" / "thresholds.json").read_text())["red_flags"]


@dataclass
class RedFlag:
    rule_key: str
    title: str
    category: str
    severity: str
    triggering_rule: str
    observed_value: Optional[float]
    comparison_value: Optional[float]
    threshold: dict
    source_period: Optional[str]
    explanation: str
    recommended_follow_up: str
    source_references: list = field(default_factory=list)


class Engine:
    def __init__(self, ds: Dataset, metrics: list[MetricResult], adjustments: list[dict], reconciliations: list):
        self.ds = ds
        self.m = {(r.key, r.period_id): r for r in metrics if r.value is not None}
        self.adjustments = adjustments
        self.recs = reconciliations
        self.periods = ds.actual_periods()
        self.flags: list[RedFlag] = []

    def val(self, key: str, p: PeriodInfo) -> Optional[float]:
        r = self.m.get((key, p.id))
        return r.value if r else None

    def refs(self, *pairs) -> list[dict]:
        out = []
        for key, p in pairs:
            r = self.m.get((key, p.id))
            if r:
                out.append({"metric": key, "period": p.label, "line_item_ids": r.line_item_ids[:10]})
        return out

    def cfg(self, key: str) -> dict:
        c = CONFIG[key]
        return {k: v for k, v in c.items() if k not in ("rationale",)} | {"rationale": c["rationale"]}

    def add(self, key: str, title: str, category: str, rule: str, observed, comparison, period: Optional[PeriodInfo], explanation: str,
            follow_up: str, refs: list, suffix: Optional[str] = None) -> None:
        c = CONFIG[key]
        self.flags.append(RedFlag(f"{key}:{suffix}" if suffix else key, title, category, c["severity"], rule, observed, comparison, self.cfg(key),
                                  period.label if period else None, explanation, follow_up, refs))

    def pairs(self):
        for a, b in zip(self.periods, self.periods[1:]):
            if a.period_type == b.period_type:
                yield a, b

    def run(self) -> list[RedFlag]:
        self.revenue_decline()
        self.margins()
        self.cash_quality()
        self.working_capital()
        self.leverage()
        self.movements()
        self.adjustment_size()
        self.reconciliation_failures()
        self.data_gaps()
        self.concentration()
        self.recalc_discrepancy()
        return self.flags

    def revenue_decline(self):
        n = CONFIG["revenue_decline_consecutive"]["periods"]
        streak: list[PeriodInfo] = []
        for a, b in self.pairs():
            ra, rb = self.val("revenue", a), self.val("revenue", b)
            if ra is not None and rb is not None and rb < ra:
                streak.append(b)
                if len(streak) >= n:
                    first = self.val("revenue", self.periods[self.periods.index(streak[0]) - 1])
                    self.add("revenue_decline_consecutive", "Revenue declining over consecutive periods", "revenue",
                             f"Revenue lower than the prior comparable period for {n}+ consecutive periods", rb, first, b,
                             f"Revenue fell in {len(streak)} consecutive periods to {rb:,.0f}.",
                             "Analyse revenue by customer, product and price/volume; obtain management's explanation.", self.refs(("revenue", a), ("revenue", b)))
            else:
                streak = []

    def margins(self):
        for key, metric, label in (("gross_margin_deterioration", "gross_margin", "Gross margin"), ("ebitda_margin_deterioration", "ebitda_margin", "EBITDA margin")):
            pp = CONFIG[key]["pp"]
            for a, b in self.pairs():
                ma, mb = self.val(metric, a), self.val(metric, b)
                if ma is not None and mb is not None and ma - mb >= pp:
                    self.add(key, f"{label} deteriorated materially", "profitability", f"{label} fell by ≥ {pp * 100:.1f} percentage points",
                             mb, ma, b, f"{label} moved from {ma:.1%} in {a.label} to {mb:.1%} in {b.label}.",
                             "Investigate pricing, input costs, mix and one-off items behind the margin movement.", self.refs((metric, a), (metric, b)))

    def cash_quality(self):
        c = CONFIG["ocf_below_ebitda"]
        low = [p for p in self.periods if (r := self.val("ocf_to_ebitda", p)) is not None and r < c["ratio"]]
        if len(low) >= c["periods"]:
            p = low[-1]
            self.add("ocf_below_ebitda", "Operating cash flow persistently below EBITDA", "cash_flow",
                     f"OCF / EBITDA below {c['ratio']:.0%} in {c['periods']}+ periods", self.val("ocf_to_ebitda", p), c["ratio"], p,
                     f"Operating cash flow was below {c['ratio']:.0%} of EBITDA in {len(low)} period(s): {', '.join(x.label for x in low)}.",
                     "Reconcile EBITDA to operating cash flow; examine working-capital movements and non-cash income.", self.refs(*[("ocf_to_ebitda", x) for x in low]))
        n = CONFIG["negative_fcf"]["periods"]
        neg = [p for p in self.periods if (v := self.val("free_cash_flow", p)) is not None and v < 0]
        if len(neg) >= n:
            p = neg[-1]
            self.add("negative_fcf", "Negative free cash flow over multiple periods", "cash_flow", f"Free cash flow < 0 in {n}+ periods",
                     self.val("free_cash_flow", p), 0.0, p, f"Free cash flow was negative in {', '.join(x.label for x in neg)}.",
                     "Assess funding requirements, capex commitments and liquidity headroom.", self.refs(*[("free_cash_flow", x) for x in neg]))

    def working_capital(self):
        for key, cat, label in (("receivables_outpacing_revenue", "accounts_receivable", "Receivables"), ("inventory_outpacing_revenue", "inventory", "Inventory")):
            pp = CONFIG[key]["pp"]
            for a, b in self.pairs():
                xa, xb = self.ds.get(a.id, cat), self.ds.get(b.id, cat)
                ra, rb = self.val("revenue", a), self.val("revenue", b)
                if xa and xb and ra and rb and xa.value > 0 and ra > 0:
                    g_x, g_r = xb.value / xa.value - 1, rb / ra - 1
                    if g_x - g_r >= pp:
                        self.add(key, f"{label} growing significantly faster than revenue", "working_capital",
                                 f"{label} growth exceeds revenue growth by ≥ {pp * 100:.0f} percentage points", g_x, g_r, b,
                                 f"{label} grew {g_x:+.1%} while revenue grew {g_r:+.1%} ({a.label} → {b.label}).",
                                 "Review ageing, credit terms, provisions and cut-off." if cat == "accounts_receivable" else "Review inventory ageing, obsolescence provisions and stock counts.",
                                 [{"reference": xa.reference}, {"reference": xb.reference}])
        pct = CONFIG["working_capital_absorption"]["pct_of_revenue"]
        for a, b in self.pairs():
            ta, tb, rb = self.val("trade_working_capital", a), self.val("trade_working_capital", b), self.val("revenue", b)
            if ta is not None and tb is not None and rb and rb > 0 and (tb - ta) / rb > pct:
                self.add("working_capital_absorption", "Working capital absorbing more cash", "working_capital",
                         f"Increase in trade working capital > {pct:.0%} of revenue", (tb - ta) / rb, pct, b,
                         f"Trade working capital increased by {tb - ta:,.0f} ({(tb - ta) / rb:.1%} of revenue) between {a.label} and {b.label}.",
                         "Consider a normalised working-capital target and its effect on the purchase price mechanism.",
                         self.refs(("trade_working_capital", a), ("trade_working_capital", b)))

    def leverage(self):
        x = CONFIG["high_leverage"]["multiple"]
        for p in self.periods:
            v = self.val("net_debt_to_ebitda", p)
            if v is not None and v > x:
                self.add("high_leverage", "High leverage relative to EBITDA", "debt", f"Net debt / EBITDA > {x}x", v, x, p,
                         f"Net debt is {v:.1f}x EBITDA in {p.label}.", "Review debt terms, covenants, maturities and refinancing risk.",
                         self.refs(("net_debt_to_ebitda", p)))

    def movements(self):
        c = CONFIG["large_unexplained_movement"]
        for a, b in self.pairs():
            rev = self.val("revenue", b)
            for cat in ("cogs", "sga", "other_operating_expenses", "accounts_receivable", "inventory", "accounts_payable"):
                xa, xb = self.ds.get(a.id, cat), self.ds.get(b.id, cat)
                if xa and xb and xa.value and rev and rev > 0:
                    change = xb.value / xa.value - 1
                    if abs(change) > c["pct"] and abs(xb.value - xa.value) / rev > c["min_pct_of_revenue"]:
                        self.add("large_unexplained_movement", f"Large movement in {cat.replace('_', ' ')}", "other",
                                 f"Change > {c['pct']:.0%} and > {c['min_pct_of_revenue']:.0%} of revenue", change, c["pct"], b,
                                 f"{xa.label} changed by {change:+.0%} from {a.label} to {b.label}. The driver cannot be established from the data provided.",
                                 "Area for investigation: obtain management's explanation and supporting analysis.",
                                 [{"reference": xa.reference}, {"reference": xb.reference}], suffix=cat)

    def adjustment_size(self):
        pct = CONFIG["significant_ebitda_adjustments"]["pct_of_ebitda"]
        by_period: dict[str, float] = {}
        for adj in self.adjustments:
            if adj["status"] in ("proposed", "approved"):
                by_period[adj["financial_period_id"]] = by_period.get(adj["financial_period_id"], 0.0) + abs(adj["amount"])
        for p in self.periods:
            e = self.val("ebitda", p)
            total = by_period.get(p.id)
            if total and e and e > 0 and total / e > pct:
                self.add("significant_ebitda_adjustments", "Significant EBITDA adjustments", "ebitda",
                         f"Proposed/approved adjustments > {pct:.0%} of reported EBITDA", total / e, pct, p,
                         f"Adjustments total {total:,.0f}, {total / e:.1%} of EBITDA in {p.label}.",
                         "Ensure each adjustment is supported by evidence and is genuinely non-recurring.", self.refs(("ebitda", p)))

    def reconciliation_failures(self):
        for rec in self.recs:
            if rec.status == "variance" and rec.check_key == "balance_sheet":
                period = next((p for p in self.periods if p.id == rec.period_id), None)
                self.add_static("bs_reconciliation_failure", "Balance sheet reconciliation failure", "data_quality", "high",
                                "Total assets ≠ total liabilities + equity beyond rounding tolerance", rec.lhs, rec.rhs, period,
                                f"Variance of {rec.variance:,.1f} in {rec.period_label}.", "Resolve mapping or source errors before relying on balance-sheet metrics.",
                                [{"reference": r} for r in rec.details.get("references", [])])

    def add_static(self, key, title, category, severity, rule, observed, comparison, period, explanation, follow_up, refs):
        self.flags.append(RedFlag(key, title, category, severity, rule, observed, comparison,
                                  {"rationale": "Arithmetic integrity check; tolerance is one presentation unit or 0.1%."},
                                  period.label if period else None, explanation, follow_up, refs))

    def data_gaps(self):
        statements = {k for pid in self.ds.values for k in self.ds.values[pid]}
        missing = [n for n, keys in (("income statement", {"revenue", "net_income", "ebit"}), ("balance sheet", {"total_assets", "cash"}),
                                     ("cash flow", {"operating_cash_flow"})) if not (statements & keys)]
        if missing or len(self.periods) < 2:
            reasons = ([f"missing {', '.join(missing)}"] if missing else []) + (["fewer than two historical periods"] if len(self.periods) < 2 else [])
            self.add_static("material_data_gaps", "Material data gaps", "data_quality", "medium", "Required statements or periods missing",
                            None, None, self.periods[-1] if self.periods else None, f"Analysis is limited: {'; '.join(reasons)}.",
                            "Request the missing information before drawing conclusions.", [])

    def concentration(self):
        c = CONFIG["customer_concentration"]
        for p in self.periods:
            t1, t5 = self.val("top_customer_share", p), self.val("top5_customer_share", p)
            if (t1 is not None and t1 > c["top1"]) or (t5 is not None and t5 > c["top5"]):
                self.add("customer_concentration", "Customer concentration risk", "revenue",
                         f"Top customer > {c['top1']:.0%} or top five > {c['top5']:.0%} of revenue", t1, c["top1"], p,
                         f"Top customer {t1:.1%}" + (f", top five {t5:.1%}" if t5 is not None else "") + f" of revenue in {p.label}.",
                         "Review contract terms, renewal dates and churn history for key customers.", self.refs(("top_customer_share", p)))

    def recalc_discrepancy(self):
        pct = CONFIG["reported_vs_recalculated"]["pct"]
        for p in self.periods:
            for rep, calc, label in (("gross_profit", "gross_profit_calculated", "Gross profit"), ("ebitda_reported", "ebitda_calculated", "EBITDA")):
                r = self.m.get((rep, p.id))
                c = self.val(calc, p)
                if r and r.status == "reported" and c is not None and r.value and abs(c / r.value - 1) > pct:
                    self.add("reported_vs_recalculated", f"{label}: reported vs recalculated discrepancy", "data_quality",
                             f"Difference > {pct:.0%}", r.value, c, p,
                             f"Reported {label.lower()} {r.value:,.0f} vs recalculated {c:,.0f} ({c / r.value - 1:+.1%}) in {p.label}.",
                             "Check the definition used by the company and the completeness of mapped components.", self.refs((rep, p), (calc, p)), suffix=rep)


def evaluate(ds: Dataset, metrics: list[MetricResult], adjustments: list[dict], reconciliations: list) -> list[RedFlag]:
    return Engine(ds, metrics, adjustments, reconciliations).run()
