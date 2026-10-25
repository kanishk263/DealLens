"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/errors";
import { reportConfigSchema } from "@/lib/reporting/config";

const uuid = z.string().uuid();
const internal = () => requireRole("finance_analyst", "finance_reviewer");

function parseConfig(fd: FormData) {
  return reportConfigSchema.safeParse({
    sections: fd.getAll("sections"), executive_summary: String(fd.get("executive_summary") ?? ""), limitations: String(fd.get("limitations") ?? ""),
  });
}

export async function saveReportDraft(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const ids = z.object({ submissionId: uuid, reportId: z.string().uuid().optional().or(z.literal("")), title: z.string().trim().min(3).max(200),
    type: z.enum(["financial_due_diligence", "valuation_summary", "data_quality"]) }).safeParse(Object.fromEntries(fd));
  const config = parseConfig(fd);
  if (!ids.success) return { ok: false, error: ids.error.issues[0]?.message ?? "Invalid input" };
  if (!config.success) return { ok: false, error: config.error.issues[0]?.message ?? "Invalid configuration" };
  const supabase = await createClient();
  const { error } = ids.data.reportId
    ? await supabase.rpc("update_report_draft", { p_report: ids.data.reportId, p_title: ids.data.title, p_config: config.data })
    : await supabase.rpc("create_report_draft", { p_submission: ids.data.submissionId, p_title: ids.data.title, p_type: ids.data.type, p_config: config.data });
  if (error) return fail(error);
  return { ok: true, message: "Draft saved. The PDF is being generated." };
}

async function simple(rpc: string, args: Record<string, unknown>, message: string): Promise<ActionResult> {
  await internal();
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, args);
  if (error) return fail(error);
  return { ok: true, message };
}

export async function regenerateReport(_: unknown, fd: FormData) {
  const id = uuid.safeParse(fd.get("reportId"));
  return id.success ? simple("regenerate_report", { p_report: id.data }, "Regeneration queued.") : { ok: false as const, error: "Invalid report" };
}

export async function submitReport(_: unknown, fd: FormData) {
  const id = uuid.safeParse(fd.get("reportId"));
  return id.success ? simple("submit_report_for_review", { p_report: id.data }, "Submitted for review.") : { ok: false as const, error: "Invalid report" };
}

export async function reviewReport(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("finance_reviewer");
  const p = z.object({ reportId: uuid, decision: z.enum(["approved", "changes_requested"]), notes: z.string().max(3000).optional() }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: "Invalid request" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_report", { p_report: p.data.reportId, p_decision: p.data.decision, p_notes: p.data.notes || null });
  if (error) return fail(error);
  return { ok: true, message: p.data.decision === "approved" ? "Approved. The final PDF is being rendered." : "Changes requested." };
}

export async function publishReport(_: unknown, fd: FormData) {
  const id = uuid.safeParse(fd.get("reportId"));
  return id.success ? simple("publish_report", { p_report: id.data }, "Report published to the company.") : { ok: false as const, error: "Invalid report" };
}

export async function reopenForNewVersion(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("finance_analyst");
  const id = uuid.safeParse(fd.get("submissionId"));
  if (!id.success) return { ok: false, error: "Invalid submission" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_submission", { p_submission: id.data, p_to: "in_analysis", p_reason: "Reopened to prepare a new report version" });
  if (error) return fail(error);
  const r = data as { ok: boolean; error?: string };
  return r.ok ? { ok: true, message: "Reopened. Create a new report version; the published version remains unchanged." } : { ok: false, error: r.error ?? "Not permitted" };
}
