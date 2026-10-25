import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { MetricCard } from "@/components/financial/metric-card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { formatDateTime, humanize } from "@/lib/utilities/format";

export const metadata = { title: "Platform overview" };

export default async function AdminOverview() {
  await requireRole("superadmin");
  const supabase = await createClient();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const [users, pendingUsers, pendingRequests, companies, submissions, failedJobs, queuedJobs, recent, byStatus] = await Promise.all([
    count(supabase.from("profiles").select("id", { count: "exact", head: true })),
    count(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("account_status", "pending_approval")),
    count(supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
    count(supabase.from("companies").select("id", { count: "exact", head: true }).eq("status", "active")),
    count(supabase.from("submissions").select("id", { count: "exact", head: true })),
    count(supabase.from("processing_jobs").select("id", { count: "exact", head: true }).eq("job_status", "failed")),
    count(supabase.from("processing_jobs").select("id", { count: "exact", head: true }).in("job_status", ["queued", "running"])),
    supabase.from("audit_logs").select("id, action, entity_type, occurred_at, profiles(full_name, email)").order("occurred_at", { ascending: false }).limit(10),
    supabase.from("submissions").select("submission_status"),
  ]);
  const statusCounts = new Map<string, number>();
  (byStatus.data ?? []).forEach((s) => statusCounts.set(s.submission_status, (statusCounts.get(s.submission_status) ?? 0) + 1));

  return (
    <>
      <PageHeader title="Platform overview" description="Operational view of users, companies, submissions and processing. Financial content is not visible from the administrative role." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Users" value={String(users)} sublabel={`${pendingUsers} pending approval`} />
        <MetricCard label="Access requests" value={String(pendingRequests)} sublabel="awaiting review" />
        <MetricCard label="Active companies" value={String(companies)} />
        <MetricCard label="Processing jobs" value={String(queuedJobs)} sublabel={`${failedJobs} failed`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Submissions by status" description={`${submissions} total`} actions={<Link href="/admin/submissions" className="text-sm text-accent">View all</Link>} />
          <CardBody>
            {statusCounts.size === 0 ? <EmptyState title="No submissions yet" /> : (
              <ul className="space-y-2">
                {[...statusCounts.entries()].map(([s, n]) => (
                  <li key={s} className="flex items-center justify-between text-sm"><StatusBadge status={s} /><span className="tabular">{n}</span></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activity" actions={<Link href="/admin/audit" className="text-sm text-accent">Audit log</Link>} />
          {(recent.data ?? []).length === 0 ? <CardBody><EmptyState title="No activity yet" /></CardBody> : (
            <Table>
              <THead><tr><TH>When</TH><TH>Actor</TH><TH>Action</TH></tr></THead>
              <TBody>
                {(recent.data ?? []).map((r) => {
                  const actor = r.profiles as unknown as { full_name: string | null; email: string } | null;
                  return (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap text-muted">{formatDateTime(r.occurred_at)}</TD>
                      <TD>{actor?.full_name ?? actor?.email ?? "System"}</TD>
                      <TD>{humanize(r.action.replace(/\./g, " · "))}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
