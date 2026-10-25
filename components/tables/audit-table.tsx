import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/utilities/format";

export interface AuditRow {
  id: number; action: string; entity_type: string; entity_id: string | null; occurred_at: string; metadata: Record<string, unknown>;
  profiles: { full_name: string | null; email: string } | null;
}

/** Audit history. Metadata never contains secrets or document contents (enforced at write time). */
export function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) return <div className="p-4"><EmptyState title="No audit events" /></div>;
  return (
    <Table>
      <THead><tr><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Entity</TH><TH>Details</TH></tr></THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.occurred_at)}</TD>
            <TD className="text-sm">{r.profiles?.full_name ?? r.profiles?.email ?? "System"}</TD>
            <TD className="font-mono text-xs">{r.action}</TD>
            <TD className="text-xs text-muted">{r.entity_type}{r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}</TD>
            <TD className="max-w-sm text-xs text-muted">
              {Object.entries(r.metadata ?? {}).slice(0, 6).map(([k, v]) => (
                <span key={k} className="mr-2 inline-block">{k}: <span className="font-mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span></span>
              ))}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
