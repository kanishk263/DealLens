import io

import pdfplumber

from deallens_worker.reporting.pdf import render
from deallens_worker.reporting.snapshot import SECTION_KEYS

SNAP = {
    "schema": 1, "captured_at": "2026-10-25T10:00:00+00:00", "report": {"title": "Financial Due Diligence Report", "version": 2, "type": "financial_due_diligence"},
    "sections": SECTION_KEYS, "executive_summary": "Revenue grew steadily; working capital absorbed cash.", "additional_limitations": "",
    "company": {"display_name": "Northstar Components", "legal_name": "Northstar Components Ltd. (Synthetic)", "industry": "Manufacturing", "country": "UK", "is_synthetic": True},
    "submission": {"name": "FY22-FY24", "deal_type": "financial_due_diligence", "period_start": "2022-01-01", "period_end": "2024-12-31", "currency": "USD", "unit": "thousands", "analysis_version": 3},
    "periods": ["FY2023", "FY2024"],
    "metrics": {"revenue": {"FY2023": {"value": 51400.0, "status": "reported", "reason": None, "basis": None}, "FY2024": {"value": 55100.0, "status": "reported", "reason": None, "basis": None}},
                "ebitda": {"FY2023": {"value": 9252.0, "status": "calculated", "reason": None, "basis": "calculated"}, "FY2024": {"value": 10194.0, "status": "calculated", "reason": None, "basis": "calculated"}},
                "net_debt_to_ebitda": {"FY2024": {"value": None, "status": "unavailable", "reason": "EBITDA is zero or negative", "basis": None}}},
    "reconciliations": [{"check_key": "balance_sheet", "status": "reconciled", "variance": 0.0, "period_label": "FY2024", "reason": None}],
    "data_quality": [{"severity": "low", "title": "Only 2 annual periods available", "status": "open", "suggested_resolution": "", "resolution_notes": None}],
    "findings": [{"reference_code": "F-002", "category": "working_capital", "title": "Receivables build-up", "description": "DSO increased.", "severity": "high",
                  "quantified_impact": 250.0, "impact_currency": "USD", "recommendation": "Agree a normalised working-capital peg.", "source_references": [{"reference": "Balance Sheet!D8"}]}],
    "ebitda_adjustments": [{"type": "restructuring", "description": "Plant closure", "amount": 1500.0, "period": "FY2024"}],
    "valuations": [{"name": "DCF base", "version": 1, "method": "dcf", "currency": "USD", "enterprise_value": {"low": 60000.0, "base": 70000.0, "high": 85000.0},
                    "equity_value": {"low": 55000.0, "base": 65000.0, "high": 80000.0}, "assumptions": {"wacc": 0.1, "terminalGrowth": 0.02}, "warnings": []}],
}


def text(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join(p.extract_text() or "" for p in pdf.pages)


def test_draft_render_is_a_valid_pdf_with_watermark_and_no_approval():
    data = render(SNAP, None, draft=True)
    assert data.startswith(b"%PDF-")
    t = text(data)
    assert "DRAFT" in t and "Not approved" in t
    assert "Receivables build-up" in t and "F-002" in t
    assert "SYNTHETIC DATA" in t
    assert "Page 2" in t


def test_final_render_carries_approval_metadata():
    t = text(render(SNAP, {"approver": "Riley Reviewer", "approved_at": "25 Oct 2026 12:00 UTC"}, draft=False))
    assert "Riley Reviewer" in t and "DRAFT — NOT APPROVED" not in t
    assert "Adjusted EBITDA" in t and "11,694k" in t  # 10,194 + 1,500


def test_metadata_is_generic():
    data = render(SNAP, None, draft=True)
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        meta = pdf.metadata
    assert meta.get("Author") == "DealLens" and "Financial Due Diligence Report v2" in meta.get("Title", "")


def test_unavailable_metrics_explain_why():
    t = text(render(SNAP, None, draft=True))
    assert "n/a" in t


def test_sections_are_optional():
    data = render({**SNAP, "sections": ["executive_summary"], "findings": [], "valuations": []}, None, draft=True)
    t = text(data)
    assert "Executive summary" in t and "Key findings" not in t
