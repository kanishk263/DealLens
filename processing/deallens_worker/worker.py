"""DealLens processing worker: polls the job queue and runs extraction, analysis and report jobs."""
from __future__ import annotations

import argparse
import logging
import signal
import time

from . import config, jobs, maintenance
from .errors import ProcessingError, TransientError
from .storage import Storage

log = logging.getLogger("deallens.worker")
_stop = False


def _handle_signal(*_):
    global _stop
    _stop = True
    log.info("shutdown requested; finishing current job")


def run_job(conn, storage: Storage, settings: config.Settings, job: dict) -> None:
    from . import pipeline
    from .reporting import generator
    log.info("job %s %s (attempt %s/%s)", job["id"], job["job_type"], job["attempt_count"], job["max_attempts"])
    try:
        if job["job_type"] == "extract_document":
            pipeline.handle_extract(conn, storage, job, settings.job_timeout_seconds)
        elif job["job_type"] == "analyze_submission":
            pipeline.handle_analyze(conn, job)
        elif job["job_type"] == "generate_report":
            generator.handle_generate(conn, storage, job)
        else:
            raise ProcessingError("UNKNOWN_JOB_TYPE", "Unknown job type.")
    except ProcessingError as exc:
        conn.rollback()
        retried = jobs.fail(conn, job, exc.code, exc.safe_message, exc.retryable)
        if not retried and job["job_type"] == "extract_document":
            pipeline.on_extract_exhausted(conn, job, exc.code, exc.safe_message)
        log.warning("job %s failed with %s (retry=%s)", job["id"], exc.code, retried)
    except Exception:  # noqa: BLE001 — unexpected errors are logged server-side only; users see a generic message
        conn.rollback()
        log.exception("job %s crashed", job["id"])
        retried = jobs.fail(conn, job, "INTERNAL_ERROR", "An unexpected processing error occurred. The team has been notified.", True)
        if not retried and job["job_type"] == "extract_document":
            pipeline.on_extract_exhausted(conn, job, "INTERNAL_ERROR", "An unexpected processing error occurred.")


def loop(once: bool = False) -> int:
    settings = config.load()
    storage = Storage(settings.supabase_url, settings.service_role_key)
    conn = jobs.connect(settings.database_url)
    processed = 0
    last_recovery = last_maintenance = 0.0
    while not _stop:
        if time.time() - last_recovery > 60:
            jobs.recover_stale(conn, settings.job_timeout_seconds * 2)
            last_recovery = time.time()
        if time.time() - last_maintenance > 600:
            try:
                maintenance.run(conn, storage)
            except Exception:  # noqa: BLE001 — maintenance must never stop job processing
                conn.rollback()
                log.exception("maintenance failed")
            last_maintenance = time.time()
        job = jobs.claim(conn, settings.worker_id)
        if job is None:
            if once:
                break
            time.sleep(settings.poll_seconds)
            continue
        run_job(conn, storage, settings, job)
        processed += 1
    conn.close()
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(prog="deallens_worker")
    parser.add_argument("command", choices=["run", "drain"], help="run: poll forever; drain: process queued jobs then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    n = loop(once=args.command == "drain")
    log.info("worker exiting after %s job(s)", n)
