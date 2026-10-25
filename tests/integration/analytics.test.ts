import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadDocument } from "@/lib/storage/documents";
import {
  analyst, cleanup, companyUser, createCompany, drainWorker, expectCode, makeSuperadmin, newSubmission, reviewer, sampleFile, XLSX, type TestUser,
} from "./helpers";

let admin: TestUser, company: TestUser, owner: TestUser, rev: TestUser;
let companyId: string, sub: string, periodId: string;

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyId = await createCompany(admin, "Analytics Co");
  company = await companyUser(admin, companyId, "analyticsco");
  owner = await analyst(admin, "analyticsowner");
  rev = await reviewer(admin);
  sub = await newSubmission(company, companyId);
  const up = await uploadDocument(company.client, sub, sampleFile("meridian-financial-statements.xlsx", XLSX), "income_statement", 25 * 1024 * 1024, null);
  if (!up.ok) throw new Error(up.error);
  await company.client.rpc("submit_submission", { p_submission: sub });
  drainWorker();
  await owner.client.rpc("claim_submission", { p_submission: sub });
  const { data } = await owner.client.from("financial_periods").select("id").eq("submission_id", sub).eq("period_label", "FY2024").single();
  periodId = data!.id;
}, 240_000);
afterAll(cleanup);

describe("EBITDA adjustments", () => {
  let adjId: string;
  it("require evidence and rationale", async () => {
    const { error } = await owner.client.rpc("propose_ebitda_adjustment", { p_submission: sub, p_period: periodId, p_type: "restructuring", p_description: "Plant closure", p_amount: 900, p_sign: 1, p_evidence: "", p_rationale: "short" });
    expectCode(error, "22023");
  });
  it("cannot be approved by the proposer (four-eyes) but can be by a reviewer", async () => {
    const { data, error } = await owner.client.rpc("propose_ebitda_adjustment", { p_submission: sub, p_period: periodId, p_type: "restructuring", p_description: "Plant closure costs", p_amount: 1500, p_sign: 1, p_evidence: "Board minute 2024-03", p_rationale: "One-off closure of the Leeds plant, not expected to recur" });
    expect(error).toBeNull();
    adjId = data as string;
    const self = await owner.client.rpc("review_ebitda_adjustment", { p_adjustment: adjId, p_decision: "approved", p_notes: "ok" });
    expectCode(self.error, "42501");
    const ok = await rev.client.rpc("review_ebitda_adjustment", { p_adjustment: adjId, p_decision: "approved", p_notes: "Evidence agreed to board minute" });
    expect(ok.error).toBeNull();
  });
  it("are invisible to company users", async () => {
    const { data } = await company.client.from("ebitda_adjustments").select("id").eq("submission_id", sub);
    expect(data).toEqual([]);
  });
  it("feed the significant-adjustments red flag on re-analysis", async () => {
    await owner.client.rpc("request_reanalysis", { p_submission: sub });
    drainWorker();
    const { data } = await owner.client.from("red_flags").select("rule_key, is_active").eq("submission_id", sub).eq("rule_key", "significant_ebitda_adjustments");
    expect(data?.[0]?.is_active).toBe(true);
  });
});

describe("red flags", () => {
  it("are internal-only and require an explanation to review", async () => {
    const { data: companyView } = await company.client.from("red_flags").select("id").eq("submission_id", sub);
    expect(companyView).toEqual([]);
    const { data: flag } = await owner.client.from("red_flags").select("id").eq("submission_id", sub).limit(1).single();
    const noNotes = await owner.client.rpc("review_red_flag", { p_flag: flag!.id, p_status: "dismissed", p_notes: "" });
    expectCode(noNotes.error, "22023");
    const ok = await owner.client.rpc("review_red_flag", { p_flag: flag!.id, p_status: "escalated", p_notes: "Raised as finding F-001" });
    expect(ok.error).toBeNull();
  });
  it("keep their review status across re-analysis", async () => {
    const { data: before } = await owner.client.from("red_flags").select("id, review_status").eq("submission_id", sub).eq("review_status", "escalated").single();
    await owner.client.rpc("request_reanalysis", { p_submission: sub });
    drainWorker();
    const { data: after } = await owner.client.from("red_flags").select("review_status").eq("id", before!.id).single();
    expect(after?.review_status).toBe("escalated");
  });
});
