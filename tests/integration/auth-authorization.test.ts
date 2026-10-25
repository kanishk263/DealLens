import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient, analyst, approve, cleanup, companyUser, createCompany, createUser, db, expectCode, makeSuperadmin, type TestUser,
} from "./helpers";

let admin: TestUser;
let companyA: string;

beforeAll(async () => {
  admin = await makeSuperadmin();
  companyA = await createCompany(admin, "Auth Co");
});
afterAll(cleanup);

describe("account lifecycle", () => {
  it("creates a pending profile for a new authenticated user", async () => {
    const u = await createUser("newbie");
    const { data } = await u.client.from("profiles").select("account_status, email").eq("id", u.id).single();
    expect(data?.account_status).toBe("pending_approval");
    expect(data?.email).toBe(u.email);
  });

  it("blocks unapproved users from protected business records and operations", async () => {
    const u = await createUser("pending");
    const { data: companies } = await u.client.from("companies").select("id");
    expect(companies).toEqual([]);
    const { data: subs } = await u.client.from("submissions").select("id");
    expect(subs).toEqual([]);
    const { error } = await u.client.rpc("create_submission", {
      p_company: companyA, p_name: "x", p_deal_type: "valuation", p_period_start: "2023-01-01", p_period_end: "2023-12-31",
      p_currency: "USD", p_unit: "thousands",
    });
    expectCode(error, "42501");
  });

  it("approval grants the role and company membership", async () => {
    const u = await companyUser(admin, companyA, "approved");
    const { data: profile } = await u.client.from("profiles").select("account_status").eq("id", u.id).single();
    expect(profile?.account_status).toBe("active");
    const { data: companies } = await u.client.from("companies").select("id");
    expect(companies?.map((c) => c.id)).toEqual([companyA]);
  });

  it("a user cannot submit a second pending request or request a privileged role", async () => {
    const u = await createUser("dupe");
    const first = await u.client.rpc("submit_access_request", { p_company_name: "Org", p_justification: "Need access for testing", p_requested_role: "company_user" });
    expect(first.error).toBeNull();
    const second = await u.client.rpc("submit_access_request", { p_company_name: "Org", p_justification: "Need access for testing", p_requested_role: "company_user" });
    expectCode(second.error, "55000");
    const u2 = await createUser("escalate");
    const priv = await u2.client.rpc("submit_access_request", { p_company_name: "Org", p_justification: "I want to be superadmin", p_requested_role: "superadmin" });
    expectCode(priv.error, "22023");
  });

  it("rejection leaves the user without access", async () => {
    const u = await createUser("rejected");
    const { data: reqId } = await u.client.rpc("submit_access_request", { p_company_name: "Org", p_justification: "Please let me in", p_requested_role: "company_user" });
    const { error } = await admin.client.rpc("review_access_request", { p_request: reqId, p_decision: "rejected", p_notes: "Unknown requester" });
    expect(error).toBeNull();
    const { data: profile } = await u.client.from("profiles").select("account_status").eq("id", u.id).single();
    expect(profile?.account_status).toBe("rejected");
  });
});

describe("privilege escalation protections", () => {
  it("a normal user cannot grant themselves a role via RPC", async () => {
    const u = await companyUser(admin, companyA, "selfgrant");
    const { error } = await u.client.rpc("grant_role", { p_user: u.id, p_role: "superadmin" });
    expectCode(error, "42501");
  });

  it("a normal user cannot write role tables directly", async () => {
    const u = await companyUser(admin, companyA, "directwrite");
    const { data: role } = await u.client.from("roles").select("id").eq("role_key", "superadmin").single();
    const { error } = await u.client.from("user_roles").insert({ user_id: u.id, role_id: role!.id });
    expect(error?.code).toBe("42501");
    const { error: profileError } = await u.client.from("profiles").update({ account_status: "active" }).eq("id", u.id);
    expect(profileError?.code).toBe("42501");
  });

  it("only the service role can execute the superadmin bootstrap", async () => {
    const u = await createUser("bootstrap");
    const { error } = await u.client.rpc("bootstrap_superadmin", { p_user: u.id, p_expected_email: u.email });
    expect(error).not.toBeNull();
    const { data: roles } = await u.client.from("user_roles").select("id");
    expect(roles).toEqual([]);
  });

  it("the bootstrap rejects an identity whose verified email does not match", async () => {
    const u = await createUser("mismatch");
    const { error } = await adminClient().rpc("bootstrap_superadmin", { p_user: u.id, p_expected_email: "someone-else@example.com" });
    expectCode(error, "42501");
  });

  it("a superadmin cannot change their own roles or status", async () => {
    const r1 = await admin.client.rpc("revoke_role", { p_user: admin.id, p_role: "superadmin" });
    expectCode(r1.error, "42501");
    const r2 = await admin.client.rpc("set_account_status", { p_user: admin.id, p_status: "suspended", p_reason: "test" });
    expectCode(r2.error, "42501");
  });

  it("an analyst cannot perform administrative operations", async () => {
    const a = await analyst(admin, "notadmin");
    const { error } = await a.client.rpc("upsert_company", {
      p_id: null, p_legal_name: "Analyst Co", p_display_name: "Analyst Co", p_industry: null, p_country: null,
      p_currency: "USD", p_unit: "units", p_description: null,
    });
    expectCode(error, "42501");
  });
});

describe("suspension", () => {
  it("a suspended user cannot perform protected actions or read business data", async () => {
    const u = await companyUser(admin, companyA, "suspended");
    const { error: suspendError } = await admin.client.rpc("set_account_status", { p_user: u.id, p_status: "suspended", p_reason: "Policy breach test" });
    expect(suspendError).toBeNull();
    const { data: companies } = await u.client.from("companies").select("id");
    expect(companies).toEqual([]);
    const { error } = await u.client.rpc("create_submission", {
      p_company: companyA, p_name: "Blocked", p_deal_type: "valuation", p_period_start: "2023-01-01", p_period_end: "2023-12-31",
      p_currency: "USD", p_unit: "thousands",
    });
    expectCode(error, "42501");
  });
});

describe("invitations", () => {
  it("accepts a valid invitation only for the invited email, once", async () => {
    const invitee = await createUser("invitee");
    const other = await createUser("other");
    const { data: token, error } = await admin.client.rpc("create_invitation", { p_company: companyA, p_email: invitee.email });
    expect(error).toBeNull();
    const wrong = await other.client.rpc("accept_invitation", { p_token: token });
    expectCode(wrong.error, "42501");
    const ok = await invitee.client.rpc("accept_invitation", { p_token: token });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(companyA);
    const again = await invitee.client.rpc("accept_invitation", { p_token: token });
    expectCode(again.error, "42501");
  });

  it("rejects expired invitations", async () => {
    const invitee = await createUser("expired");
    const { data: token } = await admin.client.rpc("create_invitation", { p_company: companyA, p_email: invitee.email });
    await db().query(`update public.invitations set expires_at = now() - interval '1 minute' where email = $1`, [invitee.email]);
    const { error } = await invitee.client.rpc("accept_invitation", { p_token: token });
    expectCode(error, "42501");
  });

  it("only superadmins can read invitations (token hashes)", async () => {
    const u = await companyUser(admin, companyA, "inviteread");
    const { data } = await u.client.from("invitations").select("id");
    expect(data).toEqual([]);
  });
});

describe("audit trail", () => {
  it("records privileged operations and is append-only for application roles", async () => {
    const u = await createUser("audited");
    await approve(admin, u, "company_user", companyA);
    const { data: logs } = await admin.client.from("audit_logs").select("action").eq("entity_id", u.id);
    const actions = (logs ?? []).map((l) => l.action);
    expect(actions).toContain("account.created");
    const { error } = await admin.client.from("audit_logs").delete().eq("entity_id", u.id);
    expect(error?.code).toBe("42501");
    await expect(db().query(`delete from public.audit_logs where entity_id = $1`, [u.id])).rejects.toThrow(/append-only/);
  });
});
