import { EmptyState } from "@/components/ui/states";

// Replaced in Phase 9 with published report downloads.
export async function CompanyReportsTab(_: { submissionId: string }) {
  return <EmptyState title="No published reports" />;
}
