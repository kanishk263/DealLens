import { Download } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { ActionButton } from "@/components/forms/action-form";
import type { ActionResult } from "@/lib/errors";
import { formatDateTime, humanize } from "@/lib/utilities/format";

export interface DocumentRow {
  id: string; original_filename: string; file_type: string; file_size_bytes: number; document_category: string; document_version: number;
  processing_status: string; uploaded_at: string; extraction_metadata: Record<string, unknown>;
}

export function DocumentList({ documents, canRemove, removeAction, canDownload = true }: {
  documents: DocumentRow[]; canRemove?: boolean; canDownload?: boolean;
  removeAction?: (p: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
}) {
  if (documents.length === 0) return <div className="p-4"><EmptyState title="No documents uploaded" /></div>;
  return (
    <Table>
      <THead><tr><TH>Document</TH><TH>Category</TH><TH>Version</TH><TH>Status</TH><TH>Extraction</TH><TH>Uploaded</TH><TH /></tr></THead>
      <TBody>
        {documents.map((d) => {
          const m = d.extraction_metadata ?? {};
          const summary = m.mapping_summary as Record<string, number> | undefined;
          return (
            <TR key={d.id}>
              <TD>
                <p className="font-medium">{d.original_filename}</p>
                <p className="text-xs text-muted">{d.file_type.toUpperCase()} · {(d.file_size_bytes / 1024).toFixed(0)} KB</p>
              </TD>
              <TD className="text-muted">{humanize(d.document_category)}</TD>
              <TD className="tabular">v{d.document_version}</TD>
              <TD><StatusBadge status={d.processing_status} /></TD>
              <TD className="max-w-xs text-xs text-muted">
                {typeof m.error_message === "string" ? <span className="text-danger">{m.error_message}</span> : summary ? (
                  <>{Number(m.line_items_extracted ?? 0)} values · {summary.auto_mapped ?? 0} mapped · {summary.needs_review ?? 0} to review · {summary.unmapped ?? 0} unmapped
                    {Array.isArray(m.periods) ? <><br />Periods: {(m.periods as string[]).join(", ")}</> : null}</>
                ) : "—"}
                {m.possible_duplicate_of ? <p className="text-warning">Possible duplicate of an earlier upload</p> : null}
              </TD>
              <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(d.uploaded_at)}</TD>
              <TD className="whitespace-nowrap">
                <div className="flex items-center gap-2">
                  {canDownload ? <a href={`/api/documents/${d.id}/download`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><Download className="h-3.5 w-3.5" />Download</a> : null}
                  {canRemove && removeAction ? <ActionButton action={removeAction} fields={{ documentId: d.id }} label="Remove" variant="ghost" confirm="Remove this document from the draft?" /> : null}
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
