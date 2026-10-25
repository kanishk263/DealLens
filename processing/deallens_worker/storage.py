"""Private Supabase Storage access with the service-role key (worker only; never exposed to browsers)."""
from __future__ import annotations

import httpx

from .errors import TransientError


class Storage:
    def __init__(self, supabase_url: str, service_key: str):
        self.base = f"{supabase_url}/storage/v1"
        self.headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}

    def download(self, bucket: str, path: str, max_bytes: int = 60 * 1024 * 1024) -> bytes:
        try:
            with httpx.stream("GET", f"{self.base}/object/{bucket}/{path}", headers=self.headers, timeout=60) as r:
                if r.status_code != 200:
                    raise TransientError("STORAGE_DOWNLOAD_FAILED", "The stored file could not be retrieved; the job will be retried.")
                chunks, size = [], 0
                for chunk in r.iter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise TransientError("STORAGE_FILE_TOO_LARGE", "Stored file exceeds the processing size limit.")
                    chunks.append(chunk)
                return b"".join(chunks)
        except httpx.HTTPError as exc:
            raise TransientError("STORAGE_UNAVAILABLE", "Storage is temporarily unavailable; the job will be retried.") from exc

    def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> None:
        try:
            r = httpx.post(f"{self.base}/object/{bucket}/{path}", headers={**self.headers, "Content-Type": content_type, "x-upsert": "false"},
                           content=data, timeout=60)
        except httpx.HTTPError as exc:
            raise TransientError("STORAGE_UNAVAILABLE", "Storage is temporarily unavailable; the job will be retried.") from exc
        if r.status_code not in (200, 201):
            raise TransientError("STORAGE_UPLOAD_FAILED", "The generated file could not be stored; the job will be retried.")

    def remove(self, bucket: str, paths: list[str]) -> None:
        if paths:
            httpx.request("DELETE", f"{self.base}/object/{bucket}", headers=self.headers, json={"prefixes": paths}, timeout=30)
