import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utilities/format";

export const metadata = { title: "Published reports" };

export default async function PublishedReportsPage() {
  await requireRole("company_user");
  const supabase = await createClient();
  const { data, error } = await supabase.from("reports").select("id, report_title, report_version, status, published_at, submission_id, submissions(submission_name, companies(display_name))")
    .in("status", ["published", "superseded"]).order("published_at", { ascending: false });
  return (
    <>
      <PageHeader title="Published reports" description="Analyst-approved reports published to your company. Superseded versions remain available for reference." />
      <Card>
        {error ? <p className="p-4 text-sm text-danger">Could not load reports.</p> : !data?.length ? <div className="p-4"><EmptyState title="No published reports yet" /></div> : (
          <Table>
            <THead><tr><TH>Report</TH><TH>Submission</TH><TH>Company</TH><TH>Status</TH><TH>Published</TH><TH /></tr></THead>
            <TBody>
              {data.map((r) => {
                const s = r.submissions as unknown as { submission_name: string; companies: { display_name: string } | null } | null;
                return (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.report_title} <span className="text-muted">v{r.report_version}</span></TD>
                    <TD><Link href={`/submissions/${r.submission_id}?tab=reports`} className="text-accent hover:underline">{s?.submission_name}</Link></TD>
                    <TD>{s?.companies?.display_name}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD className="text-xs text-muted">{formatDateTime(r.published_at)}</TD>
                    <TD><a className="text-sm text-accent hover:underline" href={`/api/reports/${r.id}/download`}>Download PDF</a></TD>
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
