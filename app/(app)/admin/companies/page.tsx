import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/utilities/format";
import { CompanyFormModal } from "./company-form";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  await requireRole("superadmin");
  const supabase = await createClient();
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, legal_name, display_name, industry, country, reporting_currency, reporting_unit, status, is_synthetic, created_at, company_memberships(count), submissions(count)")
    .order("display_name");
  return (
    <>
      <PageHeader title="Companies" description="Company records, memberships and invitations." actions={<CompanyFormModal />} />
      <Card>
        {error ? <p className="p-4 text-sm text-danger">Could not load companies.</p> : (companies ?? []).length === 0 ? (
          <div className="p-4"><EmptyState title="No companies yet" description="Create a company before approving company users." /></div>
        ) : (
          <Table>
            <THead><tr><TH>Company</TH><TH>Industry</TH><TH>Reporting</TH><TH>Members</TH><TH>Submissions</TH><TH>Status</TH><TH>Created</TH></tr></THead>
            <TBody>
              {(companies ?? []).map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/admin/companies/${c.id}`} className="font-medium text-accent hover:underline">{c.display_name}</Link>
                    <p className="text-xs text-muted">{c.legal_name}</p>
                    {c.is_synthetic ? <div className="mt-1"><SyntheticBadge /></div> : null}
                  </TD>
                  <TD className="text-muted">{c.industry ?? "—"}{c.country ? ` · ${c.country}` : ""}</TD>
                  <TD className="text-muted">{c.reporting_currency} · {c.reporting_unit}</TD>
                  <TD className="tabular">{(c.company_memberships as unknown as { count: number }[])[0]?.count ?? 0}</TD>
                  <TD className="tabular">{(c.submissions as unknown as { count: number }[])[0]?.count ?? 0}</TD>
                  <TD><StatusBadge status={c.status} /></TD>
                  <TD className="text-muted">{formatDate(c.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
