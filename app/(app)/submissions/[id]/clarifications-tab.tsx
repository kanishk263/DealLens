import { EmptyState } from "@/components/ui/states";

// Replaced in Phase 8 with clarification responses.
export async function CompanyClarificationsTab(_: { submissionId: string; status: string; maxMb: number }) {
  return <EmptyState title="No clarification requests" />;
}
