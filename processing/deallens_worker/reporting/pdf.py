"""Server-side PDF rendering of a report snapshot (ReportLab platypus).

The renderer only reads the snapshot dict, so the PDF can contain nothing beyond the client-safe snapshot.
PDF metadata is limited to title, a generic author and subject.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Optional

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)
from xml.sax.saxutils import escape

NAVY = colors.HexColor("#1d3b6e")
INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#5b6573")
RULE = colors.HexColor("#dfe3e8")
SUBTLE = colors.HexColor("#f1f3f6")
SERIES = colors.HexColor("#2a78d6")

UNIT_SUFFIX = {"units": "", "thousands": "k", "millions": "m"}
UNIT_LABEL = {"units": "", "thousands": "thousands", "millions": "millions"}

PERCENT = {"revenue_growth", "revenue_cagr", "top_customer_share", "gross_margin", "ebitda_margin", "ebit_margin", "net_margin", "ocf_to_ebitda"}
DAYS = {"dso", "dio", "dpo", "cash_conversion_cycle"}
MULTIPLE = {"net_debt_to_ebitda", "interest_coverage"}
LABELS = {
    "revenue": "Revenue", "revenue_growth": "Revenue growth", "revenue_cagr": "Revenue CAGR", "top_customer_share": "Top customer share",
    "gross_profit": "Gross profit", "gross_margin": "Gross margin", "ebitda": "EBITDA (headline)", "ebitda_reported": "EBITDA (reported)",
    "ebitda_calculated": "EBITDA (EBIT + D&A)", "ebitda_margin": "EBITDA margin", "ebit": "EBIT", "ebit_margin": "EBIT margin",
    "net_income": "Net income", "net_margin": "Net margin", "net_working_capital": "Net working capital",
    "trade_working_capital": "Trade working capital", "dso": "DSO (days)", "dio": "DIO (days)", "dpo": "DPO (days)",
    "cash_conversion_cycle": "Cash conversion cycle (days)", "gross_debt": "Gross debt", "cash": "Cash", "net_debt": "Net debt",
    "net_debt_to_ebitda": "Net debt / EBITDA", "interest_coverage": "Interest coverage", "operating_cash_flow": "Operating cash flow",
    "capex": "Capital expenditure", "free_cash_flow": "Free cash flow (OCF − capex)", "ocf_to_ebitda": "OCF / EBITDA",
}
DEFINITIONS = [
    ("Gross margin", "Gross profit ÷ revenue; gross profit is reported, else revenue − cost of goods sold."),
    ("EBITDA", "Reported EBITDA where presented, otherwise EBIT + depreciation & amortisation. The basis is shown per period."),
    ("Adjusted EBITDA", "EBITDA plus analyst-approved normalisation adjustments only."),
    ("Net working capital", "Current assets − current liabilities. Trade working capital = receivables + inventory − payables."),
    ("DSO / DIO / DPO", "Average balance ÷ revenue (DSO) or cost of goods sold (DIO, DPO) × days in period."),
    ("Net debt", "Short- and long-term borrowings − cash. Leases and other liabilities are not treated as debt."),
    ("Free cash flow", "Operating cash flow − capital expenditure (other definitions exist)."),
    ("Leverage", "Net debt ÷ EBITDA, only for annual periods with positive EBITDA."),
]


def styles():
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=24, leading=30, textColor=NAVY, alignment=TA_LEFT),
        "subtitle": ParagraphStyle("st", parent=ss["Normal"], fontSize=12, leading=16, textColor=MUTED),
        "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=NAVY, spaceBefore=6, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=INK, spaceBefore=8, spaceAfter=4),
        "body": ParagraphStyle("b", parent=ss["Normal"], fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK),
        "small": ParagraphStyle("s", parent=ss["Normal"], fontName="Helvetica", fontSize=8, leading=11, textColor=MUTED),
        "cell": ParagraphStyle("c", parent=ss["Normal"], fontName="Helvetica", fontSize=8.5, leading=11, textColor=INK),
        "notice": ParagraphStyle("n", parent=ss["Normal"], fontName="Helvetica", fontSize=9, leading=13, textColor=INK, backColor=SUBTLE,
                                 borderPadding=6, borderColor=RULE, borderWidth=0.5),
    }


def fmt(key: str, v: Optional[float], currency: str, unit: str) -> str:
    if v is None:
        return "n/a"
    if key in PERCENT:
        return f"{v * 100:.1f}%"
    if key in DAYS:
        return f"{v:.0f}"
    if key in MULTIPLE:
        return f"{v:.1f}x"
    body = f"{abs(v):,.0f}{UNIT_SUFFIX.get(unit, '')}"
    return f"({body})" if v < 0 else body


def amount(v: Optional[float], unit: str) -> str:
    return fmt("amount", v, "", unit)


def table(data, col_widths, header=True, align_right_from=1):
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    st = [("FONT", (0, 0), (-1, -1), "Helvetica", 8.5), ("TEXTCOLOR", (0, 0), (-1, -1), INK),
          ("LINEBELOW", (0, 0), (-1, -1), 0.25, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if header:
        st += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("TEXTCOLOR", (0, 0), (-1, 0), MUTED), ("BACKGROUND", (0, 0), (-1, 0), SUBTLE)]
    if align_right_from is not None:
        st.append(("ALIGN", (align_right_from, 0), (-1, -1), "RIGHT"))
    t.setStyle(TableStyle(st))
    return t


def metric_table(snap, keys, S):
    periods = snap["periods"]
    cur, unit = snap["submission"]["currency"], snap["submission"]["unit"]
    rows = [["Metric", *periods]]
    notes = []
    for k in keys:
        m = snap["metrics"].get(k)
        if not m:
            continue
        row = [LABELS.get(k, k)]
        for p in periods:
            cell = m.get(p)
            if not cell:
                row.append("—")
                continue
            row.append(fmt(k, cell["value"], cur, unit) + ("*" if cell["status"] == "warning" else ""))
            if cell["value"] is None and cell.get("reason") and len(notes) < 6:
                notes.append(f"{LABELS.get(k, k)} {p}: {cell['reason']}")
        rows.append(row)
    if len(rows) == 1:
        return [Paragraph("The required inputs were not available for this section.", S["body"])]
    width = 170 * mm
    first = 62 * mm
    out = [table(rows, [first] + [(width - first) / max(1, len(periods))] * len(periods))]
    out.append(Paragraph(f"{cur} {UNIT_LABEL.get(unit, '')} unless stated. * calculated with a stated limitation. n/a: not calculable from valid inputs.", S["small"]))
    for n in notes:
        out.append(Paragraph(escape(n), S["small"]))
    return out


def bar_chart(snap, key, title):
    data = snap["metrics"].get(key, {})
    periods = [p for p in snap["periods"] if data.get(p, {}).get("value") is not None]
    if len(periods) < 1:
        return None
    vals = [data[p]["value"] for p in periods]
    d = Drawing(170 * mm, 62 * mm)
    c = VerticalBarChart()
    c.x, c.y, c.width, c.height = 14 * mm, 10 * mm, 150 * mm, 42 * mm
    c.data = [vals]
    c.categoryAxis.categoryNames = periods
    c.categoryAxis.labels.fontName = "Helvetica"
    c.categoryAxis.labels.fontSize = 7
    c.valueAxis.valueMin = min(0, min(vals) * 1.15)
    c.valueAxis.valueMax = max(0, max(vals)) * 1.15 or 1
    c.valueAxis.labels.fontSize = 7
    c.valueAxis.labelTextFormat = lambda v: f"{v:,.0f}"
    c.bars[0].fillColor = SERIES
    c.bars[0].strokeColor = None
    c.barLabelFormat = lambda v: f"{v:,.0f}"
    c.barLabels.fontSize = 6.5
    c.barLabels.nudge = 6
    d.add(c)
    d.add(String(14 * mm, 57 * mm, title, fontName="Helvetica-Bold", fontSize=8.5, fillColor=INK))
    return d


def render(snap: dict, approval: Optional[dict], draft: bool) -> bytes:
    S = styles()
    buf = io.BytesIO()
    cur, unit = snap["submission"]["currency"], snap["submission"]["unit"]
    company = snap["company"]
    title = snap["report"]["title"]
    version = snap["report"]["version"]
    generated = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
    synthetic = company["is_synthetic"]

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 12 * mm, f"DealLens · {title} · v{version}{' · DRAFT' if draft else ''}{' · SYNTHETIC DATA' if synthetic else ''}")
        canvas.drawRightString(190 * mm, 12 * mm, f"Page {doc.page}")
        canvas.setStrokeColor(RULE)
        canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
        if draft:
            canvas.setFont("Helvetica-Bold", 60)
            canvas.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.08))
            canvas.translate(105 * mm, 148 * mm)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, "DRAFT — NOT APPROVED")
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=22 * mm,
                            title=f"{title} v{version}", author="DealLens", subject="Financial due diligence report", creator="DealLens report service")
    story = []
    sec = snap["sections"]
    # Cover
    story += [Spacer(1, 40 * mm), Paragraph(escape(title), S["title"]), Spacer(1, 4 * mm),
              Paragraph(escape(company["display_name"]) + (" — synthetic demonstration company" if synthetic else ""), S["subtitle"]),
              Paragraph(f"{escape(snap['submission']['name'])} · reporting period {snap['submission']['period_start']} to {snap['submission']['period_end']}", S["subtitle"]),
              Spacer(1, 16 * mm)]
    meta = [["Report version", f"v{version}{' (draft)' if draft else ''}"], ["Generated", generated],
            ["Currency / units", f"{cur} {UNIT_LABEL.get(unit, '')}"], ["Analysis version", f"v{snap['submission']['analysis_version']}"]]
    if approval:
        meta += [["Approved by", approval["approver"]], ["Approved at", approval["approved_at"]]]
    else:
        meta += [["Approval status", "Not approved — draft for review"]]
    story.append(table(meta, [45 * mm, 100 * mm], header=False, align_right_from=None))
    if synthetic:
        story += [Spacer(1, 8 * mm), Paragraph("This report uses fictional, synthetic data created to demonstrate DealLens. It does not describe a real company.", S["notice"])]
    story.append(PageBreak())
    # Confidentiality
    story += [Paragraph("Confidentiality and basis of preparation", S["h1"]),
              Paragraph("This report is confidential and intended solely for the named company and authorised recipients. It is based on "
                        "information provided by the company, which has not been independently audited or verified by DealLens. "
                        "Figures are analytical outputs of stated methodologies and should be read together with the limitations section. "
                        "Valuations are analytical estimates and not guarantees of transaction price or investment return.", S["body"]),
              Spacer(1, 4 * mm)]
    if "executive_summary" in sec:
        story += [Paragraph("Executive summary", S["h1"]),
                  Paragraph(escape(snap["executive_summary"]).replace("\n", "<br/>") or "No executive summary was provided.", S["body"])]
        headline = [("revenue", "Revenue"), ("ebitda", "EBITDA"), ("ebitda_margin", "EBITDA margin"), ("net_debt", "Net debt"), ("free_cash_flow", "Free cash flow")]
        last = snap["periods"][-1] if snap["periods"] else None
        if last:
            rows = [["Headline metric", last]] + [[l, fmt(k, snap["metrics"].get(k, {}).get(last, {}).get("value"), cur, unit)] for k, l in headline if k in snap["metrics"]]
            story += [Spacer(1, 3 * mm), table(rows, [80 * mm, 40 * mm])]
    if "scope_methodology" in sec:
        story += [Paragraph("Scope and methodology", S["h1"]),
                  Paragraph("Financial statements submitted by the company were extracted automatically with source references, mapped to standard "
                            "categories (uncertain mappings reviewed by an analyst), validated with deterministic data-quality and reconciliation checks, "
                            "and analysed using the definitions in the appendix (formula version v1). Findings were prepared by the finance team and "
                            "approved by an independent reviewer before publication.", S["body"])]
    if "overview" in sec:
        story += [Paragraph("Company and submission overview", S["h1"]),
                  table([["Company", company["display_name"]], ["Legal name", company["legal_name"]], ["Industry", company.get("industry") or "—"],
                         ["Country", company.get("country") or "—"], ["Engagement", snap["submission"]["deal_type"].replace("_", " ").title()],
                         ["Historical periods analysed", ", ".join(snap["periods"]) or "—"]], [55 * mm, 115 * mm], header=False, align_right_from=None)]
    if "data_quality" in sec:
        story += [Paragraph("Data availability and quality", S["h1"])]
        recs = [[r["check_key"].replace("_", " ").title(), r.get("period_label") or "—", r["status"].replace("_", " "),
                 "—" if r["variance"] is None else amount(r["variance"], unit)] for r in snap["reconciliations"]]
        if recs:
            story += [Paragraph("Reconciliations", S["h2"]), table([["Check", "Period", "Status", "Variance"], *recs], [55 * mm, 30 * mm, 45 * mm, 40 * mm])]
        dq = snap["data_quality"]
        if dq:
            story += [Paragraph("Data-quality observations", S["h2"]),
                      table([["Severity", "Observation", "Status"], *[[d["severity"].title(), Paragraph(escape(d["title"]), S["cell"]), d["status"]] for d in dq[:25]]],
                            [25 * mm, 115 * mm, 30 * mm], align_right_from=None)]
        else:
            story.append(Paragraph("No client-visible data-quality observations were recorded.", S["body"]))
    for key, heading, chart in (("revenue", "Revenue analysis", "revenue"), ("profitability", "Profitability analysis", "ebitda")):
        if key in sec:
            story += [Paragraph(heading, S["h1"])]
            d = bar_chart(snap, chart, f"{LABELS[chart]} ({cur} {UNIT_LABEL.get(unit, '')})")
            if d:
                story.append(d)
            story += metric_table(snap, [k for k in {"revenue": ["revenue", "revenue_growth", "revenue_cagr", "top_customer_share"],
                                                       "profitability": ["gross_profit", "gross_margin", "ebitda_reported", "ebitda_calculated", "ebitda", "ebitda_margin", "ebit", "ebit_margin", "net_income", "net_margin"]}[key]], S)
    if "ebitda" in sec:
        story += [Paragraph("EBITDA analysis", S["h1"])]
        adj = snap["ebitda_adjustments"]
        if adj:
            story += [Paragraph("Approved normalisation adjustments", S["h2"]),
                      table([["Period", "Adjustment", "Type", "Amount"], *[[a["period"], Paragraph(escape(a["description"]), S["cell"]), a["type"].replace("_", " "), amount(a["amount"], unit)] for a in adj]],
                            [25 * mm, 85 * mm, 35 * mm, 25 * mm])]
            totals = {}
            for a in adj:
                totals[a["period"]] = totals.get(a["period"], 0) + a["amount"]
            rows = [["Period", "EBITDA", "Approved adjustments", "Adjusted EBITDA"]]
            for p in snap["periods"]:
                e = snap["metrics"].get("ebitda", {}).get(p, {}).get("value")
                t = totals.get(p, 0.0)
                rows.append([p, amount(e, unit), amount(t, unit), amount(None if e is None else e + t, unit)])
            story += [Spacer(1, 2 * mm), table(rows, [30 * mm, 45 * mm, 50 * mm, 45 * mm])]
        else:
            story.append(Paragraph("No EBITDA normalisation adjustments were approved. EBITDA is presented on the basis shown in the profitability table.", S["body"]))
    if "working_capital" in sec:
        story += [Paragraph("Working capital analysis", S["h1"])] + metric_table(snap, METRIC_ORDER["working_capital"], S)
    if "debt_cash_flow" in sec:
        story += [Paragraph("Debt and cash flow analysis", S["h1"])] + metric_table(snap, METRIC_ORDER["debt_cash_flow"], S)
    if "findings" in sec:
        story += [Paragraph("Key findings", S["h1"])]
        if not snap["findings"]:
            story.append(Paragraph("No client-visible findings were approved for this report.", S["body"]))
        for f in snap["findings"]:
            impact = f" · quantified impact {f['impact_currency']} {amount(f['quantified_impact'], unit)}" if f["quantified_impact"] is not None else ""
            block = [Paragraph(f"{escape(f['reference_code'])} · {escape(f['title'])}", S["h2"]),
                     Paragraph(f"Severity: {f['severity'].title()} · Category: {f['category'].replace('_', ' ')}{impact}", S["small"]),
                     Paragraph(escape(f["description"]).replace("\n", "<br/>"), S["body"])]
            if f.get("recommendation"):
                block.append(Paragraph(f"<b>Recommendation:</b> {escape(f['recommendation'])}", S["body"]))
            refs = [r.get("reference") for r in (f.get("source_references") or []) if r.get("reference")]
            if refs:
                block.append(Paragraph("Sources: " + escape("; ".join(refs[:10])), S["small"]))
            story.append(KeepTogether(block))
    if "valuation" in sec:
        story += [Paragraph("Valuation analysis", S["h1"])]
        if not snap["valuations"]:
            story.append(Paragraph("No valuation model was approved for inclusion in this report.", S["body"]))
        else:
            rows = [["Model", "Method", "EV low", "EV base", "EV high", "Equity base"]]
            for v in snap["valuations"]:
                ev, eq = v["enterprise_value"], v["equity_value"]
                rows.append([f"{v['name']} v{v['version']}", "DCF" if v["method"] == "dcf" else "Comparables", amount(ev.get("low"), unit), amount(ev.get("base"), unit),
                             amount(ev.get("high"), unit), amount(eq.get("base"), unit) if eq.get("base") is not None else "n/a"])
            story += [table(rows, [45 * mm, 25 * mm, 25 * mm, 25 * mm, 25 * mm, 25 * mm], align_right_from=2)]
            for v in snap["valuations"]:
                a = ", ".join(f"{k}: {(f'{val * 100:.1f}%' if isinstance(val, float) and abs(val) < 1 else val)}" for k, val in v["assumptions"].items() if val is not None and not isinstance(val, dict))
                story.append(Paragraph(f"<b>{escape(v['name'])}</b> — key assumptions: {escape(a)}", S["small"]))
            story.append(Paragraph("Enterprise value is distinct from equity value; equity value = enterprise value − net debt − explicit bridge items. "
                                   "Comparable-company inputs were entered by analysts from the sources recorded in the model.", S["small"]))
    if "limitations" in sec:
        story += [Paragraph("Risks and limitations", S["h1"])]
        for text in [
            "The analysis relies on financial information supplied by the company; DealLens has not audited it.",
            "Automated extraction may misread unusual layouts; uncertain mappings were reviewed but completeness cannot be guaranteed.",
            "Thresholds used to identify matters for investigation are illustrative defaults, not industry standards.",
            "Valuations depend on stated assumptions and are not guarantees of transaction price or investment return.",
            "Scanned documents are outside the scope of this release and were not analysed.",
        ] + ([snap["additional_limitations"]] if snap["additional_limitations"] else []):
            story.append(Paragraph("• " + escape(text), S["body"]))
    if "appendix" in sec:
        story += [PageBreak(), Paragraph("Appendix — definitions", S["h1"]),
                  table([["Measure", "Definition"], *[[d, Paragraph(escape(t), S["cell"])] for d, t in DEFINITIONS]], [40 * mm, 130 * mm], align_right_from=None),
                  Spacer(1, 4 * mm), Paragraph(f"Report generated {generated} from snapshot captured {snap['captured_at'][:19].replace('T', ' ')} UTC.", S["small"])]
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()


METRIC_ORDER = {
    "working_capital": ["net_working_capital", "trade_working_capital", "dso", "dio", "dpo", "cash_conversion_cycle"],
    "debt_cash_flow": ["gross_debt", "cash", "net_debt", "net_debt_to_ebitda", "interest_coverage", "operating_cash_flow", "capex", "free_cash_flow", "ocf_to_ebitda"],
}
