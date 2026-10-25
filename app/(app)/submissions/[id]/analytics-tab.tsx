import { EmptyState } from "@/components/ui/states";

// Replaced in Phase 6 with the preliminary analytics view.
export async function CompanyAnalyticsTab(_: { submissionId: string; currency: string; unit: string; version: number }) {
  return <EmptyState title="Preliminary analytics are not available yet" />;
}
