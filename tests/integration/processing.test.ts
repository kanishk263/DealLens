import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadDocument } from "@/lib/storage/documents";
import {
  analyst, cleanup, companyUser, createCompany, db, drainWorker, makeSuperadmin, newSubmission, sampleFile, XLSX, type TestUser,
} from "./helpers";

const MB = 1024 * 1024;
let admin: TestUser, userA: TestUser, userB: TestUser, analystUser: TestUser;
let companyA: string, companyB: string, subA: string, docPath: string, docId: string;

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyA = await createCompany(admin, "Proc A");
  companyB = await createCompany(admin, "Proc B");
  userA = await companyUser(admin, companyA, "proca");
  userB = await companyUser(admin, companyB, "procb");
  analystUser = await analyst(admin, "procanalyst");
  subA = await newSubmission(userA, companyA);
  const up = await uploadDocument(userA.client, subA, sampleFile("northstar-financial-statements.xlsx", XLSX), "income_statement", 25 * MB, null);
  if (!up.ok) throw new Error(up.error);
  docId = up.documentId;
  const { rows } = await db().query("select storage_path from public.documents where id = $1", [docId]);
  docPath = rows[0].storage_path;
  const { error } = await userA.client.rpc("submit_submission", { p_submission: subA });
  if (error) throw error;
  drainWorker();
}, 240_000);
afterAll(cleanup);

describe("upload and processing pipeline", () => {
  it("stores metadata with a server-generated path and a SHA-256 checksum", async () => {
    const { data } = await userA.client.from("documents").select("storage_path, checksum, file_type, processing_status").eq("id", docId).single();
    expect(data?.storage_path.startsWith(`${companyA}/${subA}/${docId}/`)).toBe(true);
    expect(data?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(data?.processing_status).toBe("processed");
  });

  it("moves the submission to awaiting_review only after results are persisted", async () => {
    const { data } = await userA.client.from("submissions").select("submission_status, current_analysis_version").eq("id", subA).single();
    expect(data?.submission_status).toBe("awaiting_review");
    expect(data?.current_analysis_version).toBe(1);
    const { data: jobs } = await userA.client.from("processing_jobs").select("job_type, job_status").eq("submission_id", subA);
    expect(jobs?.every((j) => j.job_status === "succeeded")).toBe(true);
    expect(jobs?.map((j) => j.job_type).sort()).toEqual(["analyze_submission", "extract_document"]);
  });

  it("preserves source labels, raw values and cell references", async () => {
    const { data } = await userA.client.from("financial_line_items")
      .select("original_label, raw_value, parsed_value, normalized_value, source_sheet, source_cell_reference, mapping_status, normalized_category")
      .eq("submission_id", subA).eq("normalized_category", "cogs");
    expect(data?.length).toBe(3);
    const row = data![0];
    expect(row.original_label).toBe("Cost of sales");
    expect(Number(row.parsed_value)).toBeLessThan(0);           // presented negative in the source
    expect(Number(row.normalized_value)).toBeGreaterThan(0);    // normalised to a positive expense
    expect(row.source_sheet).toBe("Income Statement");
    expect(row.source_cell_reference).toMatch(/^[B-D]\d+$/);
  });

  it("persists metrics with provenance", async () => {
    const { data } = await userA.client.from("financial_metrics").select("metric_value, calculation_inputs, source_line_item_ids, formula_version, metric_status")
      .eq("submission_id", subA).eq("metric_key", "ebitda").eq("analysis_version", 1);
    expect(data?.length).toBe(3);
    expect(data!.every((m) => m.source_line_item_ids.length >= 2 && m.formula_version === "v1")).toBe(true);
    expect(data!.map((m) => Number(m.metric_value)).sort((a, b) => a - b)).toEqual([8640, 9252, 10194]);
  });

  it("records reconciliations as reconciled for the consistent synthetic statements", async () => {
    const { data } = await userA.client.from("reconciliations").select("check_key, status").eq("submission_id", subA).eq("check_key", "balance_sheet");
    expect(data?.every((r) => r.status === "reconciled")).toBe(true);
  });
});

describe("document access control", () => {
  it("the owning company can create a signed URL", async () => {
    const { data, error } = await userA.client.storage.from("documents").createSignedUrl(docPath, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it("another company cannot read the document row, its line items or the stored object by guessing the path", async () => {
    const { data: row } = await userB.client.from("documents").select("id").eq("id", docId).maybeSingle();
    expect(row).toBeNull();
    const { data: items } = await userB.client.from("financial_line_items").select("id").eq("submission_id", subA);
    expect(items).toEqual([]);
    const { error } = await userB.client.storage.from("documents").createSignedUrl(docPath, 60);
    expect(error).not.toBeNull();
    const { error: dlError } = await userB.client.storage.from("documents").download(docPath);
    expect(dlError).not.toBeNull();
  });

  it("superadmins see document metadata but not file contents or financial data", async () => {
    const { data: meta } = await admin.client.from("documents").select("id").eq("id", docId).maybeSingle();
    expect(meta?.id).toBe(docId);
    const { error } = await admin.client.storage.from("documents").createSignedUrl(docPath, 60);
    expect(error).not.toBeNull();
    const { data: items } = await admin.client.from("financial_line_items").select("id").eq("submission_id", subA);
    expect(items).toEqual([]);
  });

  it("the anonymous role cannot list or read anything", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data } = await anon.from("documents").select("id");
    expect(data ?? []).toEqual([]);
    const { error } = await anon.storage.from("documents").download(docPath);
    expect(error).not.toBeNull();
  });

  it("an analyst in scope (unassigned queue) can read content; documents cannot be added after submission", async () => {
    const { data: items } = await analystUser.client.from("financial_line_items").select("id").eq("submission_id", subA).limit(1);
    expect(items?.length).toBe(1);
    const up = await uploadDocument(userA.client, subA, sampleFile("apex-financial-statements.csv", "text/csv"), "income_statement", 25 * MB, null);
    expect(up.ok).toBe(false);
  });

  it("company users only see client-visible data-quality issues", async () => {
    const { rows } = await db().query("select count(*)::int as n from public.data_quality_issues where submission_id = $1 and not client_visible", [subA]);
    const { data } = await userA.client.from("data_quality_issues").select("client_visible").eq("submission_id", subA);
    expect(data?.every((i) => i.client_visible)).toBe(true);
    const { data: all } = await analystUser.client.from("data_quality_issues").select("id").eq("submission_id", subA);
    expect(all!.length).toBe((data?.length ?? 0) + rows[0].n);
  });
});

describe("failure handling", () => {
  it("rejects scanned PDFs with a clear, persisted error and allows a retry", async () => {
    const sub = await newSubmission(userA, companyA, "Scanned");
    const up = await uploadDocument(userA.client, sub, sampleFile("scanned-statement-unsupported.pdf", "application/pdf"), "income_statement", 25 * MB, null);
    if (!up.ok) throw new Error(up.error);
    await userA.client.rpc("submit_submission", { p_submission: sub });
    drainWorker();
    const { data: s } = await userA.client.from("submissions").select("submission_status").eq("id", sub).single();
    expect(s?.submission_status).toBe("processing_failed");
    const { data: d } = await userA.client.from("documents").select("processing_status, extraction_metadata").eq("id", up.documentId).single();
    expect(d?.processing_status).toBe("unsupported");
    expect((d?.extraction_metadata as { error_code: string }).error_code).toBe("SCANNED_PDF_UNSUPPORTED");
    const { data: job } = await userA.client.from("processing_jobs").select("job_status, safe_error_message").eq("document_id", up.documentId).single();
    expect(job?.job_status).toBe("failed");
    expect(job?.safe_error_message).toMatch(/OCR is not supported/);
    const { data: notes } = await userA.client.from("notifications").select("notification_type").eq("notification_type", "processing_failed");
    expect(notes?.length).toBeGreaterThan(0);
    const retry = await userA.client.rpc("retry_processing", { p_submission: sub });
    expect(retry.error).toBeNull();
  });

  it("flags duplicate uploads by checksum", async () => {
    const sub = await newSubmission(userA, companyA, "Dup");
    const up = await uploadDocument(userA.client, sub, sampleFile("northstar-financial-statements.xlsx", XLSX), "income_statement", 25 * MB, null);
    expect(up.ok && up.possibleDuplicateOf).toBe(docId);
  });

  it("is idempotent: re-processing a document replaces its line items instead of duplicating them", async () => {
    const before = await db().query("select count(*)::int as n from public.financial_line_items where source_document_id = $1", [docId]);
    await db().query("insert into public.processing_jobs (submission_id, document_id, job_type) values ($1, $2, 'extract_document')", [subA, docId]);
    drainWorker();
    const after = await db().query("select count(*)::int as n from public.financial_line_items where source_document_id = $1", [docId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const { data } = await userA.client.from("submissions").select("current_analysis_version").eq("id", subA).single();
    expect(data?.current_analysis_version).toBe(2);
  });
});
