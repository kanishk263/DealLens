"""Runs the synthetic sample files through the whole pure pipeline and checks known answers."""
import json
from datetime import date
from pathlib import Path

import pytest

from deallens_worker.errors import UnsupportedDocument
from deallens_worker.extraction.engine import extract_document
from deallens_worker.financial.analysis import analyse, candidate_key
from deallens_worker.financial.dataset import Candidate, PeriodInfo
from deallens_worker.normalization.normalize import normalize_items
from deallens_worker.validation.quality import DocumentInfo, LineRow

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
MANIFEST = json.loads((SAMPLES / "manifest.json").read_text())


def run(files, confirm_schedules=False):
    periods: dict[str, PeriodInfo] = {}
    candidates, rows = {}, []
    for order, (name, ftype, category) in enumerate(files):
        res = extract_document((SAMPLES / name).read_bytes(), ftype, name, category)
        for i, n in enumerate(normalize_items(res.items, "USD", "thousands", category)):
            p = n.raw.period
            pid = f"{p.label}|{p.scenario}"
            periods.setdefault(pid, PeriodInfo(pid, p.label, p.period_type, p.scenario, p.start, p.end, p.sort_key[0]))
            iid = f"{name}#{i}"
            ref = n.raw.source_cell_reference or n.raw.source_table_reference or ""
            rows.append(LineRow(iid, pid, p.label, n.category, n.mapping_status, n.raw.statement_type, n.raw.parsed.value, n.raw.parsed.invalid,
                                n.notes, ref, n.raw.detected_currency or "USD", n.raw.detected_unit, name))
            if confirm_schedules and n.mapping_status == "needs_review" and n.category in ("customer_revenue", "revenue_segment"):
                n.mapping_status = "analyst_confirmed"  # simulates the analyst confirming schedule rows
            if n.category and n.normalized_value is not None:
                candidates.setdefault(candidate_key(pid, n.category, n.raw.original_label), []).append(
                    Candidate(iid, n.normalized_value, n.mapping_status, n.confidence, order, n.raw.original_label, ref))
    docs = [DocumentInfo(f, f, "processed", None) for f, _, _ in files]
    return analyse(list(periods.values()), candidates, rows, docs, [], "USD", "thousands", date(2022, 1, 1), date(2024, 12, 31))


def metric(out, key, label):
    pid = f"{label}|actual"
    return next((m for m in out.metrics if m.key == key and m.period_id == pid), None)


def flag_keys(out):
    return {f.rule_key.split(":")[0] for f in out.flags}


@pytest.fixture(scope="module")
def northstar():
    return run([("northstar-financial-statements.xlsx", "xlsx", "income_statement")])


@pytest.fixture(scope="module")
def meridian():
    return run([("meridian-financial-statements.xlsx", "xlsx", "income_statement")])


@pytest.fixture(scope="module")
def apex():
    return run([("apex-financial-statements.csv", "csv", "income_statement"), ("apex-revenue-by-customer.xlsx", "xlsx", "revenue_schedule")], confirm_schedules=True)


def test_northstar_known_answers(northstar):
    model = MANIFEST["northstar"]["model"]
    for y in ("2022", "2023", "2024"):
        assert metric(northstar, "revenue", f"FY{y}").value == model[y]["revenue"]
        assert metric(northstar, "ebitda", f"FY{y}").value == pytest.approx(model[y]["ebitda"])
        assert metric(northstar, "ebitda", f"FY{y}").inputs["basis"] == "calculated"
        assert metric(northstar, "free_cash_flow", f"FY{y}").value == pytest.approx(model[y]["ocf"] - model[y]["capex"])
        assert metric(northstar, "net_debt", f"FY{y}").value == pytest.approx(model[y]["ltd"] + model[y]["std"] - model[y]["cash"])
    rev_growth = metric(northstar, "revenue_growth", "FY2023").value
    assert rev_growth == pytest.approx(51400 / 48000 - 1)
    assert metric(northstar, "revenue_growth", "FY2022").status == "unavailable"


def test_northstar_sign_convention_and_reconciliations(northstar):
    assert metric(northstar, "gross_margin", "FY2024").value == pytest.approx(1 - 0.615, abs=1e-3)
    assert all(r.status == "reconciled" for r in northstar.reconciliations if r.period_label != "FY2022" or r.check_key == "balance_sheet")
    assert not any(i.issue_type == "reconciliation_variance" for i in northstar.issues)


def test_northstar_dso_uses_average_balances(northstar):
    model = MANIFEST["northstar"]["model"]
    dso = metric(northstar, "dso", "FY2024")
    expected = (model["2023"]["ar"] + model["2024"]["ar"]) / 2 / model["2024"]["revenue"] * 366
    assert dso.value == pytest.approx(expected)  # FY2024 has 366 calendar days
    assert dso.inputs["balance_basis"].startswith("average")


def test_meridian_deliberate_issues(meridian):
    types = {i.issue_type for i in meridian.issues}
    assert "reconciliation_variance" in types
    rec = next(r for r in meridian.reconciliations if r.check_key == "balance_sheet" and r.period_label == "FY2024")
    assert rec.status == "variance" and rec.variance == pytest.approx(150)
    keys = flag_keys(meridian)
    for expected in ("gross_margin_deterioration", "ebitda_margin_deterioration", "negative_fcf", "receivables_outpacing_revenue", "inventory_outpacing_revenue", "ocf_below_ebitda",
                     "working_capital_absorption", "bs_reconciliation_failure"):
        assert expected in keys, expected


def test_meridian_unmapped_label(meridian):
    assert any(i.issue_type == "unmapped_line_items" for i in meridian.issues)


def test_apex_reported_vs_calculated_ebitda_and_concentration(apex):
    model = MANIFEST["apex"]["model"]
    rep = metric(apex, "ebitda", "FY2024")
    assert rep.status == "reported" and rep.value == model["2024"]["ebitda"] - 1100
    assert metric(apex, "ebitda_calculated", "FY2024").value == pytest.approx(model["2024"]["ebitda"])
    keys = flag_keys(apex)
    assert "reported_vs_recalculated" in keys
    assert "customer_concentration" in keys
    assert metric(apex, "top_customer_share", "FY2024").value == pytest.approx(0.28, abs=0.002)
    assert metric(apex, "dio", "FY2024").status == "unavailable"
    assert metric(apex, "trade_working_capital", "FY2024").status == "warning"
    assert metric(apex, "net_debt_to_ebitda", "FY2024").status == "unavailable"  # no borrowings mapped


def test_text_pdf_extraction():
    res = extract_document((SAMPLES / "northstar-income-statement.pdf").read_bytes(), "pdf", "x.pdf", "income_statement")
    items = normalize_items(res.items, "USD", "thousands", "income_statement")
    rev = [n for n in items if n.category == "revenue"]
    assert {n.raw.period.label for n in rev} == {"FY2022", "FY2023", "FY2024"}
    assert sorted(n.normalized_value for n in rev) == [48000, 51400, 55100]
    assert all(n.raw.source_page_number == 1 for n in rev)


def test_scanned_pdf_rejected():
    with pytest.raises(UnsupportedDocument) as exc:
        extract_document((SAMPLES / "scanned-statement-unsupported.pdf").read_bytes(), "pdf", "s.pdf", "income_statement")
    assert exc.value.code == "SCANNED_PDF_UNSUPPORTED"


def test_signature_mismatch_rejected():
    with pytest.raises(UnsupportedDocument) as exc:
        extract_document((SAMPLES / "northstar-income-statement.pdf").read_bytes(), "xlsx", "fake.xlsx", "income_statement")
    assert exc.value.code == "FILE_SIGNATURE_MISMATCH"


def test_cell_references_preserved(northstar):
    rev = next(m for m in northstar.metrics if m.key == "revenue")
    assert rev.line_item_ids


def test_schedule_rows_require_confirmation():
    out = run([("apex-financial-statements.csv", "csv", "income_statement"), ("apex-revenue-by-customer.xlsx", "xlsx", "revenue_schedule")])
    assert metric(out, "top_customer_share", "FY2024") is None
    assert "customer_concentration" not in flag_keys(out)


def test_processing_errors_survive_subprocess_boundary():
    from deallens_worker.pipeline import _extract_in_subprocess, run_with_timeout
    with pytest.raises(UnsupportedDocument) as exc:
        run_with_timeout(_extract_in_subprocess, 30, (SAMPLES / "scanned-statement-unsupported.pdf").read_bytes(), "pdf", "s.pdf", "income_statement", (12, 31))
    assert exc.value.code == "SCANNED_PDF_UNSUPPORTED"
