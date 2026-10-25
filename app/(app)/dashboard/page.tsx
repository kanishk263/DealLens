import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/auth/session";
import { homePathFor } from "@/lib/authorization/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MetricCard } from "@/components/financial/metric-card";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utilities/format";

export const metadata = { title: "Dashboard" };

export default async function CompanyDashboard() {
  const ctx = await requireActive();
  if (!ctx.roles.includes("company_user")) redirect(homePathFor(ctx.roles));
  const supabase = await createClient();
  // RLS limits every query below to the caller's companies.
  const [{ data: subs }, { count: openClarifications }, { count: publishedReports }, { data: history }] = await Promise.all([
    supabase.from("submissions").select("id, submission_name, submission_status, updated_at"),
    supabase.from("clarification_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("submission_status_history").select("id, to_status, occurred_at, submission_id, submissions(submission_name)").order("occurred_at", { ascending: false }).limit(8),
  ]);
  const all = subs ?? [];
  const n = (pred: (s: string) => boolean) => all.filter((s) => pred(s.submission_status)).length;

  return (
    <>
      <PageHeader
        title="Company dashboard"
        description={ctx.companies.map((c) => c.displayName).join(", ") || "No active company membership"}
        badges={ctx.companies.some((c) => c.isSynthetic) ? <SyntheticBadge /> : null}
        actions={<Button asChild><Link href="/submissions/new">New submission</Link></Button>}
      />
      {ctx.companies.length === 0 ? (
        <EmptyState title="No active company membership" description="Your account is active but not linked to a company. Contact your administrator." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Submissions" value={String(all.length)} />
            <MetricCard label="Processing" value={String(n((s) => ["uploaded", "processing"].includes(s)))} />
            <MetricCard label="Awaiting analyst" value={String(n((s) => s === "awaiting_review"))} />
            <MetricCard label="Clarifications to answer" value={String(openClarifications ?? 0)} />
            <MetricCard label="Published reports" value={String(publishedReports ?? 0)} />
          </div>
          <Card className="mt-6">
            <CardHeader title="Recent activity" actions={<Link href="/submissions" className="text-sm text-accent">All submissions</Link>} />
            <CardBody>
              {(history ?? []).length === 0 ? <EmptyState title="No activity yet" description="Create a submission and upload financial statements to get started." /> : (
                <ul className="divide-y divide-border">
                  {(history ?? []).map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <Link href={`/submissions/${h.submission_id}`} className="font-medium hover:underline">
                        {(h.submissions as unknown as { submission_name: string } | null)?.submission_name}
                      </Link>
                      <span className="flex items-center gap-3"><StatusBadge status={h.to_status} /><span className="text-xs text-muted">{formatDateTime(h.occurred_at)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
