import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/utilities/format";

export interface ClarificationRow {
  id: string; question: string; requested_documents: string | null; status: string; response_text: string | null;
  responded_at: string | null; created_at: string; resolved_at: string | null;
  requester: { full_name: string | null } | null; responder: { full_name: string | null } | null;
  attachments: { id: string; original_filename: string; processing_status: string }[];
}

export function ClarificationList({ items, renderActions }: { items: ClarificationRow[]; renderActions: (c: ClarificationRow) => React.ReactNode }) {
  if (items.length === 0) return <EmptyState title="No clarification requests" />;
  return (
    <div className="space-y-3">
      {items.map((c) => (
        <Card key={c.id}>
          <CardBody className="space-y-2 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-xs text-muted">Asked by {c.requester?.full_name ?? "finance team"} · {formatDateTime(c.created_at)}</p>
              <StatusBadge status={c.status} />
            </div>
            <p className="whitespace-pre-wrap font-medium">{c.question}</p>
            {c.requested_documents ? <p className="text-xs"><span className="font-medium">Documents requested:</span> {c.requested_documents}</p> : null}
            {c.response_text ? (
              <div className="rounded-md border border-border bg-subtle px-3 py-2">
                <p className="text-xs text-muted">Response from {c.responder?.full_name ?? "company"} · {formatDateTime(c.responded_at)}</p>
                <p className="mt-1 whitespace-pre-wrap">{c.response_text}</p>
              </div>
            ) : null}
            {c.attachments.length ? (
              <ul className="text-xs">{c.attachments.map((a) => <li key={a.id}><a className="text-accent hover:underline" href={`/api/documents/${a.id}/download`}>{a.original_filename}</a> <span className="text-muted">({a.processing_status})</span></li>)}</ul>
            ) : null}
            {renderActions(c)}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
