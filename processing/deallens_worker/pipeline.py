"""Job handlers: extract_document and analyze_submission.

Each handler persists its results in a single transaction and is idempotent: re-running an extraction
replaces that document's line items; re-running analysis writes a new analysis version."""
from __future__ import annotations

import hashlib
import json
import logging
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import date

from psycopg.types.json import Jsonb

from .errors import MalformedDocument, ProcessingError, TransientError, UnsupportedDocument
from .extraction.engine import extract_document
from .financial.analysis import analyse, candidate_key
from .financial.dataset import Candidate, PeriodInfo
from .financial.metrics import FORMULA_VERSION
from .normalization.normalize import normalize_items
from .validation.quality import DocumentInfo, LineRow

log = logging.getLogger("deallens.pipeline")


def _extract_in_subprocess(data: bytes, file_type: str, filename: str, category: str, fye: tuple[int, int]):
    return extract_document(data, file_type, filename, category, fye)


def run_with_timeout(fn, timeout: int, *args):
    """CPU-bound parsing runs in a child process so a pathological file can be killed at the timeout."""
    pool = ProcessPoolExecutor(max_workers=1)
    try:
        return pool.submit(fn, *args).result(timeout=timeout)
    except FutureTimeout as exc:
        for p in list(getattr(pool, "_processes", {}).values()):
            p.kill()
        raise MalformedDocument("PROCESSING_TIMEOUT", "Processing exceeded the time limit; simplify or split the document.") from exc
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _system_transition(cur, submission_id: str, to: str, reason: str) -> None:
    cur.execute("select private.apply_transition(%s, %s::public.submission_status, 'system', %s)", (submission_id, to, reason))


def _maybe_enqueue_analysis(cur, submission_id: str) -> None:
    cur.execute("""select count(*) as n from public.processing_jobs where submission_id = %s and job_type = 'extract_document'
                   and job_status in ('queued', 'running')""", (submission_id,))
    if cur.fetchone()["n"] == 0:
        cur.execute("select private.enqueue_analysis(%s)", (submission_id,))


# ---------------------------------------------------------------------------------------------
# extract_document
# ---------------------------------------------------------------------------------------------
def handle_extract(conn, storage, job: dict, timeout: int) -> None:
    with conn.cursor() as cur:
        cur.execute("""select d.*, s.company_id, s.reporting_currency, s.reporting_unit, s.reporting_period_end, s.submission_status
                       from public.documents d join public.submissions s on s.id = d.submission_id
                       where d.id = %s for update of d""", (job["document_id"],))
        doc = cur.fetchone()
        if doc is None or doc["deleted_at"] is not None:
            from . import jobs
            jobs.succeed(cur, job["id"])
            conn.commit()
            return
        cur.execute("select submission_status from public.submissions where id = %s for update", (doc["submission_id"],))
        if cur.fetchone()["submission_status"] == "uploaded":
            _system_transition(cur, doc["submission_id"], "processing", "Worker started processing")
        cur.execute("update public.documents set processing_status = 'processing' where id = %s", (doc["id"],))
    conn.commit()

    try:
        data = storage.download("documents", doc["storage_path"])
        if hashlib.sha256(data).hexdigest() != doc["checksum"]:
            raise MalformedDocument("CHECKSUM_MISMATCH", "The stored file does not match the uploaded checksum; upload it again.")
        fye = (doc["reporting_period_end"].month, doc["reporting_period_end"].day)
        result = run_with_timeout(_extract_in_subprocess, timeout, data, doc["file_type"], doc["original_filename"], doc["document_category"], fye)
        normalized = normalize_items(result.items, doc["reporting_currency"], doc["reporting_unit"], doc["document_category"])
    except (UnsupportedDocument, MalformedDocument) as exc:
        _record_document_failure(conn, job, doc, exc, "unsupported" if isinstance(exc, UnsupportedDocument) else "failed")
        return

    with conn.cursor() as cur:
        cur.execute("delete from public.financial_line_items where source_document_id = %s", (doc["id"],))
        period_ids: dict[tuple[str, str], str] = {}
        for n in normalized:
            p = n.raw.period
            key = (p.label, p.scenario)
            if key in period_ids:
                continue
            cur.execute("""insert into public.financial_periods (submission_id, period_label, period_start, period_end, period_type, scenario,
                             currency, reporting_unit, sort_order)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                           on conflict (submission_id, period_label, scenario) do update
                             set period_start = coalesce(excluded.period_start, financial_periods.period_start),
                                 period_end = coalesce(excluded.period_end, financial_periods.period_end)
                           returning id""",
                        (doc["submission_id"], p.label, p.start, p.end, p.period_type, p.scenario, doc["reporting_currency"],
                         doc["reporting_unit"], p.end.toordinal() if p.end else 0))
            period_ids[key] = cur.fetchone()["id"]
        rows = []
        for n in normalized:
            r = n.raw
            rows.append((doc["submission_id"], period_ids[(r.period.label, r.period.scenario)], doc["id"], r.statement_type if r.statement_type in
                         ("income_statement", "balance_sheet", "cash_flow", "supporting") else "unknown",
                         r.source_sheet, r.source_cell_reference, r.source_page_number, r.source_table_reference, r.source_row, r.source_column,
                         r.original_label, n.category, r.raw_value, r.parsed.value, n.normalized_value, n.currency, n.unit, r.is_subtotal,
                         n.mapping_status, r.extraction_method, n.confidence))
        cur.executemany("""insert into public.financial_line_items (submission_id, financial_period_id, source_document_id, statement_type,
                             source_sheet, source_cell_reference, source_page_number, source_table_reference, source_row, source_column,
                             original_label, normalized_category, raw_value, parsed_value, normalized_value, currency, unit, is_subtotal,
                             mapping_status, extraction_method, confidence_score)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""", rows)
        notes = {}
        for n in normalized:
            for note in n.notes:
                notes[note] = notes.get(note, 0) + 1
        invalid = [{"label": n.raw.original_label, "period": n.raw.period.label, "reference": n.raw.source_cell_reference or n.raw.source_table_reference,
                    "note": n.raw.parsed.note} for n in normalized if n.raw.parsed.invalid][:50]
        meta = {**doc["extraction_metadata"], **result.metadata, "normalisation_notes": notes, "invalid_values": invalid,
                "mapping_summary": {s: sum(1 for n in normalized if n.mapping_status == s) for s in ("auto_mapped", "needs_review", "unmapped")}}
        status = "processed"
        cur.execute("update public.documents set processing_status = %s, extraction_metadata = %s where id = %s",
                    (status, Jsonb(meta), doc["id"]))
        from . import jobs
        jobs.succeed(cur, job["id"])
        cur.execute("select private.audit('document.processed', 'document', %s, %s, %s, %s, null)",
                    (str(doc["id"]), doc["company_id"], doc["submission_id"], Jsonb({"line_items": len(rows), "file_type": doc["file_type"]})))
        _maybe_enqueue_analysis(cur, doc["submission_id"])
    conn.commit()
    log.info("extracted %s line items from document %s", len(rows), doc["id"])


def _record_document_failure(conn, job, doc, exc: ProcessingError, status: str) -> None:
    from . import jobs
    with conn.cursor() as cur:
        meta = {**doc["extraction_metadata"], "error_code": exc.code, "error_message": exc.safe_message}
        cur.execute("update public.documents set processing_status = %s, extraction_metadata = %s where id = %s", (status, Jsonb(meta), doc["id"]))
        cur.execute("""update public.processing_jobs set job_status = 'failed', completed_at = now(), locked_by = null,
                       error_code = %s, safe_error_message = %s where id = %s""", (exc.code, exc.safe_message, job["id"]))
        cur.execute("select private.audit('document.processing_failed', 'document', %s, %s, %s, %s, null)",
                    (str(doc["id"]), doc["company_id"], doc["submission_id"], Jsonb({"error_code": exc.code})))
        _maybe_enqueue_analysis(cur, doc["submission_id"])
    conn.commit()
    log.warning("document %s failed: %s", doc["id"], exc.code)


def on_extract_exhausted(conn, job: dict, code: str, message: str) -> None:
    """Called when a transient failure has used every attempt: mark the document failed and move on."""
    with conn.cursor() as cur:
        cur.execute("update public.documents set processing_status = 'failed', extraction_metadata = extraction_metadata || %s where id = %s",
                    (Jsonb({"error_code": code, "error_message": message}), job["document_id"]))
        _maybe_enqueue_analysis(cur, job["submission_id"])
    conn.commit()


# ---------------------------------------------------------------------------------------------
# analyze_submission
# ---------------------------------------------------------------------------------------------
def handle_analyze(conn, job: dict) -> None:
    sid = job["submission_id"]
    with conn.cursor() as cur:
        cur.execute("select * from public.submissions where id = %s for update", (sid,))
        sub = cur.fetchone()
        cur.execute("select * from public.financial_periods where submission_id = %s", (sid,))
        periods = [PeriodInfo(str(p["id"]), p["period_label"], p["period_type"], p["scenario"], p["period_start"], p["period_end"], p["sort_order"])
                   for p in cur.fetchall()]
        cur.execute("""select d.id, d.original_filename, d.processing_status, d.extraction_metadata, d.uploaded_at
                       from public.documents d where d.submission_id = %s and d.deleted_at is null order by d.uploaded_at""", (sid,))
        docs_raw = cur.fetchall()
        doc_order = {str(d["id"]): i for i, d in enumerate(docs_raw)}
        cur.execute("""select li.*, fp.period_label from public.financial_line_items li join public.financial_periods fp on fp.id = li.financial_period_id
                       join public.documents d on d.id = li.source_document_id
                       where li.submission_id = %s and d.deleted_at is null""", (sid,))
        items = cur.fetchall()
        cur.execute("select financial_period_id::text, amount, sign, status from public.ebitda_adjustments where submission_id = %s", (sid,))
        adjustments = [dict(r) for r in cur.fetchall()]

    rows, candidates = [], {}
    for li in items:
        ref = _reference(li)
        lid, pid = str(li["id"]), str(li["financial_period_id"])
        invalid = li["parsed_value"] is None and li["raw_value"] not in (None, "") and li["mapping_status"] != "excluded" and _looks_invalid(li["raw_value"])
        rows.append(LineRow(lid, pid, li["period_label"], li["normalized_category"], li["mapping_status"], li["statement_type"],
                            float(li["parsed_value"]) if li["parsed_value"] is not None else None, invalid, [], ref, li["currency"], li["unit"],
                            str(li["source_document_id"])))
        if li["normalized_category"] and li["normalized_value"] is not None:
            candidates.setdefault(candidate_key(pid, li["normalized_category"], li["original_label"]), []).append(
                Candidate(lid, float(li["normalized_value"]), li["mapping_status"], float(li["confidence_score"]) if li["confidence_score"] is not None else None,
                          doc_order.get(str(li["source_document_id"]), 99), li["original_label"], ref))
    docs = [DocumentInfo(str(d["id"]), d["original_filename"], d["processing_status"], (d["extraction_metadata"] or {}).get("possible_duplicate_of"),
                         (d["extraction_metadata"] or {}).get("warnings", []), (d["extraction_metadata"] or {}).get("error_message")) for d in docs_raw]
    # Units: the line items carry the submission unit once normalised; detected units come from extraction metadata.
    detected_units = {u for d in docs_raw for u in (d["extraction_metadata"] or {}).get("detected_units", [])}
    for r in rows:
        r.detected_unit = None  # unit consistency is assessed from document-level detection below, not per normalised row
    out = analyse(periods, candidates, rows, docs, adjustments, sub["reporting_currency"], sub["reporting_unit"],
                  sub["reporting_period_start"], sub["reporting_period_end"])
    if len(detected_units) > 1 or (detected_units and sub["reporting_unit"] not in detected_units):
        from .validation.quality import Issue
        multiple = len(detected_units) > 1
        out.issues.append(Issue("inconsistent_units" if multiple else "unit_scaled", "inconsistent_units", "high" if multiple else "informational",
                                "Inconsistent units across documents" if multiple else "Values scaled to the submission unit",
                                f"Documents state values in {', '.join(sorted(detected_units))}; values were scaled to {sub['reporting_unit']}.",
                                "Confirm the unit of each statement." if multiple else "No action needed if the declared unit is correct."))
    version = sub["current_analysis_version"] + 1
    with conn.cursor() as cur:
        _persist_analysis(cur, sub, version, out)
        processed = [d for d in docs_raw if d["processing_status"] == "processed"]
        usable = any(r.mapping_status in ("auto_mapped", "analyst_mapped", "analyst_confirmed") for r in rows)
        if sub["submission_status"] == "processing":
            if processed and usable:
                _system_transition(cur, sid, "awaiting_review", "Processing succeeded")
                cur.execute("select private.notify_company(%s, 'processing_succeeded', 'Processing complete', %s, 'submission', %s, %s)",
                            (sub["company_id"], f'"{sub["submission_name"]}" was processed and is awaiting analyst review.', sid, f"/submissions/{sid}"))
            else:
                _system_transition(cur, sid, "processing_failed", "No document could be processed into usable financial data")
                cur.execute("select private.notify_company(%s, 'processing_failed', 'Processing failed', %s, 'submission', %s, %s)",
                            (sub["company_id"], f'"{sub["submission_name"]}" could not be processed. See document errors and resubmit.', sid, f"/submissions/{sid}"))
                cur.execute("select private.notify_role('superadmin', 'processing_failed', 'Processing failed', %s, 'submission', %s, '/admin/jobs')",
                            (f'Submission "{sub["submission_name"]}" failed processing.', sid))
        from . import jobs
        jobs.succeed(cur, job["id"])
    conn.commit()
    log.info("analysis v%s for submission %s: %s metrics, %s issues, %s flags", version, sid, len(out.metrics), len(out.issues), len(out.flags))


def _looks_invalid(raw: str) -> bool:
    from .extraction.values import parse_value
    return parse_value(raw).invalid


def _reference(li: dict) -> str:
    if li.get("source_cell_reference"):
        return f"{li['source_sheet'] or 'sheet'}!{li['source_cell_reference']}"
    if li.get("source_page_number"):
        return f"page {li['source_page_number']} · {li.get('source_table_reference') or ''} R{li.get('source_row')}C{li.get('source_column')}"
    if li.get("source_row"):
        return f"row {li['source_row']}, column {li['source_column']}"
    return "source coordinates unavailable"


def _num(v):
    if v is None:
        return None
    return float(v)


def _persist_analysis(cur, sub: dict, version: int, out) -> None:
    sid = sub["id"]
    cur.executemany("""insert into public.financial_metrics (submission_id, financial_period_id, analysis_version, metric_key, metric_value,
                         currency, unit, formula_version, calculation_inputs, source_line_item_ids, metric_status, status_reason)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s)""",
                    [(sid, m.period_id, version, m.key, m.value, None if m.is_ratio else sub["reporting_currency"],
                      "ratio" if m.is_ratio else ("days" if m.key in ("dso", "dio", "dpo", "cash_conversion_cycle") else sub["reporting_unit"]),
                      FORMULA_VERSION, Jsonb(_jsonable(m.inputs)), m.line_item_ids, m.status, m.reason) for m in out.metrics])
    cur.executemany("""insert into public.reconciliations (submission_id, financial_period_id, analysis_version, check_key, status, lhs, rhs, variance,
                         tolerance, details) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    [(sid, r.period_id, version, r.check_key, r.status, r.lhs, r.rhs, r.variance, r.tolerance, Jsonb(_jsonable(r.details)))
                     for r in out.reconciliations])

    keys = []
    for i in out.issues:
        keys.append(i.issue_key)
        cur.execute("""insert into public.data_quality_issues (submission_id, financial_period_id, issue_key, issue_type, severity, title, description,
                         suggested_resolution, source_references, client_visible)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       on conflict (submission_id, issue_key) do update set severity = excluded.severity, title = excluded.title,
                         description = excluded.description, suggested_resolution = excluded.suggested_resolution,
                         source_references = excluded.source_references, financial_period_id = excluded.financial_period_id,
                         status = case when data_quality_issues.status = 'resolved' and data_quality_issues.resolved_by is null then 'open'
                                       else data_quality_issues.status end""",
                    (sid, i.period_id, i.issue_key, i.issue_type, i.severity, i.title, i.description, i.suggested_resolution,
                     Jsonb(_jsonable(i.source_references)), i.client_visible))
    cur.execute("""update public.data_quality_issues set status = 'resolved', resolved_at = now(),
                     resolution_notes = %s where submission_id = %s and status = 'open' and not (issue_key = any(%s))""",
                (f"No longer detected after re-analysis (version {version}).", sid, keys))

    flag_keys = []
    for f in out.flags:
        period = f.source_period or "all periods"
        flag_keys.append(f"{f.rule_key}|{period}")
        cur.execute("""insert into public.red_flags (submission_id, rule_key, title, category, severity, triggering_rule, observed_value, comparison_value,
                         threshold, source_period, source_references, explanation, recommended_follow_up, analysis_version, is_active)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                       on conflict (submission_id, rule_key, source_period) do update set title = excluded.title, severity = excluded.severity,
                         observed_value = excluded.observed_value, comparison_value = excluded.comparison_value, threshold = excluded.threshold,
                         source_references = excluded.source_references, explanation = excluded.explanation,
                         analysis_version = excluded.analysis_version, is_active = true""",
                    (sid, f.rule_key, f.title, f.category, f.severity, f.triggering_rule, _num(f.observed_value), _num(f.comparison_value),
                     Jsonb(_jsonable(f.threshold)), period, Jsonb(_jsonable(f.source_references)), f.explanation, f.recommended_follow_up, version))
    cur.execute("""update public.red_flags set is_active = false where submission_id = %s and not ((rule_key || '|' || source_period) = any(%s))""",
                (sid, flag_keys))
    cur.execute("update public.submissions set current_analysis_version = %s where id = %s", (version, sid))
    cur.execute("select private.audit('analysis.completed', 'submission', %s, %s, %s, %s, null)",
                (str(sid), sub["company_id"], sid, Jsonb({"version": version, "metrics": len(out.metrics), "issues": len(out.issues), "flags": len(out.flags)})))


def _jsonable(obj):
    return json.loads(json.dumps(obj, default=lambda o: o.isoformat() if isinstance(o, date) else str(o)))
