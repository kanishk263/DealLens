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
