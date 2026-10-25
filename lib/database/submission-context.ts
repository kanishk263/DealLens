import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

/** Loads a submission for the finance workspace; RLS returns nothing when it is outside the analyst's scope. */
export const loadAnalystSubmission = cache(async (id: string) => {
  const ctx = await requireRole("finance_analyst", "finance_reviewer");
  const supabase = await createClient();
  const { data: sub } = await supabase.from("submissions")
    .select("*, companies(display_name, industry, is_synthetic), analyst:profiles!submissions_assigned_analyst_id_fkey(full_name, email)")
    .eq("id", id).maybeSingle();
  if (!sub) notFound();
  const isReviewer = ctx.roles.includes("finance_reviewer");
  const isAssigned = sub.assigned_analyst_id === ctx.userId;
  return { ctx, supabase, sub, canWork: (isAssigned || isReviewer) && !["draft", "archived"].includes(sub.submission_status), isReviewer, isAssigned };
});
