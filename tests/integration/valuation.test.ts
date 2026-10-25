import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadDocument } from "@/lib/storage/documents";
import { valueDcf, type DcfInput } from "@/lib/valuation/dcf";
import { ENGINE_VERSION } from "@/lib/valuation/common";
import { analyst, cleanup, companyUser, createCompany, drainWorker, expectCode, makeSuperadmin, newSubmission, reviewer, sampleFile, XLSX, type TestUser } from "./helpers";

let admin: TestUser, company: TestUser, owner: TestUser, rev: TestUser, other: TestUser;
let companyId: string, sub: string;
const input: DcfInput = { currency: "USD", baseYearLabel: "FY2024", baseRevenue: 55100, baseNetWorkingCapital: 9000, years: 2, revenueGrowth: [0.05, 0.04],
  ebitdaMargin: [0.18, 0.18], daPctRevenue: [0.04, 0.04], capexPctRevenue: [0.05, 0.05], nwcPctRevenue: [0.17, 0.17], taxRate: 0.25, wacc: 0.1,
  terminalGrowth: 0.02, midYear: false, netDebt: 5453, otherBridgeItems: [] };

const save = (u: TestUser, name = "DCF base") => {
  const out = valueDcf(input);
  return u.client.rpc("save_valuation_model", { p_submission: sub, p_model_name: name, p_method: "dcf", p_assumptions: { wacc: input.wacc },
    p_inputs: input, p_outputs: JSON.parse(JSON.stringify(out)), p_currency: "USD", p_engine_version: ENGINE_VERSION, p_comments: "test" });
};

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyId = await createCompany(admin, "Valuation Co");
  company = await companyUser(admin, companyId, "valco");
  [owner, other] = await Promise.all([analyst(admin, "valowner"), analyst(admin, "valother")]);
  rev = await reviewer(admin);
  sub = await newSubmission(company, companyId);
  const up = await uploadDocument(company.client, sub, sampleFile("northstar-financial-statements.xlsx", XLSX), "income_statement", 25 * 1024 * 1024, null);
  if (!up.ok) throw new Error(up.error);
  await company.client.rpc("submit_submission", { p_submission: sub });
  drainWorker();
  await owner.client.rpc("claim_submission", { p_submission: sub });
}, 240_000);
afterAll(cleanup);

describe("valuation models", () => {
  it("each save creates a new immutable version", async () => {
    expect((await save(owner)).error).toBeNull();
    expect((await save(owner)).error).toBeNull();
    const { data } = await owner.client.from("valuation_models").select("model_version").eq("submission_id", sub).order("model_version");
    expect(data?.map((m) => m.model_version)).toEqual([1, 2]);
  });

  it("stored inputs reproduce stored outputs", async () => {
    const { data } = await owner.client.from("valuation_models").select("calculation_inputs, calculation_outputs").eq("submission_id", sub).limit(1).single();
    const fresh = valueDcf(data!.calculation_inputs as DcfInput);
    expect(fresh.enterpriseValue).toBeCloseTo((data!.calculation_outputs as { enterpriseValue: number }).enterpriseValue, 6);
  });

  it("analysts outside scope cannot save; company users cannot see models", async () => {
    const { error } = await save(other, "Hijack");
    expect(error).not.toBeNull();
    const { data } = await company.client.from("valuation_models").select("id").eq("submission_id", sub);
    expect(data).toEqual([]);
  });

  it("only a reviewer other than the author can approve", async () => {
    const { data: m } = await owner.client.from("valuation_models").select("id").eq("submission_id", sub).eq("model_version", 2).single();
    expectCode((await owner.client.rpc("review_valuation_model", { p_model: m!.id, p_status: "approved", p_notes: "self" })).error, "42501");
    expect((await owner.client.rpc("review_valuation_model", { p_model: m!.id, p_status: "pending_review", p_notes: null })).error).toBeNull();
    expect((await rev.client.rpc("review_valuation_model", { p_model: m!.id, p_status: "approved", p_notes: "Assumptions reasonable" })).error).toBeNull();
    const { data } = await owner.client.from("valuation_models").select("review_status, reviewed_by").eq("id", m!.id).single();
    expect(data).toMatchObject({ review_status: "approved", reviewed_by: rev.id });
  });
});
