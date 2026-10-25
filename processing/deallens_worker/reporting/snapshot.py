"""Builds the client-safe content snapshot for a report.

Only these sources are read: company and submission metadata, actual-period metrics of the current analysis
version, reconciliations, client-visible data-quality issues, APPROVED client-visible findings, APPROVED EBITDA
adjustments and APPROVED valuation models. Red flags, internal findings, comments, review notes, rationales of
rejected items and analyst names other than the approver are never queried, so they cannot leak into the PDF,
its metadata, filenames or logs.
"""
from __future__ import annotations

from datetime import datetime, timezone

SECTION_KEYS = [
    "executive_summary", "scope_methodology", "overview", "data_quality", "revenue", "profitability", "ebitda",
    "working_capital", "debt_cash_flow", "findings", "valuation", "limitations", "appendix",
]

METRIC_KEYS = {
    "revenue": ["revenue", "revenue_growth", "revenue_cagr", "top_customer_share"],
    "profitability": ["gross_profit", "gross_margin", "ebitda", "ebitda_reported", "ebitda_calculated", "ebitda_margin", "ebit", "ebit_margin", "net_income", "net_margin"],
    "working_capital": ["net_working_capital", "trade_working_capital", "dso", "dio", "dpo", "cash_conversion_cycle"],
    "debt_cash_flow": ["gross_debt", "cash", "net_debt", "net_debt_to_ebitda", "interest_coverage", "operating_cash_flow", "capex", "free_cash_flow", "ocf_to_ebitda"],
}


def _f(v):
    return None if v is None else float(v)


def build(cur, report: dict) -> dict:
    sid = report["submission_id"]
    cfg = report["config"] or {}
    sections = [s for s in cfg.get("sections", SECTION_KEYS) if s in SECTION_KEYS]
    cur.execute("""select s.submission_name, s.deal_type, s.reporting_period_start, s.reporting_period_end, s.reporting_currency, s.reporting_unit,
                          s.current_analysis_version, s.is_synthetic, c.display_name, c.legal_name, c.industry, c.country, c.is_synthetic as company_synthetic
                   from public.submissions s join public.companies c on c.id = s.company_id where s.id = %s""", (sid,))
    s = cur.fetchone()
    version = s["current_analysis_version"]
    cur.execute("""select id, period_label from public.financial_periods where submission_id = %s and scenario = 'actual' order by sort_order""", (sid,))
    periods = cur.fetchall()
    pid_label = {str(p["id"]): p["period_label"] for p in periods}
    wanted = sorted({k for sec, keys in METRIC_KEYS.items() if sec in sections for k in keys} | {"revenue", "ebitda", "ebitda_margin"})
    cur.execute("""select financial_period_id, metric_key, metric_value, metric_status, status_reason, calculation_inputs->>'basis' as basis
                   from public.financial_metrics where submission_id = %s and analysis_version = %s and metric_key = any(%s)""", (sid, version, wanted))
    metrics: dict = {}
    for m in cur.fetchall():
        label = pid_label.get(str(m["financial_period_id"]))
        if label:
            metrics.setdefault(m["metric_key"], {})[label] = {"value": _f(m["metric_value"]), "status": m["metric_status"], "reason": m["status_reason"], "basis": m["basis"]}
    cur.execute("""select r.check_key, r.status, r.variance, fp.period_label, r.details->>'reason' as reason from public.reconciliations r
                   left join public.financial_periods fp on fp.id = r.financial_period_id where r.submission_id = %s and r.analysis_version = %s""", (sid, version))
    recs = [dict(r) | {"variance": _f(r["variance"])} for r in cur.fetchall()]
    cur.execute("""select severity, title, status, suggested_resolution, resolution_notes from public.data_quality_issues
                   where submission_id = %s and client_visible order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end""", (sid,))
    dq = [dict(r) for r in cur.fetchall()]
    cur.execute("""select reference_code, category, title, description, severity, quantified_impact, impact_currency, recommendation, source_references
                   from public.findings where submission_id = %s and visibility = 'client_visible' and status in ('approved', 'closed') order by reference_code""", (sid,))
    findings = [dict(r) | {"quantified_impact": _f(r["quantified_impact"])} for r in cur.fetchall()]
    include = cfg.get("finding_codes")
    if include:
        findings = [f for f in findings if f["reference_code"] in include]
    cur.execute("""select a.adjustment_type, a.description, a.amount, a.sign, fp.period_label from public.ebitda_adjustments a
                   join public.financial_periods fp on fp.id = a.financial_period_id where a.submission_id = %s and a.status = 'approved' order by fp.sort_order""", (sid,))
    adjustments = [{"type": a["adjustment_type"], "description": a["description"], "amount": float(a["amount"]) * a["sign"], "period": a["period_label"]} for a in cur.fetchall()]
    cur.execute("""select distinct on (model_name) model_name, model_version, valuation_method, assumptions, calculation_outputs, currency
                   from public.valuation_models where submission_id = %s and review_status = 'approved' order by model_name, model_version desc""", (sid,))
    valuations = []
    for v in cur.fetchall():
        out = v["calculation_outputs"]
        if v["valuation_method"] == "dcf":
            ev, eq = out["scenarios"]["enterpriseValue"], out["scenarios"]["equityValue"]
            assumptions = {k: v["assumptions"].get(k) for k in ("wacc", "terminalGrowth", "taxRate", "years", "midYear")}
        else:
            ev, eq = out["impliedEnterpriseValue"], out["impliedEquityValue"]
            assumptions = {"multiple": v["assumptions"].get("multiple"), "selection": v["assumptions"].get("selection"),
                           "comparables_used": v["assumptions"].get("includedComparables"), "selected_multiples": out.get("selectedMultiples")}
        valuations.append({"name": v["model_name"], "version": v["model_version"], "method": v["valuation_method"], "currency": v["currency"],
                           "enterprise_value": ev, "equity_value": eq, "assumptions": assumptions, "warnings": out.get("warnings", [])})
    return {
        "schema": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "report": {"title": report["report_title"], "version": report["report_version"], "type": report["report_type"]},
        "sections": sections,
        "executive_summary": (cfg.get("executive_summary") or "").strip(),
        "additional_limitations": (cfg.get("limitations") or "").strip(),
        "company": {"display_name": s["display_name"], "legal_name": s["legal_name"], "industry": s["industry"], "country": s["country"],
                    "is_synthetic": bool(s["company_synthetic"] or s["is_synthetic"])},
        "submission": {"name": s["submission_name"], "deal_type": s["deal_type"], "period_start": s["reporting_period_start"].isoformat(),
                       "period_end": s["reporting_period_end"].isoformat(), "currency": s["reporting_currency"], "unit": s["reporting_unit"],
                       "analysis_version": version},
        "periods": [p["period_label"] for p in periods],
        "metrics": metrics,
        "reconciliations": recs,
        "data_quality": dq,
        "findings": findings,
        "ebitda_adjustments": adjustments,
        "valuations": valuations,
    }
