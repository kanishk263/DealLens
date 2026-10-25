"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/errors";
import { ENGINE_VERSION } from "@/lib/valuation/common";
import { valueComparables } from "@/lib/valuation/comparables";
import { valueDcf } from "@/lib/valuation/dcf";
import { saveSchema, type SavePayload } from "@/lib/valuation/schemas";

/**
 * Saves a new immutable model version. Outputs are recomputed here from the validated inputs with the
 * versioned engine; anything the browser calculated for preview is discarded.
 */
export async function saveValuationModel(payload: SavePayload): Promise<ActionResult<{ id: string }>> {
  await requireRole("finance_analyst", "finance_reviewer");
  const parsed = saveSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid model input" };
  const p = parsed.data;
  const outputs = p.method === "dcf" ? valueDcf(p.input) : valueComparables(p.input);
  const errors = "errors" in outputs ? outputs.errors : [];
  if (errors.length) return { ok: false, error: `Model is invalid: ${errors.join(" ")}` };
  const assumptions = p.method === "dcf"
    ? { wacc: p.input.wacc, terminalGrowth: p.input.terminalGrowth, taxRate: p.input.taxRate, years: p.input.years, midYear: p.input.midYear,
        revenueGrowth: p.input.revenueGrowth, ebitdaMargin: p.input.ebitdaMargin, daPctRevenue: p.input.daPctRevenue, capexPctRevenue: p.input.capexPctRevenue, nwcPctRevenue: p.input.nwcPctRevenue }
    : { multiple: p.input.multiple, selection: "25th percentile / median / 75th percentile", baseMultipleOverride: p.input.baseMultipleOverride ?? null,
        overrideJustification: p.input.overrideJustification ?? null, includedComparables: p.input.comparables.filter((c) => c.included).length };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_valuation_model", {
    p_submission: p.submissionId, p_model_name: p.modelName, p_method: p.method, p_assumptions: assumptions, p_inputs: p.input,
    p_outputs: JSON.parse(JSON.stringify(outputs)), p_currency: p.input.currency, p_engine_version: ENGINE_VERSION, p_comments: p.comments ?? null,
  });
  if (error) return fail(error);
  return { ok: true, data: { id: data as string }, message: "Model version saved." };
}

export async function reviewValuationModel(_: unknown, fd: FormData): Promise<ActionResult> {
  await requireRole("finance_analyst", "finance_reviewer");
  const parsed = z.object({ modelId: z.string().uuid(), status: z.enum(["pending_review", "approved", "rejected"]), notes: z.string().max(2000).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_valuation_model", { p_model: parsed.data.modelId, p_status: parsed.data.status, p_notes: parsed.data.notes || null });
  if (error) return fail(error);
  return { ok: true, message: parsed.data.status === "pending_review" ? "Submitted for review." : `Model ${parsed.data.status}.` };
}
