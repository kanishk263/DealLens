import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, SyntheticBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { ActionButton } from "@/components/forms/action-form";
import { formatDateTime } from "@/lib/utilities/format";
import { CompanyFormModal, type CompanyRecord } from "../company-form";
import { InviteForm } from "./invite-form";
import { revokeInvitation, setMembershipStatus } from "../../actions";

export default async function CompanyDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("superadmin");
  const { id } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
  if (!company) notFound();
  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase.from("company_memberships").select("id, status, membership_role, created_at, profiles!company_memberships_user_id_fkey(full_name, email)").eq("company_id", id).order("created_at"),
    supabase.from("invitations").select("id, email, expires_at, accepted_at, revoked_at, created_at").eq("company_id", id).order("created_at", { ascending: false }),
  ]);
  return (
    <>
      <PageHeader
        title={company.display_name}
        description={company.legal_name}
        breadcrumbs={[{ label: "Companies", href: "/admin/companies" }, { label: company.display_name }]}
        badges={<><StatusBadge status={company.status} />{company.is_synthetic ? <SyntheticBadge /> : null}</>}
        actions={<CompanyFormModal company={company as CompanyRecord} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Members" />
          {(members ?? []).length === 0 ? <CardBody><EmptyState title="No members" description="Approve an access request or send an invitation." /></CardBody> : (
            <Table>
              <THead><tr><TH>User</TH><TH>Status</TH><TH>Since</TH><TH>Action</TH></tr></THead>
              <TBody>
                {(members ?? []).map((m) => {
                  const p = m.profiles as unknown as { full_name: string | null; email: string } | null;
                  return (
                    <TR key={m.id}>
                      <TD><p>{p?.full_name ?? "—"}</p><p className="text-xs text-muted">{p?.email}</p></TD>
                      <TD><StatusBadge status={m.status} /></TD>
                      <TD className="text-muted">{formatDateTime(m.created_at)}</TD>
                      <TD>
                        {m.status === "active" ? (
                          <ActionButton action={setMembershipStatus} fields={{ membershipId: m.id, status: "suspended" }} label="Suspend" variant="ghost" confirm="Suspend this membership?" />
                        ) : m.status === "suspended" ? (
                          <ActionButton action={setMembershipStatus} fields={{ membershipId: m.id, status: "active" }} label="Reactivate" />
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Invite a user" description="Links are single-use, bound to the email address, and expire." />
          <CardBody><InviteForm companyId={id} /></CardBody>
          <div className="border-t border-border">
            {(invitations ?? []).length === 0 ? <p className="px-5 py-3 text-sm text-muted">No invitations sent.</p> : (
              <ul className="divide-y divide-border text-sm">
                {(invitations ?? []).map((i) => {
                  const state = i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : new Date(i.expires_at) < new Date() ? "expired" : "pending";
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                      <div><p>{i.email}</p><p className="text-xs text-muted">Expires {formatDateTime(i.expires_at)}</p></div>
                      {state === "pending" ? <ActionButton action={revokeInvitation} fields={{ invitationId: i.id }} label="Revoke" variant="ghost" /> : <StatusBadge status={state === "accepted" ? "approved" : state === "expired" ? "dismissed" : "revoked"} label={state} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
