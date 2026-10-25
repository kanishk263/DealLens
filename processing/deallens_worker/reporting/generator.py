"""generate_report job: draft render (captures snapshot) or final render of the approved snapshot."""
from __future__ import annotations

import hashlib
import logging
import time

from psycopg.types.json import Jsonb

from . import pdf, snapshot

log = logging.getLogger("deallens.reports")


def handle_generate(conn, storage, job: dict) -> None:
    from .. import jobs
    with conn.cursor() as cur:
        cur.execute("select * from public.reports where id = %s for update", (job["report_id"],))
        report = cur.fetchone()
        if report is None or report["status"] not in ("draft", "changes_requested", "approved"):
            jobs.succeed(cur, job["id"])  # nothing to render (e.g. already published); idempotent no-op
            conn.commit()
            return
        cur.execute("select company_id from public.submissions where id = %s", (report["submission_id"],))
        company_id = cur.fetchone()["company_id"]
        final = report["status"] == "approved"
        if final:
            if report["snapshot"] is None:
                raise RuntimeError("approved report has no snapshot")
            snap = report["snapshot"]
            cur.execute("select full_name, email from public.profiles where id = %s", (report["approved_by"],))
            approver = cur.fetchone()
            approval = {"approver": approver["full_name"] or approver["email"], "approved_at": report["approved_at"].strftime("%d %b %Y %H:%M UTC")}
        else:
            snap = snapshot.build(cur, report)
            approval = None
    conn.commit()

    data = pdf.render(snap, approval, draft=not final)
    suffix = "" if final else f"-draft-{int(time.time())}"
    path = f"{company_id}/{report['submission_id']}/{report['id']}/deallens-report-v{report['report_version']}{suffix}.pdf"
    storage.upload("reports", path, data, "application/pdf")
    checksum = hashlib.sha256(data).hexdigest()

    with conn.cursor() as cur:
        cur.execute("select status, storage_path from public.reports where id = %s for update", (report["id"],))
        current = cur.fetchone()
        if current["status"] != report["status"]:
            conn.rollback()
            storage.remove("reports", [path])  # state changed while rendering; discard
            with conn.cursor() as c2:
                jobs.succeed(c2, job["id"])
            conn.commit()
            return
        if final:
            cur.execute("""update public.reports set storage_path = %s, content_checksum = %s, generated_at = now(), is_final_render = true where id = %s""",
                        (path, checksum, report["id"]))
        else:
            cur.execute("""update public.reports set storage_path = %s, content_checksum = %s, generated_at = now(), snapshot = %s, is_final_render = false
                           where id = %s""", (path, checksum, Jsonb(snap), report["id"]))
        cur.execute("select private.audit(%s, 'report', %s, %s, %s, %s, null)",
                    ("report.final_rendered" if final else "report.draft_generated", str(report["id"]), company_id, report["submission_id"],
                     Jsonb({"version": report["report_version"], "checksum": checksum, "bytes": len(data)})))
        jobs.succeed(cur, job["id"])
    conn.commit()
    old = current["storage_path"]
    if old and old != path and not final:
        storage.remove("reports", [old])
    log.info("rendered %s report %s v%s (%s bytes)", "final" if final else "draft", report["id"], report["report_version"], len(data))
