import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listAnalysts } from "@/lib/database/analysts";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { ActionButton } from "@/components/forms/action-form";
import { AssignForm } from "@/components/forms/assign-form";
import { formatDate } from "@/lib/utilities/format";
import { claimSubmission } from "../actions";
import { assignSubmission } from "../../admin/actions";

export const metadata = { title: "Work queue" };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ view?: string; sort?: string }> }) {
  const ctx = await requireRole("finance_analyst", "finance_reviewer");
  const { view = "unassigned", sort = "priority" } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("submissions")
    .select("id, submission_name, submission_status, submitted_at, reporting_period_end, assigned_analyst_id, is_synthetic, companies(display_name), analyst:profiles!submissions_assigned_analyst_id_fkey(full_name, email), data_quality_issues(severity, status)")
    .neq("submission_status", "archived").limit(200);
  if (view === "unassigned") query = query.is("assigned_analyst_id", null).in("submission_status", ["awaiting_review", "processing_failed"]);
  if (view === "mine") query = query.eq("assigned_analyst_id", ctx.userId);
  const [{ data, error }, analysts] = await Promise.all([query, ctx.roles.includes("finance_reviewer") ? listAnalysts(supabase) : Promise.resolve([])]);

  // Prioritisation: open critical/high issues first, then oldest submission.
  const rows = (data ?? []).map((s) => {
    const issues = ((s.data_quality_issues ?? []) as { severity: string; status: string }[]).filter((i) => i.status === "open");
    return { ...s, critical: issues.filter((i) => i.severity === "critical").length, high: issues.filter((i) => i.severity === "high").length };
  }).sort((a, b) => sort === "period" ? String(b.reporting_period_end).localeCompare(String(a.reporting_period_end))
    : (b.critical - a.critical) || (b.high - a.high) || String(a.submitted_at).localeCompare(String(b.submitted_at)));

  const tabs = [{ key: "unassigned", label: "Unassigned queue" }, { key: "mine", label: "Assigned to me" }, ...(ctx.roles.includes("finance_reviewer") ? [{ key: "all", label: "All submissions" }] : [])]
    .map((t) => ({ ...t, href: `/analyst/queue?view=${t.key}&sort=${sort}` }));
  return (
    <>
      <PageHeader title="Work queue" description="Claiming is transactional: if two analysts claim at once, only one succeeds."
        actions={<div className="flex gap-2 text-sm"><span className="text-muted">Sort:</span>
          <Link className={sort === "priority" ? "font-medium text-accent" : "text-muted"} href={`/analyst/queue?view=${view}&sort=priority`}>Priority</Link>
          <Link className={sort === "period" ? "font-medium text-accent" : "text-muted"} href={`/analyst/queue?view=${view}&sort=period`}>Period</Link></div>} />
      <LinkTabs tabs={tabs} active={view} />
      <Card>
        {error ? <p className="p-4 text-sm text-danger">Could not load the queue.</p> : rows.length === 0 ? <div className="p-4"><EmptyState title="Nothing here" description={view === "unassigned" ? "No submissions are waiting to be claimed." : undefined} /></div> : (
          <Table>
            <THead><tr><TH>Submission</TH><TH>Company</TH><TH>Period end</TH><TH>Status</TH><TH>Open issues</TH><TH>Submitted</TH><TH>Analyst</TH><TH /></tr></THead>
            <TBody>
              {rows.map((s) => {
                const analyst = s.analyst as unknown as { full_name: string | null; email: string } | null;
                return (
                  <TR key={s.id}>
                    <TD><Link href={`/analyst/submissions/${s.id}`} className="font-medium text-accent hover:underline">{s.submission_name}</Link>{s.is_synthetic ? <div className="mt-1"><SyntheticBadge /></div> : null}</TD>
                    <TD>{(s.companies as unknown as { display_name: string } | null)?.display_name}</TD>
                    <TD className="text-muted">{formatDate(s.reporting_period_end)}</TD>
                    <TD><StatusBadge status={s.submission_status} /></TD>
                    <TD className="space-x-1">{s.critical ? <Badge tone="danger">{s.critical} critical</Badge> : null}{s.high ? <Badge tone="warning">{s.high} high</Badge> : null}{!s.critical && !s.high ? <span className="text-xs text-muted">—</span> : null}</TD>
                    <TD className="text-muted">{formatDate(s.submitted_at)}</TD>
                    <TD className="min-w-48">{ctx.roles.includes("finance_reviewer") && !["published"].includes(s.submission_status)
                      ? <AssignForm action={assignSubmission} submissionId={s.id} analysts={analysts} current={s.assigned_analyst_id} />
                      : analyst?.full_name ?? analyst?.email ?? "Unassigned"}</TD>
                    <TD>{!s.assigned_analyst_id && s.submission_status === "awaiting_review" && ctx.roles.includes("finance_analyst")
                      ? <ActionButton action={claimSubmission} fields={{ submissionId: s.id }} label="Claim" variant="primary" /> : null}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
