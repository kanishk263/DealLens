import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/financial/metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime } from "@/lib/utilities/format";

export const metadata = { title: "Analyst dashboard" };

export default async function AnalystDashboard() {
  const ctx = await requireRole("finance_analyst", "finance_reviewer");
  const supabase = await createClient();
  const [{ data: subs }, { count: openClar }, { count: pendingReports }] = await Promise.all([
    supabase.from("submissions").select("id, submission_name, submission_status, assigned_analyst_id, updated_at, companies(display_name)").order("updated_at", { ascending: false }),
    supabase.from("clarification_requests").select("id", { count: "exact", head: true }).in("status", ["open", "answered"]),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
  ]);
  const all = subs ?? [];
  const mine = all.filter((s) => s.assigned_analyst_id === ctx.userId);
  const count = (list: typeof all, statuses: string[]) => list.filter((s) => statuses.includes(s.submission_status)).length;
  const recent = all.filter((s) => ["reviewed", "published"].includes(s.submission_status)).slice(0, 5);
  return (
    <>
      <PageHeader title="Analyst dashboard" description={ctx.roles.includes("finance_reviewer") ? "Reviewer view: all submitted packages." : "Your assigned work and the unassigned queue."} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Unassigned" value={String(all.filter((s) => !s.assigned_analyst_id && s.submission_status === "awaiting_review").length)} />
        <MetricCard label="Assigned to me" value={String(mine.length)} />
        <MetricCard label="In analysis" value={String(count(mine, ["in_analysis"]))} />
        <MetricCard label="Clarifications pending" value={String(openClar ?? 0)} />
        <MetricCard label="Under review" value={String(count(all, ["under_review"]))} />
        <MetricCard label="Reports awaiting approval" value={String(pendingReports ?? 0)} />
        <MetricCard label="Completed" value={String(count(all, ["reviewed", "published"]))} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="My work" actions={<Link className="text-sm text-accent" href="/analyst/queue?view=mine">View all</Link>} />
          <CardBody>
            {mine.length === 0 ? <EmptyState title="Nothing assigned to you" action={<Link className="text-sm text-accent underline" href="/analyst/queue">Open the work queue</Link>} /> : (
              <ul className="divide-y divide-border">
                {mine.slice(0, 8).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/analyst/submissions/${s.id}`} className="font-medium hover:underline">{s.submission_name}<span className="ml-2 text-xs text-muted">{(s.companies as unknown as { display_name: string } | null)?.display_name}</span></Link>
                    <StatusBadge status={s.submission_status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recently completed" />
          <CardBody>
            {recent.length === 0 ? <EmptyState title="No completed work yet" /> : (
              <ul className="divide-y divide-border">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/analyst/submissions/${s.id}`} className="hover:underline">{s.submission_name}</Link>
                    <span className="flex items-center gap-2"><StatusBadge status={s.submission_status} /><span className="text-xs text-muted">{formatDateTime(s.updated_at)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
