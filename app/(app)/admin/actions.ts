"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { fail, type ActionResult } from "@/lib/errors";

// Every action re-checks the role server-side; the database functions check again.
const uuid = z.string().uuid();

function first(error: z.ZodError) {
  return { ok: false as const, error: error.issues[0]?.message ?? "Invalid input" };
}

export async function reviewAccessRequest(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const parsed = z.object({
    requestId: uuid, decision: z.enum(["approved", "rejected"]), notes: z.string().max(2000).optional(),
    companyId: z.string().uuid().optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_access_request", {
    p_request: parsed.data.requestId, p_decision: parsed.data.decision, p_notes: parsed.data.notes || null,
    p_company_id: parsed.data.companyId || null,
  });
  if (error) return fail(error);
  return { ok: true, message: `Request ${parsed.data.decision}.` };
}

export async function setAccountStatus(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const parsed = z.object({
    userId: uuid, status: z.enum(["active", "suspended", "rejected", "pending_approval"]),
    reason: z.string().trim().min(3, "Give a reason (3+ characters)").max(500),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_status", { p_user: parsed.data.userId, p_status: parsed.data.status, p_reason: parsed.data.reason });
  if (error) return fail(error);
  return { ok: true, message: "Account status updated." };
}

export async function changeRole(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const parsed = z.object({
    userId: uuid, role: z.enum(["superadmin", "company_user", "finance_analyst", "finance_reviewer"]), op: z.enum(["grant", "revoke"]),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc(parsed.data.op === "grant" ? "grant_role" : "revoke_role", { p_user: parsed.data.userId, p_role: parsed.data.role });
  if (error) return fail(error);
  return { ok: true, message: parsed.data.op === "grant" ? "Role granted." : "Role revoked." };
}

const companySchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Currency must be a 3-letter ISO code"),
  unit: z.enum(["units", "thousands", "millions"]),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
});

export async function saveCompany(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const parsed = companySchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_company", {
    p_id: d.id || null, p_legal_name: d.legalName, p_display_name: d.displayName, p_industry: d.industry || null,
    p_country: d.country || null, p_currency: d.currency, p_unit: d.unit, p_description: d.description || null, p_status: d.status,
  });
  if (error) return fail(error);
  return { ok: true, message: d.id ? "Company updated." : "Company created." };
}

export async function createInvitation(_: unknown, fd: FormData): Promise<ActionResult<{ link: string }>> {
  await requireRole("superadmin");
  const parsed = z.object({ companyId: uuid, email: z.string().trim().email() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invitation", { p_company: parsed.data.companyId, p_email: parsed.data.email });
  if (error) return fail(error);
  // The raw token is returned once and never stored; only its SHA-256 hash is persisted.
  return { ok: true, message: "Invitation created. Copy the link now; it will not be shown again.", data: { link: `${serverEnv().APP_BASE_URL}/invite/${data}` } };
}

export async function revokeInvitation(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const id = uuid.safeParse(fd.get("invitationId"));
  if (!id.success) return { ok: false, error: "Invalid invitation" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation: id.data });
  if (error) return fail(error);
  return { ok: true, message: "Invitation revoked." };
}

export async function setMembershipStatus(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const parsed = z.object({ membershipId: uuid, status: z.enum(["active", "suspended", "revoked"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_membership_status", { p_membership: parsed.data.membershipId, p_status: parsed.data.status });
  if (error) return fail(error);
  return { ok: true, message: "Membership updated." };
}

export async function assignSubmission(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin", "finance_reviewer");
  const parsed = z.object({ submissionId: uuid, analystId: uuid }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_submission", { p_submission: parsed.data.submissionId, p_analyst: parsed.data.analystId });
  if (error) return fail(error);
  return { ok: true, message: "Submission assigned." };
}

export async function retryProcessing(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin", "company_user", "finance_analyst");
  const id = uuid.safeParse(fd.get("submissionId"));
  if (!id.success) return { ok: false, error: "Invalid submission" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_processing", { p_submission: id.data });
  if (error) return fail(error);
  return { ok: true, message: "Processing re-queued." };
}

export async function archiveSubmission(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const id = uuid.safeParse(fd.get("submissionId"));
  if (!id.success) return { ok: false, error: "Invalid submission" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_submission", { p_submission: id.data, p_to: "archived", p_reason: "Archived by superadmin" });
  if (error) return fail(error);
  const result = data as { ok: boolean; error?: string };
  return result.ok ? { ok: true, message: "Submission archived." } : { ok: false, error: result.error ?? "Not permitted" };
}

export async function updateSetting(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("superadmin");
  const parsed = z.object({ key: z.string().regex(/^[a-z_]+$/), value: z.string().max(200), type: z.enum(["number", "boolean"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  let value: number | boolean;
  if (parsed.data.type === "number") {
    value = Number(parsed.data.value);
    if (!Number.isFinite(value)) return { ok: false, error: "Enter a number" };
  } else value = parsed.data.value === "true";
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_platform_setting", { p_key: parsed.data.key, p_value: value });
  if (error) return fail(error);
  return { ok: true, message: "Setting updated." };
}
