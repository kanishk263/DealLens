"""File-type verification by content signature (magic bytes), never by extension alone."""
from __future__ import annotations

import io
import zipfile

from ..errors import MalformedDocument, UnsupportedDocument

MAX_ZIP_UNCOMPRESSED = 250 * 1024 * 1024   # zip-bomb guard for .xlsx
MAX_ZIP_ENTRIES = 5000

OLE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")


def detect_type(data: bytes, declared: str) -> str:
    """Return the verified file type or raise. `declared` is the type recorded at upload."""
    if not data:
        raise MalformedDocument("EMPTY_FILE", "The file is empty.")
    if data.startswith(b"%PDF-"):
        actual = "pdf"
    elif data.startswith(b"PK\x03\x04"):
        actual = _verify_xlsx(data)
    elif data.startswith(OLE_MAGIC):
        actual = "xls"
    elif _looks_like_text(data):
        actual = "csv"
    else:
        raise UnsupportedDocument("UNSUPPORTED_FILE_TYPE", "The file content does not match a supported type (XLSX, XLS, CSV or PDF).")
    if actual != declared:
        raise UnsupportedDocument(
            "FILE_SIGNATURE_MISMATCH",
            f"The file extension says {declared.upper()} but the content is {actual.upper()}. Re-export the file and upload it again.",
        )
    return actual


def _verify_xlsx(data: bytes) -> str:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise MalformedDocument("CORRUPT_WORKBOOK", "The workbook could not be opened; it may be corrupt.") from exc
    infos = zf.infolist()
    if len(infos) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_ZIP_UNCOMPRESSED:
        raise MalformedDocument("WORKBOOK_TOO_LARGE", "The workbook expands beyond the supported size limit.")
    names = {i.filename for i in infos}
    if "[Content_Types].xml" not in names or not any(n.startswith("xl/") for n in names):
        raise UnsupportedDocument("UNSUPPORTED_FILE_TYPE", "The archive is not an Excel workbook.")
    if any(n.lower().endswith("vbaproject.bin") for n in names):
        raise UnsupportedDocument(
            "MACRO_WORKBOOK_UNSUPPORTED",
            "Macro-enabled workbooks are not accepted. Save the workbook as a standard .xlsx without macros and upload it again.",
        )
    return "xlsx"


def _looks_like_text(data: bytes) -> bool:
    sample = data[:65536]
    if b"\x00" in sample:
        return False
    for enc in ("utf-8-sig", "cp1252"):
        try:
            sample.decode(enc)
            return True
        except UnicodeDecodeError:
            continue
    return False
