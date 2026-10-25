"""Job queue primitives on public.processing_jobs (claim with SKIP LOCKED, retry with backoff)."""
from __future__ import annotations

import logging
from typing import Optional

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger("deallens.jobs")

CLAIM_SQL = """
update public.processing_jobs j
   set job_status = 'running', attempt_count = j.attempt_count + 1, locked_by = %(worker)s, locked_at = now(),
       started_at = coalesce(j.started_at, now()), error_code = null, safe_error_message = null
 where j.id = (select id from public.processing_jobs
                where job_status = 'queued' and run_after <= now()
                order by case job_type when 'extract_document' then 0 when 'analyze_submission' then 1 else 2 end, created_at
                for update skip locked limit 1)
returning j.*
"""

RECOVER_SQL = """
update public.processing_jobs set job_status = 'queued', locked_by = null, locked_at = null, run_after = now()
 where job_status = 'running' and locked_at < now() - make_interval(secs => %(stale)s)
returning id
"""


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(url, row_factory=dict_row, autocommit=False)


def recover_stale(conn: psycopg.Connection, stale_seconds: int) -> int:
    """Requeue jobs left 'running' by a crashed worker (idempotent processing makes this safe)."""
    with conn.cursor() as cur:
        cur.execute(RECOVER_SQL, {"stale": stale_seconds})
        n = cur.rowcount
    conn.commit()
    if n:
        log.warning("requeued %s stale job(s)", n)
    return n


def claim(conn: psycopg.Connection, worker: str) -> Optional[dict]:
    with conn.cursor() as cur:
        cur.execute(CLAIM_SQL, {"worker": worker})
        job = cur.fetchone()
    conn.commit()
    return job


def succeed(cur, job_id: str) -> None:
    cur.execute("update public.processing_jobs set job_status = 'succeeded', completed_at = now(), locked_by = null where id = %s", (job_id,))


def fail(conn: psycopg.Connection, job: dict, code: str, message: str, retryable: bool) -> bool:
    """Record a failure. Returns True if the job was re-queued for another attempt."""
    retry = retryable and job["attempt_count"] < job["max_attempts"]
    with conn.cursor() as cur:
        if retry:
            backoff = 15 * (2 ** (job["attempt_count"] - 1))
            cur.execute("""update public.processing_jobs set job_status = 'queued', locked_by = null, error_code = %s, safe_error_message = %s,
                           run_after = now() + make_interval(secs => %s) where id = %s""", (code, message, backoff, job["id"]))
        else:
            cur.execute("""update public.processing_jobs set job_status = 'failed', completed_at = now(), locked_by = null,
                           error_code = %s, safe_error_message = %s where id = %s""", (code, message, job["id"]))
    conn.commit()
    return retry
