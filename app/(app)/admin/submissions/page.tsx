import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listAnalysts } from "@/lib/database/analysts";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { FilterBar, Pager } from "@/components/tables/pager";
import { Input, Select } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/forms/action-form";
import { AssignForm } from "@/components/forms/assign-form";
import { SUBMISSION_STATUSES } from "@/lib/submissions/workflow";
import { formatDate, formatDateTime } from "@/lib/utilities/format";
import { ilikePattern, PAGE_SIZE, pageRange, parsePage, str } from "@/lib/utilities/pagination";
import { archiveSubmission, assignSubmission, retryProcessing } from "../actions";

export const metadata = { title: "Submission monitoring" };

export default async function AdminSubmissions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole("superadmin");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = str(sp.q);
  const status = str(sp.status);
  const supabase = await createClient();
  let query = supabase.from("submissions")
    .select("id, submission_name, submission_status, reporting_period_end, updated_at, is_synthetic, assigned_analyst_id, companies(display_name), analyst:profiles!submissions_assigned_analyst_id_fkey(full_name, email)", { count: "exact" })
    .order("updated_at", { ascending: false }).range(...pageRange(page));
  if (q) query = query.ilike("submission_name", ilikePattern(q));
  if (status) query = query.eq("submission_status", status);
  const [{ data, count, error }, analysts] = await Promise.all([query, listAnalysts(supabase)]);

  return (
    <>
      <PageHeader title="Submission monitoring" description="Metadata, status and assignment oversight. Document contents and financial data are not accessible from this role." />
      <Card>
        <FilterBar>
          <div><label className="mb-1 block text-xs text-muted" htmlFor="q">Search</label><Input id="q" name="q" defaultValue={q} placeholder="Submission name" /></div>
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="status">Status</label>
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              {SUBMISSION_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </Select>
          </div>
          <Button variant="secondary" type="submit">Apply</Button>
        </FilterBar>
        {error ? <p className="p-4 text-sm text-danger">Could not load submissions.</p> : (data ?? []).length === 0 ? <div className="p-4"><EmptyState title="No submissions match" /></div> : (
          <Table>
            <THead><tr><TH>Submission</TH><TH>Company</TH><TH>Period end</TH><TH>Status</TH><TH>Analyst</TH><TH>Updated</TH><TH>Actions</TH></tr></THead>
            <TBody>
              {(data ?? []).map((s) => {
                const analyst = s.analyst as unknown as { full_name: string | null; email: string } | null;
                return (
                  <TR key={s.id}>
                    <TD><p className="font-medium">{s.submission_name}</p>{s.is_synthetic ? <SyntheticBadge /> : null}</TD>
                    <TD>{(s.companies as unknown as { display_name: string } | null)?.display_name}</TD>
                    <TD className="text-muted">{formatDate(s.reporting_period_end)}</TD>
                    <TD><StatusBadge status={s.submission_status} /></TD>
                    <TD className="min-w-56">
                      {["draft", "archived", "published"].includes(s.submission_status) ? (analyst?.full_name ?? analyst?.email ?? "—") :
                        <AssignForm action={assignSubmission} submissionId={s.id} analysts={analysts} current={s.assigned_analyst_id} />}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(s.updated_at)}</TD>
                    <TD className="space-y-1">
                      {s.submission_status === "processing_failed" ? <ActionButton action={retryProcessing} fields={{ submissionId: s.id }} label="Retry processing" /> : null}
                      {["draft", "awaiting_review", "in_analysis", "processing_failed", "published"].includes(s.submission_status) ? (
                        <ActionButton action={archiveSubmission} fields={{ submissionId: s.id }} label="Archive" variant="ghost" confirm="Archive this submission? It will leave active work queues." />
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} basePath="/admin/submissions" params={{ q, status }} />
      </Card>
    </>
  );
}
