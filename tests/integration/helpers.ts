import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

/**
 * Test fixtures for a LOCAL Supabase stack. Users are created through the Auth admin API with random,
 * never-stored passwords (password sign-in exists only so tests can obtain real JWTs; the product UI
 * offers Google only). Roles and memberships are granted through the same database functions the UI
 * uses, so the fixtures exercise the real authorization paths instead of bypassing them.
 */
const URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const RUN = randomBytes(3).toString("hex");
export const TEST_DOMAIN = "deallens.test";

export function adminClient() {
  return createClient(URL(), SERVICE(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface TestUser { id: string; email: string; client: SupabaseClient; password: string }

export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${RUN}-${randomUUID().slice(0, 6)}@${TEST_DOMAIN}`;
  const password = randomBytes(18).toString("base64url");
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Test ${label}` } });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(URL(), ANON(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client, password };
}

export async function makeSuperadmin(): Promise<TestUser> {
  const u = await createUser("admin");
  const { error } = await adminClient().rpc("bootstrap_superadmin", { p_user: u.id, p_expected_email: u.email });
  if (error) throw error;
  return u;
}

export async function createCompany(admin: TestUser, name: string): Promise<string> {
  const { data, error } = await admin.client.rpc("upsert_company", {
    p_id: null, p_legal_name: `${name} ${RUN} ${randomUUID().slice(0, 4)}`, p_display_name: name, p_industry: "Test", p_country: "GB",
    p_currency: "USD", p_unit: "thousands", p_description: "Integration test company",
  });
  if (error) throw error;
  return data as string;
}

export async function approve(admin: TestUser, user: TestUser, role: "company_user" | "finance_analyst", companyId?: string) {
  const { data: reqId, error } = await user.client.rpc("submit_access_request", {
    p_company_name: "Test organisation", p_justification: "Integration test access request", p_requested_role: role,
  });
  if (error) throw error;
  const { error: reviewError } = await admin.client.rpc("review_access_request", {
    p_request: reqId, p_decision: "approved", p_notes: "ok", p_company_id: companyId ?? null,
  });
  if (reviewError) throw reviewError;
}

export async function companyUser(admin: TestUser, companyId: string, label = "company") {
  const u = await createUser(label);
  await approve(admin, u, "company_user", companyId);
  return u;
}

export async function analyst(admin: TestUser, label = "analyst") {
  const u = await createUser(label);
  await approve(admin, u, "finance_analyst");
  return u;
}

export async function reviewer(admin: TestUser) {
  const u = await analyst(admin, "reviewer");
  const { error } = await admin.client.rpc("grant_role", { p_user: u.id, p_role: "finance_reviewer" });
  if (error) throw error;
  return u;
}

let pool: pg.Pool | null = null;
export function db() {
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return pool;
}

/** Removes everything created by this test run (local database only). */
export async function cleanup() {
  const p = db();
  const like = [`%${RUN}%`];
  const companyFilter = `select id from public.companies where legal_name like $1`;
  const { rows: docs } = await p.query(
    `select d.storage_path from public.documents d join public.submissions s on s.id = d.submission_id where s.company_id in (${companyFilter})`, like);
  const { rows: reps } = await p.query(
    `select r.storage_path from public.reports r join public.submissions s on s.id = r.submission_id where r.storage_path is not null and s.company_id in (${companyFilter})`, like);
  const admin = adminClient();
  if (docs.length) await admin.storage.from("documents").remove(docs.map((d) => d.storage_path));
  if (reps.length) await admin.storage.from("reports").remove(reps.map((r) => r.storage_path));
  await p.query(`alter table public.reports disable trigger reports_immutable`);
  await p.query(`delete from public.reports where submission_id in (select id from public.submissions where company_id in (${companyFilter}))`, like);
  await p.query(`alter table public.reports enable trigger reports_immutable`);
  await p.query(`delete from public.submissions where company_id in (${companyFilter})`, like);
  await p.query(`delete from public.companies where legal_name like $1`, like);
  await p.query(`delete from auth.users where email like $1`, [`%-${RUN}-%@${TEST_DOMAIN}`]);
  await pool?.end();
  pool = null;
}

export function expectCode(error: { code?: string } | null, code: string) {
  if (!error) throw new Error(`Expected error ${code} but the call succeeded`);
  if (error.code !== code) throw new Error(`Expected error ${code}, got ${error.code}: ${JSON.stringify(error)}`);
}

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Runs the real Python worker until the queue is empty. */
export function drainWorker() {
  const root = path.resolve(__dirname, "../..");
  execFileSync(path.join(root, "processing/.venv/bin/python"), ["-m", "deallens_worker", "drain"], {
    cwd: path.join(root, "processing"),
    env: { ...process.env, SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!, DATABASE_URL: process.env.DATABASE_URL!, WORKER_POLL_SECONDS: "0.2" },
    stdio: process.env.DEBUG_WORKER ? "inherit" : "pipe",
    timeout: 180_000,
  });
}

export function sampleFile(name: string, type: string): File {
  const bytes = readFileSync(path.resolve(__dirname, "../../samples", name));
  return new File([bytes], name, { type });
}

export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function newSubmission(u: TestUser, company: string, name = "FY22-FY24") {
  const { data, error } = await u.client.rpc("create_submission", {
    p_company: company, p_name: name, p_deal_type: "financial_due_diligence", p_period_start: "2022-01-01", p_period_end: "2024-12-31",
    p_currency: "USD", p_unit: "thousands",
  });
  if (error) throw error;
  return data as string;
}
