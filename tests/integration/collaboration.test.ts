import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadDocument } from "@/lib/storage/documents";
import {
  analyst, cleanup, companyUser, createCompany, drainWorker, expectCode, makeSuperadmin, newSubmission, reviewer, sampleFile, XLSX, type TestUser,
} from "./helpers";

let admin: TestUser, company: TestUser, otherCompany: TestUser, owner: TestUser, rev: TestUser;
let companyId: string, sub: string, internalId: string, clientId: string;

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyId = await createCompany(admin, "Collab Co");
  const otherId = await createCompany(admin, "Collab Other");
  company = await companyUser(admin, companyId, "collab");
  otherCompany = await companyUser(admin, otherId, "collabother");
  owner = await analyst(admin, "collabowner");
  rev = await reviewer(admin);
  sub = await newSubmission(company, companyId);
  const up = await uploadDocument(company.client, sub, sampleFile("northstar-financial-statements.xlsx", XLSX), "income_statement", 25 * 1024 * 1024, null);
  if (!up.ok) throw new Error(up.error);
  await company.client.rpc("submit_submission", { p_submission: sub });
  drainWorker();
  await owner.client.rpc("claim_submission", { p_submission: sub });
}, 240_000);
afterAll(cleanup);

const finding = (u: TestUser, title: string, visibility: "internal" | "client_visible") => u.client.rpc("save_finding", {
  p_id: null, p_submission: sub, p_category: "working_capital", p_title: title, p_description: `${title} description`, p_severity: "medium",
  p_impact: 250, p_impact_currency: "USD", p_source_references: [{ reference: "Balance Sheet!D8" }], p_recommendation: "Discuss", p_visibility: visibility,
});

describe("findings visibility", () => {
  it("creates findings with sequential reference codes", async () => {
    const a = await finding(owner, "Internal working note", "internal");
    const b = await finding(owner, "Receivables build-up", "client_visible");
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    internalId = a.data as string;
    clientId = b.data as string;
    const { data } = await owner.client.from("findings").select("reference_code").eq("submission_id", sub).order("reference_code");
    expect(data?.map((f) => f.reference_code)).toEqual(["F-001", "F-002"]);
  });

  it("company users see no findings before approval", async () => {
    const { data } = await company.client.from("findings").select("id").eq("submission_id", sub);
    expect(data).toEqual([]);
  });

  it("an analyst cannot approve their own finding; a reviewer can", async () => {
    expectCode((await owner.client.rpc("set_finding_status", { p_finding: clientId, p_status: "approved" })).error, "42501");
    expect((await rev.client.rpc("set_finding_status", { p_finding: clientId, p_status: "approved" })).error).toBeNull();
    expect((await rev.client.rpc("set_finding_status", { p_finding: internalId, p_status: "approved" })).error).toBeNull();
  });

  it("after approval, company users see only client-visible findings and client-visible comments", async () => {
    await owner.client.rpc("add_finding_comment", { p_finding: clientId, p_text: "Internal: DSO doubled, chase ageing", p_visibility: "internal" });
    await owner.client.rpc("add_finding_comment", { p_finding: clientId, p_text: "Please provide the ageing report", p_visibility: "client_visible" });
    await owner.client.rpc("add_finding_comment", { p_finding: internalId, p_text: "client-visible flag on an internal finding", p_visibility: "client_visible" });
    const { data: f } = await company.client.from("findings").select("id").eq("submission_id", sub);
    expect(f?.map((x) => x.id)).toEqual([clientId]);
    const { data: c } = await company.client.from("finding_comments").select("comment_text");
    expect(c?.map((x) => x.comment_text)).toEqual(["Please provide the ageing report"]);
  });

  it("editing an approved finding resets it to draft", async () => {
    await owner.client.rpc("save_finding", { p_id: clientId, p_submission: sub, p_category: "working_capital", p_title: "Receivables build-up (revised)", p_description: "revised",
      p_severity: "high", p_impact: null, p_impact_currency: null, p_source_references: [], p_recommendation: null, p_visibility: "client_visible" });
    const { data } = await owner.client.from("findings").select("status").eq("id", clientId).single();
    expect(data?.status).toBe("draft");
    const { data: companyView } = await company.client.from("findings").select("id").eq("submission_id", sub);
    expect(companyView).toEqual([]);
  });

  it("company users cannot create or edit findings", async () => {
    expectCode((await finding(company, "Fake", "client_visible")).error, "42501");
  });
});

describe("clarifications", () => {
  let clarId: string;
  it("an analyst request moves the submission to clarification_required and notifies the company", async () => {
    const { data, error } = await owner.client.rpc("create_clarification", { p_submission: sub, p_question: "Please explain the FY2024 receivables increase.", p_requested_documents: "AR ageing" });
    expect(error).toBeNull();
    clarId = data as string;
    const { data: s } = await company.client.from("submissions").select("submission_status").eq("id", sub).single();
    expect(s?.submission_status).toBe("clarification_required");
    const { data: n } = await company.client.from("notifications").select("notification_type").eq("notification_type", "clarification_requested");
    expect(n?.length).toBe(1);
    const { data: other } = await otherCompany.client.from("notifications").select("id").eq("notification_type", "clarification_requested");
    expect(other).toEqual([]);
  });

  it("another company cannot respond; the owning company can respond and attach a document", async () => {
    const bad = await otherCompany.client.rpc("respond_clarification", { p_clarification: clarId, p_response: "hijack" });
    expect(bad.error).not.toBeNull();
    const up = await uploadDocument(company.client, sub, sampleFile("apex-financial-statements.csv", "text/csv"), "accounts_receivable", 25 * 1024 * 1024, clarId);
    expect(up.ok).toBe(true);
    const ok = await company.client.rpc("respond_clarification", { p_clarification: clarId, p_response: "Growth reflects a new distributor with 90-day terms." });
    expect(ok.error).toBeNull();
    const { data: n } = await owner.client.from("notifications").select("id").eq("notification_type", "clarification_answered");
    expect(n?.length).toBe(1);
  });

  it("resolving the last request returns the submission to analysis and queues the attachment", async () => {
    expect((await owner.client.rpc("resolve_clarification", { p_clarification: clarId, p_status: "resolved" })).error).toBeNull();
    const { data: s } = await owner.client.from("submissions").select("submission_status").eq("id", sub).single();
    expect(s?.submission_status).toBe("in_analysis");
    const { data: jobs } = await owner.client.from("processing_jobs").select("job_status").eq("submission_id", sub).eq("job_status", "queued");
    expect(jobs?.length).toBeGreaterThan(0);
    drainWorker();
  });
});
