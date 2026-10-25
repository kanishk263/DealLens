import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClarificationRow } from "@/components/financial/clarification-list";

export async function loadClarifications(supabase: SupabaseClient, submissionId: string): Promise<ClarificationRow[]> {
  const { data } = await supabase.from("clarification_requests")
    .select("id, question, requested_documents, status, response_text, responded_at, created_at, resolved_at, requester:profiles!clarification_requests_requested_by_fkey(full_name), responder:profiles!clarification_requests_responded_by_fkey(full_name), clarification_attachments(documents(id, original_filename, processing_status))")
    .eq("submission_id", submissionId).order("created_at", { ascending: false });
  return (data ?? []).map((c) => ({
    ...(c as unknown as ClarificationRow),
    attachments: ((c.clarification_attachments ?? []) as unknown as { documents: { id: string; original_filename: string; processing_status: string } | null }[])
      .map((a) => a.documents).filter((d): d is NonNullable<typeof d> => d !== null),
  }));
}
