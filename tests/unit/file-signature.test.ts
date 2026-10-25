import { describe, expect, it } from "vitest";
import { sniffType, validateUpload } from "@/lib/validation/file-signature";

const pdf = new TextEncoder().encode("%PDF-1.7 ...");
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
const csv = new TextEncoder().encode("Line item,FY2023\nRevenue,100\n");
const MB = 1024 * 1024;

describe("file signature validation", () => {
  it("sniffs supported types", () => {
    expect(sniffType(pdf)).toBe("pdf");
    expect(sniffType(zip)).toBe("xlsx");
    expect(sniffType(ole)).toBe("xls");
    expect(sniffType(csv)).toBe("csv");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBeNull(); // PNG has NUL bytes
  });
  it("accepts matching extension and content", () => {
    expect(validateUpload("fs.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip.length, zip, 25 * MB)).toEqual({ ok: true, type: "xlsx" });
    expect(validateUpload("is.csv", "text/csv", csv.length, csv, 25 * MB)).toEqual({ ok: true, type: "csv" });
  });
  it("rejects renamed files", () => {
    const r = validateUpload("statement.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf.length, pdf, 25 * MB);
    expect(r.ok).toBe(false);
  });
  it("rejects unsupported extensions, path characters, empty and oversize files", () => {
    expect(validateUpload("payload.exe", "application/octet-stream", 10, zip, 25 * MB).ok).toBe(false);
    expect(validateUpload("../../etc/passwd.csv", "text/csv", 10, csv, 25 * MB).ok).toBe(false);
    expect(validateUpload("empty.csv", "text/csv", 0, new Uint8Array(), 25 * MB).ok).toBe(false);
    expect(validateUpload("big.pdf", "application/pdf", 26 * MB, pdf, 25 * MB).ok).toBe(false);
  });
});
