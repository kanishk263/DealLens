import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Pager } from "@/components/tables/pager";
import { ActionButton } from "@/components/forms/action-form";
import { formatDateTime, humanize } from "@/lib/utilities/format";
import { PAGE_SIZE, pageRange, parsePage } from "@/lib/utilities/pagination";
import { retryProcessing } from "../actions";

export const metadata = { title: "Processing jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole("superadmin");
  const sp = await searchParams;
  const filter = sp.status ?? "all";
  const page = parsePage(sp.page);
  const supabase = await createClient();
  let query = supabase.from("processing_jobs")
    .select("id, job_type, job_status, attempt_count, max_attempts, error_code, safe_error_message, created_at, started_at, completed_at, submission_id, submissions(submission_name, submission_status), documents(original_filename)", { count: "exact" })
    .order("created_at", { ascending: false }).range(...pageRange(page));
  if (filter !== "all") query = query.eq("job_status", filter);
  const { data, count, error } = await query;
  return (
    <>
      <PageHeader title="Processing jobs" description="Worker job history. Error messages are sanitised; stack traces are never stored." />
      <LinkTabs active={filter} tabs={["all", "queued", "running", "failed", "succeeded"].map((s) => ({ key: s, label: humanize(s), href: `/admin/jobs?status=${s}` }))} />
      <Card>
        {error ? <p className="p-4 text-sm text-danger">Could not load jobs.</p> : (data ?? []).length === 0 ? <div className="p-4"><EmptyState title="No jobs" /></div> : (
          <Table>
            <THead><tr><TH>Job</TH><TH>Submission</TH><TH>Status</TH><TH>Attempts</TH><TH>Error</TH><TH>Created</TH><TH>Completed</TH><TH /></tr></THead>
            <TBody>
              {(data ?? []).map((j) => {
                const sub = j.submissions as unknown as { submission_name: string; submission_status: string } | null;
                const doc = j.documents as unknown as { original_filename: string } | null;
                return (
                  <TR key={j.id}>
                    <TD><p>{humanize(j.job_type)}</p>{doc ? <p className="text-xs text-muted">{doc.original_filename}</p> : null}</TD>
                    <TD>{sub?.submission_name ?? "—"}</TD>
                    <TD><StatusBadge status={j.job_status} /></TD>
                    <TD className="tabular">{j.attempt_count}/{j.max_attempts}</TD>
                    <TD className="max-w-xs text-xs">{j.error_code ? <><span className="font-mono">{j.error_code}</span><p className="text-muted">{j.safe_error_message}</p></> : "—"}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(j.created_at)}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(j.completed_at)}</TD>
                    <TD>{sub?.submission_status === "processing_failed" ? <ActionButton action={retryProcessing} fields={{ submissionId: j.submission_id }} label="Retry" /> : null}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} basePath="/admin/jobs" params={{ status: filter }} />
      </Card>
    </>
  );
}
