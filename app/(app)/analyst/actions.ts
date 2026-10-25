"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/errors";
import { CATEGORY_LABELS } from "@/lib/financial/taxonomy";

const uuid = z.string().uuid();
const internal = () => requireRole("finance_analyst", "finance_reviewer");
const first = (e: z.ZodError) => ({ ok: false as const, error: e.issues[0]?.message ?? "Invalid input" });

export async function claimSubmission(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("finance_analyst");
  const id = uuid.safeParse(fd.get("submissionId"));
  if (!id.success) return { ok: false, error: "Invalid submission" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_submission", { p_submission: id.data });
  if (error) return fail(error);
  return { ok: true, message: "Submission claimed. It is now in analysis." };
}

export async function updateLineItem(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({
    lineItemId: uuid,
    category: z.string().optional(),
    mappingStatus: z.enum(["analyst_mapped", "analyst_confirmed", "excluded", "unmapped"]),
    normalizedValue: z.string().trim().optional(),
    reason: z.string().trim().min(3, "A reason is required for every correction").max(1000),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const d = parsed.data;
  if (d.category && !(d.category in CATEGORY_LABELS)) return { ok: false, error: "Unknown category" };
  let value: number | null = null;
  if (d.normalizedValue) {
    value = Number(d.normalizedValue.replace(/,/g, ""));
    if (!Number.isFinite(value)) return { ok: false, error: "Normalised value must be a number" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_line_item", {
    p_line_item: d.lineItemId, p_category: d.category || null, p_mapping_status: d.mappingStatus, p_normalized_value: value, p_reason: d.reason,
  });
  if (error) return fail(error);
  return { ok: true, message: "Line item updated. Recalculate to refresh metrics." };
}

export async function confirmMappings(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const ids = z.array(uuid).min(1).max(500).safeParse(fd.getAll("lineItemId"));
  if (!ids.success) return { ok: false, error: "Select at least one line item" };
  const supabase = await createClient();
  const { data: items } = await supabase.from("financial_line_items").select("id, normalized_category, normalized_value").in("id", ids.data);
  let n = 0;
  for (const it of items ?? []) {
    if (!it.normalized_category) continue;
    const { error } = await supabase.rpc("update_line_item", {
      p_line_item: it.id, p_category: it.normalized_category, p_mapping_status: "analyst_confirmed", p_normalized_value: it.normalized_value,
      p_reason: "Proposed mapping confirmed by analyst",
    });
    if (error) return fail(error);
    n++;
  }
  return { ok: true, message: `${n} mapping(s) confirmed.` };
}

export async function requestReanalysis(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const id = uuid.safeParse(fd.get("submissionId"));
  if (!id.success) return { ok: false, error: "Invalid submission" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_reanalysis", { p_submission: id.data });
  if (error) return fail(error);
  return { ok: true, message: "Recalculation queued. Results appear when the worker completes." };
}

export async function reviewQualityIssue(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ issueId: uuid, status: z.enum(["open", "acknowledged", "resolved", "dismissed"]), notes: z.string().trim().max(2000).optional() })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_data_quality_issue", { p_issue: parsed.data.issueId, p_status: parsed.data.status, p_notes: parsed.data.notes || null });
  if (error) return fail(error);
  return { ok: true, message: "Issue updated." };
}

export async function transitionSubmission(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ submissionId: uuid, to: z.enum(["in_analysis", "uploaded"]), reason: z.string().max(500).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("transition_submission", { p_submission: parsed.data.submissionId, p_to: parsed.data.to, p_reason: parsed.data.reason || null });
  if (error) return fail(error);
  const r = data as { ok: boolean; error?: string };
  return r.ok ? { ok: true, message: "Status updated." } : { ok: false, error: r.error ?? "Not permitted" };
}

export async function proposeAdjustment(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({
    submissionId: uuid, periodId: uuid,
    type: z.enum(["restructuring", "transaction_costs", "legal_non_recurring", "owner_related", "other_non_recurring"]),
    description: z.string().trim().min(3).max(500),
    amount: z.coerce.number().positive("Amount must be positive; choose the direction separately"),
    sign: z.enum(["1", "-1"]),
    evidence: z.string().trim().min(3, "Reference the supporting evidence").max(1000),
    rationale: z.string().trim().min(10, "Explain why the item is non-recurring (10+ characters)").max(2000),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("propose_ebitda_adjustment", {
    p_submission: d.submissionId, p_period: d.periodId, p_type: d.type, p_description: d.description, p_amount: d.amount,
    p_sign: Number(d.sign), p_evidence: d.evidence, p_rationale: d.rationale,
  });
  if (error) return fail(error);
  return { ok: true, message: "Adjustment proposed. It is excluded from Adjusted EBITDA until approved." };
}

export async function reviewAdjustment(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ adjustmentId: uuid, decision: z.enum(["approved", "rejected", "proposed"]), notes: z.string().trim().min(3, "Review notes are required").max(2000) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_ebitda_adjustment", { p_adjustment: parsed.data.adjustmentId, p_decision: parsed.data.decision, p_notes: parsed.data.notes });
  if (error) return fail(error);
  return { ok: true, message: `Adjustment ${parsed.data.decision}.` };
}

export async function reviewRedFlag(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ flagId: uuid, status: z.enum(["open", "dismissed", "resolved", "escalated"]), notes: z.string().trim().min(3, "Record an explanation").max(2000) })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_red_flag", { p_flag: parsed.data.flagId, p_status: parsed.data.status, p_notes: parsed.data.notes });
  if (error) return fail(error);
  return { ok: true, message: `Red flag marked ${parsed.data.status}.` };
}

const findingSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  submissionId: uuid,
  category: z.enum(["revenue", "profitability", "ebitda", "working_capital", "debt", "cash_flow", "data_quality", "valuation", "other"]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  severity: z.enum(["critical", "high", "medium", "low", "informational"]),
  impact: z.string().trim().optional(),
  recommendation: z.string().trim().max(2000).optional(),
  visibility: z.enum(["internal", "client_visible"]),
  references: z.string().trim().max(2000).optional(),
});

export async function saveFinding(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = findingSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const d = parsed.data;
  let impact: number | null = null;
  if (d.impact) {
    impact = Number(d.impact.replace(/,/g, ""));
    if (!Number.isFinite(impact)) return { ok: false, error: "Quantified impact must be a number" };
  }
  const supabase = await createClient();
  const { data: sub } = await supabase.from("submissions").select("reporting_currency").eq("id", d.submissionId).maybeSingle();
  if (!sub) return { ok: false, error: "Submission not found" };
  const refs = (d.references ?? "").split(/\n|;/).map((r) => r.trim()).filter(Boolean).slice(0, 30).map((reference) => ({ reference }));
  const { error } = await supabase.rpc("save_finding", {
    p_id: d.id || null, p_submission: d.submissionId, p_category: d.category, p_title: d.title, p_description: d.description, p_severity: d.severity,
    p_impact: impact, p_impact_currency: impact === null ? null : sub.reporting_currency, p_source_references: refs, p_recommendation: d.recommendation || null, p_visibility: d.visibility,
  });
  if (error) return fail(error);
  return { ok: true, message: d.id ? "Finding updated." : "Finding created." };
}

export async function setFindingStatus(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ findingId: uuid, status: z.enum(["draft", "in_review", "approved", "closed"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_finding_status", { p_finding: parsed.data.findingId, p_status: parsed.data.status });
  if (error) return fail(error);
  return { ok: true, message: `Finding marked ${parsed.data.status.replace("_", " ")}.` };
}

export async function addFindingComment(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ findingId: uuid, text: z.string().trim().min(1).max(5000), visibility: z.enum(["internal", "client_visible"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_finding_comment", { p_finding: parsed.data.findingId, p_text: parsed.data.text, p_visibility: parsed.data.visibility });
  if (error) return fail(error);
  return { ok: true, message: "Comment added." };
}

export async function createClarification(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ submissionId: uuid, question: z.string().trim().min(5, "Write the question (5+ characters)").max(5000), requestedDocuments: z.string().trim().max(1000).optional() })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_clarification", { p_submission: parsed.data.submissionId, p_question: parsed.data.question, p_requested_documents: parsed.data.requestedDocuments || null });
  if (error) return fail(error);
  return { ok: true, message: "Clarification sent to the company." };
}

export async function resolveClarification(_: unknown, fd: FormData): Promise<ActionResult> {
  await internal();
  const parsed = z.object({ clarificationId: uuid, status: z.enum(["resolved", "cancelled"]) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return first(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_clarification", { p_clarification: parsed.data.clarificationId, p_status: parsed.data.status });
  if (error) return fail(error);
  return { ok: true, message: `Clarification ${parsed.data.status}.` };
}
