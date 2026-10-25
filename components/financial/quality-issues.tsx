import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

export interface IssueRow {
  id: string; severity: string; title: string; description: string; suggested_resolution: string; status: string;
  resolution_notes: string | null; source_references: { reference?: string; label?: string }[]; issue_type: string;
}

const ORDER = ["critical", "high", "medium", "low", "informational"];

export function QualityIssueList({ issues, renderActions }: { issues: IssueRow[]; renderActions?: (i: IssueRow) => React.ReactNode }) {
  if (issues.length === 0) return <EmptyState title="No data-quality issues" description="No issues were detected in the latest analysis." />;
  const sorted = [...issues].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  return (
    <div className="space-y-3">
      {sorted.map((i) => (
        <Card key={i.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={i.severity} /><p className="text-sm font-medium">{i.title}</p></div>
              <p className="mt-1 text-sm text-muted">{i.description}</p>
              <p className="mt-1 text-xs"><span className="font-medium">Suggested resolution:</span> {i.suggested_resolution}</p>
              {i.source_references?.length ? (
                <p className="mt-1 text-xs text-faint">Sources: {i.source_references.slice(0, 6).map((r) => r.reference).filter(Boolean).join("; ")}{i.source_references.length > 6 ? "…" : ""}</p>
              ) : null}
              {i.resolution_notes ? <p className="mt-1 text-xs text-muted">Resolution: {i.resolution_notes}</p> : null}
            </div>
            <div className="flex flex-col items-end gap-2"><StatusBadge status={i.status} />{renderActions?.(i)}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}
