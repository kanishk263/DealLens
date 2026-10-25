import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { LinkTabs } from "@/components/ui/link-tabs";
import { formatDateTime, humanize } from "@/lib/utilities/format";
import { ReviewRequestForm } from "./review-form";

export const metadata = { title: "Access requests" };

export default async function AccessRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireRole("superadmin");
  const { status = "pending" } = await searchParams;
  const supabase = await createClient();
  const [{ data: requests, error }, { data: companies }] = await Promise.all([
    supabase.from("access_requests")
      .select("id, user_id, requested_company_name, requested_role, business_justification, status, review_notes, created_at, reviewed_at, profiles!access_requests_user_id_fkey(full_name, email)")
      .eq("status", status === "pending" ? "pending" : status)
      .order("created_at", { ascending: status === "pending" })
      .limit(100),
    supabase.from("companies").select("id, display_name").eq("status", "active").order("display_name"),
  ]);
  return (
    <>
      <PageHeader title="Access requests" description="Approving a company-user request requires selecting the company the user will join." />
      <LinkTabs active={status} tabs={["pending", "approved", "rejected", "withdrawn"].map((s) => ({ key: s, label: humanize(s), href: `/admin/access-requests?status=${s}` }))} />
      <Card>
        {error ? <p className="p-4 text-sm text-danger">Could not load requests.</p> : (requests ?? []).length === 0 ? (
          <div className="p-4"><EmptyState title={`No ${status} requests`} /></div>
        ) : (
          <Table>
            <THead><tr><TH>Requester</TH><TH>Organisation</TH><TH>Role</TH><TH>Justification</TH><TH>Submitted</TH><TH>{status === "pending" ? "Decision" : "Status"}</TH></tr></THead>
            <TBody>
              {(requests ?? []).map((r) => {
                const p = r.profiles as unknown as { full_name: string | null; email: string } | null;
                return (
                  <TR key={r.id}>
                    <TD><p className="font-medium">{p?.full_name ?? "—"}</p><p className="text-xs text-muted">{p?.email}</p></TD>
                    <TD>{r.requested_company_name}</TD>
                    <TD>{humanize(r.requested_role)}</TD>
                    <TD className="max-w-xs text-muted">{r.business_justification}</TD>
                    <TD className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</TD>
                    <TD className="min-w-64">
                      {r.status === "pending" ? (
                        r.user_id === ctx.userId ? <span className="text-xs text-muted">You cannot review your own request.</span> :
                        <ReviewRequestForm requestId={r.id} role={r.requested_role} companies={companies ?? []} />
                      ) : (
                        <div><StatusBadge status={r.status} />{r.review_notes ? <p className="mt-1 text-xs text-muted">{r.review_notes}</p> : null}</div>
                      )}
                    </TD>
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
