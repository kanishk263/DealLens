from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    supabase_url: str
    service_role_key: str
    worker_id: str
    poll_seconds: float
    job_timeout_seconds: int


def load() -> Settings:
    missing = [k for k in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)} (see processing/.env.example)")
    return Settings(
        database_url=os.environ["DATABASE_URL"],
        supabase_url=os.environ["SUPABASE_URL"].rstrip("/"),
        service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        worker_id=os.environ.get("WORKER_ID") or f"worker-{socket.gethostname()}-{os.getpid()}",
        poll_seconds=float(os.environ.get("WORKER_POLL_SECONDS", "3")),
        job_timeout_seconds=int(os.environ.get("JOB_TIMEOUT_SECONDS", "300")),
    )
