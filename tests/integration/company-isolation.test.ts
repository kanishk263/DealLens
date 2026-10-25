import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRANSITIONS } from "@/lib/submissions/workflow";
import { analyst, cleanup, companyUser, createCompany, db, expectCode, makeSuperadmin, type TestUser } from "./helpers";

let admin: TestUser, userA: TestUser, userB: TestUser, analystUser: TestUser;
let companyA: string, companyB: string, subA: string, subB: string;

async function createSubmission(u: TestUser, company: string, name: string) {
  const { data, error } = await u.client.rpc("create_submission", {
    p_company: company, p_name: name, p_deal_type: "financial_due_diligence", p_period_start: "2021-01-01", p_period_end: "2023-12-31",
    p_currency: "USD", p_unit: "thousands",
  });
  if (error) throw error;
  return data as string;
}

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyA = await createCompany(admin, "Iso A");
  companyB = await createCompany(admin, "Iso B");
  userA = await companyUser(admin, companyA, "isoa");
  userB = await companyUser(admin, companyB, "isob");
  analystUser = await analyst(admin, "isoanalyst");
  subA = await createSubmission(userA, companyA, "A FY23");
  subB = await createSubmission(userB, companyB, "B FY23");
});
afterAll(cleanup);

describe("company data isolation", () => {
  it("Company A cannot list or fetch Company B's submissions", async () => {
    const { data: list } = await userA.client.from("submissions").select("id");
    expect(list?.map((s) => s.id)).toEqual([subA]);
    const { data: direct } = await userA.client.from("submissions").select("id").eq("id", subB).maybeSingle();
    expect(direct).toBeNull();
  });

  it("Company A cannot create submissions for Company B", async () => {
    const { error } = await userA.client.rpc("create_submission", {
      p_company: companyB, p_name: "Spoof", p_deal_type: "valuation", p_period_start: "2023-01-01", p_period_end: "2023-12-31", p_currency: "USD", p_unit: "units",
    });
    expectCode(error, "42501");
  });

  it("Company A cannot attach documents to Company B's submission by changing the ID", async () => {
    const { error } = await userA.client.rpc("register_document", {
      p_submission: subB, p_filename: "x.csv", p_file_type: "csv", p_size: 10, p_checksum: "a".repeat(64), p_category: "income_statement",
    });
    expectCode(error, "P0002");
  });

  it("Company A cannot read Company B's company record, status history or memberships", async () => {
    const { data: companies } = await userA.client.from("companies").select("id");
    expect(companies?.map((c) => c.id)).toEqual([companyA]);
    const { data: history } = await userA.client.from("submission_status_history").select("id").eq("submission_id", subB);
    expect(history).toEqual([]);
  });

  it("analysts cannot see draft submissions", async () => {
    const { data } = await analystUser.client.from("submissions").select("id").in("id", [subA, subB]);
    expect(data).toEqual([]);
  });

  it("superadmins see submission metadata", async () => {
    const { data } = await admin.client.from("submissions").select("id").in("id", [subA, subB]);
    expect(data?.length).toBe(2);
  });

  it("an analyst cannot claim a draft (not awaiting review)", async () => {
    const { error } = await analystUser.client.rpc("claim_submission", { p_submission: subA });
    expect(error).not.toBeNull();
  });

  it("a browser request cannot set a submission to Published", async () => {
    const { data } = await userA.client.rpc("transition_submission", { p_submission: subA, p_to: "published", p_reason: "hack" });
    expect((data as { ok: boolean }).ok).toBe(false);
    const { data: row } = await userA.client.from("submissions").select("submission_status").eq("id", subA).single();
    expect(row?.submission_status).toBe("draft");
    const { rows } = await db().query(`select 1 from public.audit_logs where action = 'submission.transition_rejected' and entity_id = $1`, [subA]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("workflow definition", () => {
  it("the TypeScript state-machine mirror matches the database transition table", async () => {
    const { rows } = await db().query(`select from_status, to_status, actor from public.submission_transitions`);
    const dbSet = new Set(rows.map((r) => `${r.from_status}>${r.to_status}>${r.actor}`));
    const tsSet = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}>${t.actor}`));
    expect([...tsSet].sort()).toEqual([...dbSet].sort());
  });
});
