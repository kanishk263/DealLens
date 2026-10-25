/**
 * Upload validation by content signature (magic bytes), mirroring processing/deallens_worker/extraction/signatures.py.
 * The worker re-validates every file; this check rejects obvious mismatches before anything is stored.
 */
export const ALLOWED_TYPES = {
  xlsx: { mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], label: "Excel workbook (.xlsx)" },
  xls: { mimes: ["application/vnd.ms-excel"], label: "Excel 97-2003 workbook (.xls)" },
  csv: { mimes: ["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv"], label: "CSV" },
  pdf: { mimes: ["application/pdf"], label: "PDF (text-based)" },
} as const;
export type FileType = keyof typeof ALLOWED_TYPES;

export const STORAGE_CONTENT_TYPE: Record<FileType, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  pdf: "application/pdf",
};

export const HARD_MAX_BYTES = 50 * 1024 * 1024;

export function extensionType(filename: string): FileType | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext in ALLOWED_TYPES ? (ext as FileType) : null;
}

function startsWith(bytes: Uint8Array, sig: number[]) {
  return sig.every((b, i) => bytes[i] === b);
}

/** Returns the type implied by the content, or null if it matches no supported signature. */
export function sniffType(bytes: Uint8Array): FileType | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // ZIP container (worker verifies workbook parts and rejects macros)
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "xls"; // OLE2
  const sample = bytes.subarray(0, Math.min(bytes.length, 65536));
  if (sample.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return "csv";
  } catch {
    // Windows-1252 text is also accepted: any byte sequence without NULs decodes.
    return "csv";
  }
}

export type ValidationResult = { ok: true; type: FileType } | { ok: false; error: string };

export function validateUpload(filename: string, mime: string, size: number, bytes: Uint8Array, maxBytes: number): ValidationResult {
  if (!filename || filename.length > 255) return { ok: false, error: "File name is missing or too long." };
  if (/[\\/\0]/.test(filename)) return { ok: false, error: "File name contains invalid characters." };
  const ext = extensionType(filename);
  if (!ext) return { ok: false, error: "Unsupported file type. Upload XLSX, XLS, CSV or text-based PDF files." };
  if (size <= 0) return { ok: false, error: "The file is empty." };
  if (size > Math.min(maxBytes, HARD_MAX_BYTES)) return { ok: false, error: `The file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.` };
  if (mime && !(ALLOWED_TYPES[ext].mimes as readonly string[]).includes(mime) && mime !== "application/octet-stream") {
    return { ok: false, error: `The browser reported an unexpected content type for a .${ext} file.` };
  }
  const sniffed = sniffType(bytes);
  if (sniffed !== ext) {
    return { ok: false, error: `The file content does not match its .${ext} extension${sniffed ? ` (looks like ${sniffed.toUpperCase()})` : ""}.` };
  }
  return { ok: true, type: ext };
}
