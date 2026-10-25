import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { FilterBar, Pager } from "@/components/tables/pager";
import { Input, Select } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type RoleKey } from "@/lib/authorization/roles";
import { formatDateTime } from "@/lib/utilities/format";
import { ilikePattern, PAGE_SIZE, pageRange, parsePage, str } from "@/lib/utilities/pagination";
import { UserControls } from "./user-controls";

export const metadata = { title: "Users & roles" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireRole("superadmin");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = str(sp.q);
  const status = str(sp.status);
  const supabase = await createClient();
  let query = supabase.from("profiles")
    .select("id, full_name, email, account_status, last_login_at, created_at, user_roles!user_roles_user_id_fkey(revoked_at, roles(role_key)), company_memberships!company_memberships_user_id_fkey(id, status, companies(display_name))", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (q) query = query.or(`email.ilike.${ilikePattern(q)},full_name.ilike.${ilikePattern(q)}`);
  if (status) query = query.eq("account_status", status);
  const { data: users, count, error } = await query;

  return (
    <>
      <PageHeader title="Users & roles" description="Role changes and suspensions are audited. You cannot change your own roles or status." />
      <Card>
        <FilterBar>
          <div><label className="mb-1 block text-xs text-muted" htmlFor="q">Search</label><Input id="q" name="q" defaultValue={q} placeholder="Name or email" /></div>
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="status">Status</label>
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All</option>
              {["pending_approval", "active", "suspended", "rejected"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
          </div>
          <Button variant="secondary" type="submit">Apply</Button>
        </FilterBar>
        {error ? <p className="p-4 text-sm text-danger">Could not load users.</p> : (users ?? []).length === 0 ? <div className="p-4"><EmptyState title="No users match" /></div> : (
          <Table>
            <THead><tr><TH>User</TH><TH>Status</TH><TH>Roles</TH><TH>Companies</TH><TH>Last sign-in</TH><TH>Manage</TH></tr></THead>
            <TBody>
              {(users ?? []).map((u) => {
                const roles = ((u.user_roles ?? []) as unknown as { revoked_at: string | null; roles: { role_key: RoleKey } | null }[])
                  .filter((r) => !r.revoked_at && r.roles).map((r) => r.roles!.role_key);
                const memberships = (u.company_memberships ?? []) as unknown as { id: string; status: string; companies: { display_name: string } | null }[];
                return (
                  <TR key={u.id}>
                    <TD><p className="font-medium">{u.full_name ?? "—"}</p><p className="text-xs text-muted">{u.email}</p></TD>
                    <TD><StatusBadge status={u.account_status} /></TD>
                    <TD><div className="flex flex-wrap gap-1">{roles.length ? roles.map((r) => <Badge key={r} tone="accent">{ROLE_LABELS[r]}</Badge>) : <span className="text-xs text-muted">None</span>}</div></TD>
                    <TD className="text-xs text-muted">{memberships.filter((m) => m.status === "active").map((m) => m.companies?.display_name).join(", ") || "—"}</TD>
                    <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(u.last_login_at)}</TD>
                    <TD className="min-w-56">{u.id === ctx.userId ? <span className="text-xs text-muted">This is you</span> : <UserControls userId={u.id} status={u.account_status} roles={roles} />}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} basePath="/admin/users" params={{ q, status }} />
      </Card>
    </>
  );
}
