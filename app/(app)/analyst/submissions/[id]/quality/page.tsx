import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { QualityIssueList, type IssueRow } from "@/components/financial/quality-issues";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { formatAmount } from "@/lib/utilities/format";
import { IssueActions } from "./issue-actions";

export default async function QualityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status = "open" } = await searchParams;
  const { supabase, sub, canWork } = await loadAnalystSubmission(id);
  let q = supabase.from("data_quality_issues").select("id, severity, title, description, suggested_resolution, status, resolution_notes, source_references, issue_type, client_visible").eq("submission_id", id);
  if (status !== "all") q = status === "open" ? q.in("status", ["open", "acknowledged"]) : q.eq("status", status);
  const [{ data: issues }, { data: recs }] = await Promise.all([
    q,
    supabase.from("reconciliations").select("id, check_key, status, lhs, rhs, variance, tolerance, details, financial_periods(period_label, sort_order)")
      .eq("submission_id", id).eq("analysis_version", sub.current_analysis_version),
  ]);
  const base = `/analyst/submissions/${id}/quality`;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Reconciliations" description="Checks marked 'not tested' had incomplete inputs; they are never reported as reconciled." />
        <Table>
          <THead><tr><TH>Check</TH><TH>Period</TH><TH>Status</TH><TH className="text-right">Left side</TH><TH className="text-right">Right side</TH><TH className="text-right">Variance</TH><TH>Notes</TH></tr></THead>
          <TBody>
            {(recs ?? []).sort((a, b) => ((a.financial_periods as unknown as { sort_order: number })?.sort_order ?? 0) - ((b.financial_periods as unknown as { sort_order: number })?.sort_order ?? 0)).map((r) => (
              <TR key={r.id}>
                <TD>{r.check_key === "balance_sheet" ? "Assets = Liabilities + Equity" : "Opening cash + change = closing cash"}</TD>
                <TD>{(r.financial_periods as unknown as { period_label: string } | null)?.period_label}</TD>
                <TD><StatusBadge status={r.status} /></TD>
                <TD className="tabular text-right">{formatAmount(r.lhs)}</TD>
                <TD className="tabular text-right">{formatAmount(r.rhs)}</TD>
                <TD className="tabular text-right">{r.variance === null ? "—" : formatAmount(r.variance)}</TD>
                <TD className="text-xs text-muted">{(r.details as { reason?: string; beginning_basis?: string; rhs_basis?: string }).reason ?? (r.details as { rhs_basis?: string; beginning_basis?: string }).rhs_basis ?? (r.details as { beginning_basis?: string }).beginning_basis}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <div>
        <LinkTabs active={status} tabs={["open", "resolved", "dismissed", "all"].map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1), href: `${base}?status=${s}` }))} />
        <QualityIssueList issues={(issues ?? []) as IssueRow[]} renderActions={(i) => (
          <div className="flex flex-col items-end gap-1">
            {(i as IssueRow & { client_visible: boolean }).client_visible ? <Badge tone="info">Client visible</Badge> : <Badge>Internal</Badge>}
            {canWork ? <IssueActions issueId={i.id} status={i.status} /> : null}
          </div>
        )} />
      </div>
      <Card><CardHeader title="About these checks" /><CardBody className="text-sm text-muted">
        Issues are generated deterministically on every analysis run. An issue that is no longer detected is resolved automatically; issues resolved or dismissed by an analyst keep that decision and its notes.
      </CardBody></Card>
    </div>
  );
}
