import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uploadDocument } from "@/lib/storage/documents";
import {
  analyst, cleanup, companyUser, createCompany, db, drainWorker, expectCode, makeSuperadmin, newSubmission, sampleFile, XLSX, type TestUser,
} from "./helpers";

let admin: TestUser, company: TestUser, a1: TestUser, a2: TestUser, a3: TestUser;
let companyId: string, sub: string;

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyId = await createCompany(admin, "Review Co");
  company = await companyUser(admin, companyId, "reviewco");
  [a1, a2, a3] = await Promise.all([analyst(admin, "ra1"), analyst(admin, "ra2"), analyst(admin, "ra3")]);
  sub = await newSubmission(company, companyId);
  const up = await uploadDocument(company.client, sub, sampleFile("meridian-financial-statements.xlsx", XLSX), "income_statement", 25 * 1024 * 1024, null);
  if (!up.ok) throw new Error(up.error);
  await company.client.rpc("submit_submission", { p_submission: sub });
  drainWorker();
}, 240_000);
afterAll(cleanup);

describe("claiming", () => {
  it("allows exactly one of two concurrent claims", async () => {
    const results = await Promise.all([a1.client.rpc("claim_submission", { p_submission: sub }), a2.client.rpc("claim_submission", { p_submission: sub })]);
    const ok = results.filter((r) => !r.error);
    expect(ok.length).toBe(1);
    const { rows } = await db().query("select count(*)::int as n from public.analysis_assignments where submission_id = $1 and assignment_status = 'active'", [sub]);
    expect(rows[0].n).toBe(1);
    const winner = results[0].error ? a2 : a1;
    const { data } = await winner.client.from("submissions").select("submission_status, assigned_analyst_id").eq("id", sub).single();
    expect(data?.submission_status).toBe("in_analysis");
    expect(data?.assigned_analyst_id).toBe(winner.id);
    // keep a deterministic owner for the rest of the suite
    (globalThis as { owner?: TestUser }).owner = winner;
  });

  it("an analyst outside scope can no longer see the claimed submission", async () => {
    const { data } = await a3.client.from("submissions").select("id").eq("id", sub);
    expect(data).toEqual([]);
    const { data: items } = await a3.client.from("financial_line_items").select("id").eq("submission_id", sub);
    expect(items).toEqual([]);
  });
});

describe("line-item corrections", () => {
  const owner = () => (globalThis as { owner?: TestUser }).owner!;

  it("maps an unmapped item with a mandatory reason, preserving the raw value and recording a revision", async () => {
    const { data: item } = await owner().client.from("financial_line_items").select("id, raw_value, parsed_value")
      .eq("submission_id", sub).eq("original_label", "Brand royalty pool").limit(1).single();
    const noReason = await owner().client.rpc("update_line_item", { p_line_item: item!.id, p_category: "other_operating_expenses", p_mapping_status: "analyst_mapped", p_normalized_value: 0, p_reason: "" });
    expectCode(noReason.error, "22023");
    const { error } = await owner().client.rpc("update_line_item", {
      p_line_item: item!.id, p_category: "other_operating_expenses", p_mapping_status: "analyst_mapped", p_normalized_value: 0, p_reason: "Royalty pool is an operating cost line",
    });
    expect(error).toBeNull();
    const { data: after } = await owner().client.from("financial_line_items").select("raw_value, parsed_value, normalized_category, mapping_status, reviewed_by").eq("id", item!.id).single();
    expect(after?.raw_value).toBe(item!.raw_value);
    expect(after?.normalized_category).toBe("other_operating_expenses");
    expect(after?.reviewed_by).toBe(owner().id);
    const { data: revs } = await owner().client.from("line_item_revisions").select("reason, previous, next").eq("line_item_id", item!.id);
    expect(revs?.length).toBe(1);
    expect((revs![0].previous as { mapping_status: string }).mapping_status).toBe("unmapped");
  });

  it("company users and out-of-scope analysts cannot correct data or read revision history", async () => {
    const { data: item } = await company.client.from("financial_line_items").select("id").eq("submission_id", sub).limit(1).single();
    const byCompany = await company.client.rpc("update_line_item", { p_line_item: item!.id, p_category: "revenue", p_mapping_status: "analyst_mapped", p_normalized_value: 1, p_reason: "tamper" });
    expectCode(byCompany.error, "42501");
    const byOther = await a3.client.rpc("update_line_item", { p_line_item: item!.id, p_category: "revenue", p_mapping_status: "analyst_mapped", p_normalized_value: 1, p_reason: "tamper" });
    expect(byOther.error).not.toBeNull();
    const { data: revs } = await company.client.from("line_item_revisions").select("id");
    expect(revs).toEqual([]);
  });

  it("recalculation produces a new analysis version and resolves issues that are no longer detected", async () => {
    const { data: rest } = await owner().client.from("financial_line_items").select("id").eq("submission_id", sub).eq("mapping_status", "unmapped");
    for (const r of rest ?? []) {
      const res = await owner().client.rpc("update_line_item", { p_line_item: r.id, p_category: "other_operating_expenses", p_mapping_status: "analyst_mapped", p_normalized_value: 0, p_reason: "Royalty pool is an operating cost line" });
      expect(res.error).toBeNull();
    }
    const { error } = await owner().client.rpc("request_reanalysis", { p_submission: sub });
    expect(error).toBeNull();
    drainWorker();
    const { data } = await owner().client.from("submissions").select("current_analysis_version, submission_status").eq("id", sub).single();
    expect(data?.current_analysis_version).toBe(2);
    expect(data?.submission_status).toBe("in_analysis");
    const { data: unmapped } = await owner().client.from("data_quality_issues").select("status, resolution_notes").eq("submission_id", sub).eq("issue_key", "unmapped_items").maybeSingle();
    expect(unmapped?.status).toBe("resolved");
    const { count } = await owner().client.from("financial_metrics").select("id", { count: "exact", head: true }).eq("submission_id", sub).eq("analysis_version", 1);
    expect(count).toBeGreaterThan(0); // prior versions retained
  });

  it("resolving a data-quality issue requires notes and is audited", async () => {
    const { data: issue } = await owner().client.from("data_quality_issues").select("id").eq("submission_id", sub).eq("issue_type", "reconciliation_variance").limit(1).single();
    const missing = await owner().client.rpc("review_data_quality_issue", { p_issue: issue!.id, p_status: "resolved", p_notes: "" });
    expectCode(missing.error, "22023");
    const ok = await owner().client.rpc("review_data_quality_issue", { p_issue: issue!.id, p_status: "acknowledged", p_notes: "Querying total assets with management" });
    expect(ok.error).toBeNull();
    const { rows } = await db().query("select 1 from public.audit_logs where action = 'data_quality.acknowledged' and entity_id = $1", [issue!.id]);
    expect(rows.length).toBe(1);
  });
});
