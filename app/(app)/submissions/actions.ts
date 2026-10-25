"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/errors";

const createSchema = z.object({
  companyId: z.string().uuid("Select a company"),
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(200),
  dealType: z.enum(["acquisition", "divestiture", "financial_due_diligence", "valuation", "strategic_review", "other"]),
  dealProjectId: z.string().uuid().optional().or(z.literal("")),
  periodStart: z.string().date("Enter a valid start date"),
  periodEnd: z.string().date("Enter a valid end date"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code"),
  unit: z.enum(["units", "thousands", "millions"]),
  notes: z.string().trim().max(5000).optional(),
}).refine((d) => d.periodEnd > d.periodStart, { message: "Period end must be after period start", path: ["periodEnd"] });

export type CreateSubmissionInput = z.input<typeof createSchema>;

export async function createSubmission(input: CreateSubmissionInput): Promise<ActionResult<{ id: string }>> {
  await requireRole("company_user");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_submission", {
    p_company: d.companyId, p_name: d.name, p_deal_type: d.dealType, p_period_start: d.periodStart, p_period_end: d.periodEnd,
    p_currency: d.currency.toUpperCase(), p_unit: d.unit, p_notes: d.notes || null, p_deal_project: d.dealProjectId || null,
  });
  if (error) return fail(error);
  return { ok: true, data: { id: data as string } };
}

export async function submitSubmission(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("company_user");
  const id = z.string().uuid().safeParse(fd.get("submissionId"));
  if (!id.success) return { ok: false, error: "Invalid submission" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_submission", { p_submission: id.data });
  if (error) return fail(error);
  return { ok: true, message: "Submitted. Processing has been queued." };
}

export async function removeDocument(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("company_user");
  const id = z.string().uuid().safeParse(fd.get("documentId"));
  if (!id.success) return { ok: false, error: "Invalid document" };
  const supabase = await createClient();
  // Soft delete: the metadata row is retained for audit; the object is purged by the retention sweep.
  const { error } = await supabase.rpc("remove_document", { p_document: id.data });
  if (error) return fail(error);
  return { ok: true, message: "Document removed." };
}
