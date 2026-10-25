"""Retention and orphan cleanup.

- Upload rows stuck in 'uploading' for over an hour (browser closed mid-upload, crash between steps)
  are deleted together with any partial storage object.
- Documents soft-deleted from drafts keep their metadata row (audit history) but their stored object
  is purged after RETENTION_DAYS. Documents of submitted packages are never deletable by users, so
  published report history is never affected.
"""
from __future__ import annotations

import logging

from psycopg.types.json import Jsonb

log = logging.getLogger("deallens.maintenance")
RETENTION_DAYS = 30


def run(conn, storage) -> None:
    with conn.cursor() as cur:
        cur.execute("""delete from public.documents where processing_status = 'uploading' and uploaded_at < now() - interval '1 hour'
                       returning storage_path""")
        orphans = [r["storage_path"] for r in cur.fetchall()]
        cur.execute("""select id, storage_path from public.documents where deleted_at is not null
                       and deleted_at < now() - make_interval(days => %s) and not coalesce((extraction_metadata->>'object_purged')::boolean, false)""",
                    (RETENTION_DAYS,))
        expired = cur.fetchall()
        for d in expired:
            cur.execute("update public.documents set extraction_metadata = extraction_metadata || %s where id = %s",
                        (Jsonb({"object_purged": True}), d["id"]))
    conn.commit()
    paths = orphans + [d["storage_path"] for d in expired]
    if paths:
        storage.remove("documents", paths)
        log.info("maintenance removed %s orphaned and %s expired object(s)", len(orphans), len(expired))
