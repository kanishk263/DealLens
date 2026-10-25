import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadDocument } from "@/lib/storage/documents";
import { valueDcf, type DcfInput } from "@/lib/valuation/dcf";
import { ENGINE_VERSION } from "@/lib/valuation/common";
import {
  analyst, cleanup, companyUser, createCompany, db, drainWorker, expectCode, makeSuperadmin, newSubmission, reviewer, sampleFile, XLSX, type TestUser,
} from "./helpers";

const SECRET = "INTERNAL-ONLY-7f3a";
let admin: TestUser, company: TestUser, otherCompany: TestUser, owner: TestUser, outsider: TestUser, rev: TestUser;
let companyId: string, sub: string, reportId: string;

const ALL_SECTIONS = ["executive_summary", "scope_methodology", "overview", "data_quality", "revenue", "profitability", "ebitda", "working_capital", "debt_cash_flow", "findings", "valuation", "limitations", "appendix"];

async function pdfText(u: TestUser, storagePath: string): Promise<string> {
  const { data, error } = await u.client.storage.from("reports").download(storagePath);
  if (error || !data) throw error ?? new Error("download failed");
  const dir = path.resolve(__dirname, "../../test-results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `report-${Date.now()}.pdf`);
  writeFileSync(file, Buffer.from(await data.arrayBuffer()));
  return execFileSync(path.resolve(__dirname, "../../processing/.venv/bin/python"), ["-c",
    "import sys, pdfplumber\nwith pdfplumber.open(sys.argv[1]) as p:\n  print('\\n'.join((pg.extract_text() or '') for pg in p.pages))\n  print(p.metadata)", file]).toString();
}

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyId = await createCompany(admin, "Report Co");
  const otherId = await createCompany(admin, "Report Other");
  company = await companyUser(admin, companyId, "reportco");
  otherCompany = await companyUser(admin, otherId, "reportother");
  [owner, outsider] = await Promise.all([analyst(admin, "reportowner"), analyst(admin, "reportoutsider")]);
  rev = await reviewer(admin);
  sub = await newSubmission(company, companyId, "FY22-24 report test");
  const up = await uploadDocument(company.client, sub, sampleFile("northstar-financial-statements.xlsx", XLSX), "income_statement", 25 * 1024 * 1024, null);
  if (!up.ok) throw new Error(up.error);
  await company.client.rpc("submit_submission", { p_submission: sub });
  drainWorker();
  await owner.client.rpc("claim_submission", { p_submission: sub });
  const mk = (title: string, visibility: string, description: string) => owner.client.rpc("save_finding", {
    p_id: null, p_submission: sub, p_category: "working_capital", p_title: title, p_description: description, p_severity: "high", p_impact: null,
    p_impact_currency: null, p_source_references: [{ reference: "Balance Sheet!D7" }], p_recommendation: "Agree a normalised peg", p_visibility: visibility });
  const client = await mk("Receivables build-up", "client_visible", "DSO increased over the period.");
  const internal = await mk(`Internal concern ${SECRET}`, "internal", `Do not share ${SECRET}`);
  for (const f of [client.data, internal.data]) await rev.client.rpc("set_finding_status", { p_finding: f, p_status: "approved" });
  await owner.client.rpc("add_finding_comment", { p_finding: client.data, p_text: `note ${SECRET}`, p_visibility: "internal" });
  const input: DcfInput = { currency: "USD", baseYearLabel: "FY2024", baseRevenue: 55100, baseNetWorkingCapital: 9800, years: 3, revenueGrowth: [0.05, 0.04, 0.03],
    ebitdaMargin: [0.18, 0.18, 0.18], daPctRevenue: [0.04, 0.04, 0.04], capexPctRevenue: [0.05, 0.05, 0.05], nwcPctRevenue: [0.18, 0.18, 0.18],
    taxRate: 0.25, wacc: 0.1, terminalGrowth: 0.02, midYear: false, netDebt: 5453, otherBridgeItems: [] };
  const { data: model } = await owner.client.rpc("save_valuation_model", { p_submission: sub, p_model_name: "DCF base", p_method: "dcf", p_assumptions: { wacc: 0.1, terminalGrowth: 0.02 },
    p_inputs: input, p_outputs: JSON.parse(JSON.stringify(valueDcf(input))), p_currency: "USD", p_engine_version: ENGINE_VERSION, p_comments: SECRET });
  await rev.client.rpc("review_valuation_model", { p_model: model, p_status: "approved", p_notes: `ok ${SECRET}` });
}, 300_000);
afterAll(cleanup);

describe("report lifecycle", () => {
  it("creates a draft and renders a PDF from a client-safe snapshot", async () => {
    const { data, error } = await owner.client.rpc("create_report_draft", { p_submission: sub, p_title: "Financial Due Diligence Report", p_type: "financial_due_diligence",
      p_config: { sections: ALL_SECTIONS, executive_summary: "Steady growth with stable margins.", limitations: "" } });
    expect(error).toBeNull();
    reportId = data as string;
    drainWorker();
    const { data: r } = await owner.client.from("reports").select("status, storage_path, snapshot, is_final_render, content_checksum").eq("id", reportId).single();
    expect(r?.storage_path).toMatch(/-draft-\d+\.pdf$/);
    expect(r?.is_final_render).toBe(false);
    expect(r?.content_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(r?.snapshot)).not.toContain(SECRET);
    expect((r?.snapshot as { findings: unknown[] }).findings.length).toBe(1);
    const text = await pdfText(owner, r!.storage_path!);
    expect(text).toContain("Receivables build-up");
    expect(text).toContain("DRAFT");
    expect(text).toContain("DCF base");
    expect(text).not.toContain(SECRET);
  });

  it("company users cannot see or download unpublished reports", async () => {
    const { data } = await company.client.from("reports").select("id").eq("id", reportId);
    expect(data).toEqual([]);
    const { data: r } = await owner.client.from("reports").select("storage_path").eq("id", reportId).single();
    const { error } = await company.client.storage.from("reports").createSignedUrl(r!.storage_path!, 60);
    expect(error).not.toBeNull();
  });

  it("an analyst cannot approve, a reviewer cannot approve their own report, and publication needs approval", async () => {
    expect((await owner.client.rpc("submit_report_for_review", { p_report: reportId })).error).toBeNull();
    expectCode((await owner.client.rpc("review_report", { p_report: reportId, p_decision: "approved", p_notes: "self" })).error, "42501");
    expectCode((await owner.client.rpc("publish_report", { p_report: reportId })).error, "55000");
    const { data: s } = await owner.client.from("submissions").select("submission_status").eq("id", sub).single();
    expect(s?.submission_status).toBe("under_review");
  });

  it("reviewer approval triggers a final render of the same snapshot with approval metadata", async () => {
    const { data: before } = await owner.client.from("reports").select("snapshot").eq("id", reportId).single();
    expect((await rev.client.rpc("review_report", { p_report: reportId, p_decision: "approved", p_notes: "Approved for issue" })).error).toBeNull();
    drainWorker();
    const { data: r } = await owner.client.from("reports").select("status, storage_path, snapshot, is_final_render").eq("id", reportId).single();
    expect(r).toMatchObject({ status: "approved", is_final_render: true });
    expect(r?.snapshot).toEqual(before?.snapshot);
    const text = await pdfText(owner, r!.storage_path!);
    expect(text).not.toContain("DRAFT — NOT APPROVED");
    expect(text).toContain("Approved by");
  });

  it("an analyst who is not assigned cannot publish; the assigned analyst can", async () => {
    expect((await outsider.client.rpc("publish_report", { p_report: reportId })).error).not.toBeNull();
    expect((await owner.client.rpc("publish_report", { p_report: reportId })).error).toBeNull();
    const { data: s } = await owner.client.from("submissions").select("submission_status, published_at").eq("id", sub).single();
    expect(s?.submission_status).toBe("published");
    expect(s?.published_at).toBeTruthy();
  });

  it("the owning company can download the published report; another company cannot, even with the ID and path", async () => {
    const { data: r } = await company.client.from("reports").select("storage_path, status").eq("id", reportId).single();
    expect(r?.status).toBe("published");
    const { data: url, error } = await company.client.storage.from("reports").createSignedUrl(r!.storage_path!, 60);
    expect(error).toBeNull();
    expect(url?.signedUrl).toBeTruthy();
    const { data: other } = await otherCompany.client.from("reports").select("id").eq("id", reportId);
    expect(other).toEqual([]);
    const { error: otherErr } = await otherCompany.client.storage.from("reports").createSignedUrl(r!.storage_path!, 60);
    expect(otherErr).not.toBeNull();
    const { data: n } = await company.client.from("notifications").select("id").eq("notification_type", "report_published");
    expect(n?.length).toBe(1);
  });

  it("published reports are immutable", async () => {
    await expect(db().query("update public.reports set report_title = 'tampered', config = '{}'::jsonb where id = $1", [reportId])).rejects.toThrow(/immutable/);
    await expect(db().query("delete from public.reports where id = $1", [reportId])).rejects.toThrow(/cannot be deleted/);
  });

  it("a new version supersedes the published one without altering it", async () => {
    expect(((await owner.client.rpc("transition_submission", { p_submission: sub, p_to: "in_analysis", p_reason: "v2" })).data as { ok: boolean }).ok).toBe(true);
    const { data: v2, error } = await owner.client.rpc("create_report_draft", { p_submission: sub, p_title: "Financial Due Diligence Report", p_type: "financial_due_diligence",
      p_config: { sections: ["executive_summary", "findings"], executive_summary: "Updated.", limitations: "" } });
    expect(error).toBeNull();
    drainWorker();
    await owner.client.rpc("submit_report_for_review", { p_report: v2 });
    await rev.client.rpc("review_report", { p_report: v2, p_decision: "approved", p_notes: "ok" });
    drainWorker();
    expect((await rev.client.rpc("publish_report", { p_report: v2 })).error).toBeNull();
    const { data } = await company.client.from("reports").select("report_version, status").eq("submission_id", sub).order("report_version");
    expect(data).toEqual([{ report_version: 1, status: "superseded" }, { report_version: 2, status: "published" }]);
  });
});
