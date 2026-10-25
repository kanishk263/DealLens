import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { FilterBar, Pager } from "@/components/tables/pager";
import { Input, Select } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { SUBMISSION_STATUSES } from "@/lib/submissions/workflow";
import { formatDate, formatDateTime } from "@/lib/utilities/format";
import { ilikePattern, PAGE_SIZE, pageRange, parsePage, str } from "@/lib/utilities/pagination";

export const metadata = { title: "Submissions" };

const SORTS: Record<string, [string, boolean]> = {
  updated: ["updated_at", false], period: ["reporting_period_end", false], name: ["submission_name", true], created: ["created_at", false],
};

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole("company_user");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = str(sp.q);
  const status = str(sp.status);
  const sort = SORTS[sp.sort ?? "updated"] ? sp.sort ?? "updated" : "updated";
  const [col, asc] = SORTS[sort];
  const supabase = await createClient();
  let query = supabase.from("submissions")
    .select("id, submission_name, submission_status, reporting_period_start, reporting_period_end, reporting_currency, reporting_unit, updated_at, is_synthetic, companies(display_name), analyst:profiles!submissions_assigned_analyst_id_fkey(full_name)", { count: "exact" })
    .order(col, { ascending: asc }).range(...pageRange(page));
  if (q) query = query.ilike("submission_name", ilikePattern(q));
  if (status) query = query.eq("submission_status", status);
  const { data, count, error } = await query;

  return (
    <>
      <PageHeader title="Submissions" description="Financial document packages submitted by your company." actions={<Button asChild><Link href="/submissions/new">New submission</Link></Button>} />
      <Card>
        <FilterBar>
          <div><label className="mb-1 block text-xs text-muted" htmlFor="q">Search</label><Input id="q" name="q" defaultValue={q} placeholder="Submission name" /></div>
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="status">Status</label>
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              {SUBMISSION_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="sort">Sort by</label>
            <Select id="sort" name="sort" defaultValue={sort}>
              <option value="updated">Last updated</option><option value="period">Reporting period</option><option value="name">Name</option><option value="created">Created</option>
            </Select>
          </div>
          <Button variant="secondary" type="submit">Apply</Button>
        </FilterBar>
        {error ? <p className="p-4 text-sm text-danger">Could not load submissions.</p> : (data ?? []).length === 0 ? (
          <div className="p-4"><EmptyState title={q || status ? "No submissions match your filters" : "No submissions yet"} action={<Button asChild size="sm"><Link href="/submissions/new">Create a submission</Link></Button>} /></div>
        ) : (
          <Table>
            <THead><tr><TH>Submission</TH><TH>Company</TH><TH>Reporting period</TH><TH>Status</TH><TH>Analyst</TH><TH>Last updated</TH></tr></THead>
            <TBody>
              {(data ?? []).map((s) => (
                <TR key={s.id}>
                  <TD><Link href={`/submissions/${s.id}`} className="font-medium text-accent hover:underline">{s.submission_name}</Link>{s.is_synthetic ? <div className="mt-1"><SyntheticBadge /></div> : null}</TD>
                  <TD>{(s.companies as unknown as { display_name: string } | null)?.display_name}</TD>
                  <TD className="whitespace-nowrap text-muted">{formatDate(s.reporting_period_start)} – {formatDate(s.reporting_period_end)}<p className="text-xs">{s.reporting_currency} · {s.reporting_unit}</p></TD>
                  <TD><StatusBadge status={s.submission_status} /></TD>
                  <TD className="text-muted">{(s.analyst as unknown as { full_name: string | null } | null)?.full_name ?? "Not assigned"}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(s.updated_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} basePath="/submissions" params={{ q, status, sort }} />
      </Card>
    </>
  );
}
