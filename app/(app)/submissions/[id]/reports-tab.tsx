import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utilities/format";

export async function CompanyReportsTab({ submissionId }: { submissionId: string }) {
  const supabase = await createClient();
  // RLS only returns published (and superseded) reports to company users.
  const { data } = await supabase.from("reports").select("id, report_title, report_version, status, published_at").eq("submission_id", submissionId).order("report_version", { ascending: false });
  if (!data?.length) return <EmptyState title="No published reports" description="Reports appear here after the finance team publishes an approved version." />;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <div><p className="font-medium">{r.report_title} <span className="text-muted">v{r.report_version}</span></p><p className="text-xs text-muted">Published {formatDateTime(r.published_at)}</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={r.status} label={r.status === "superseded" ? "Superseded by a newer version" : undefined} />
              <Button asChild size="sm" variant="secondary"><a href={`/api/reports/${r.id}/download`}>Download PDF</a></Button></div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
