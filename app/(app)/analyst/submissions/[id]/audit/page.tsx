import { Card, CardHeader } from "@/components/ui/card";
import { AuditTable, type AuditRow } from "@/components/tables/audit-table";
import { loadAnalystSubmission } from "@/lib/database/submission-context";

export default async function SubmissionAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await loadAnalystSubmission(id);
  const { data } = await supabase.from("audit_logs").select("id, action, entity_type, entity_id, occurred_at, metadata, profiles(full_name, email)")
    .eq("submission_id", id).order("occurred_at", { ascending: false }).limit(300);
  return <Card><CardHeader title="Audit trail" description="Material actions on this submission (latest 300). Append-only." /><AuditTable rows={(data ?? []) as unknown as AuditRow[]} /></Card>;
}
