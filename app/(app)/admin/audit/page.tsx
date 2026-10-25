import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { FilterBar, Pager } from "@/components/tables/pager";
import { Input, Select } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { AuditTable, type AuditRow } from "@/components/tables/audit-table";
import { ilikePattern, PAGE_SIZE, pageRange, parsePage, str } from "@/lib/utilities/pagination";

export const metadata = { title: "Audit log" };

const ENTITY_TYPES = ["profile", "access_request", "company", "company_membership", "invitation", "submission", "document", "financial_line_item",
  "data_quality_issue", "red_flag", "ebitda_adjustment", "finding", "valuation_model", "report", "platform_setting"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole("superadmin");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const action = str(sp.action);
  const entity = str(sp.entity);
  const supabase = await createClient();
  let query = supabase.from("audit_logs").select("id, action, entity_type, entity_id, occurred_at, metadata, profiles(full_name, email)", { count: "exact" })
    .order("occurred_at", { ascending: false }).range(...pageRange(page));
  if (action) query = query.ilike("action", ilikePattern(action));
  if (entity) query = query.eq("entity_type", entity);
  const { data, count, error } = await query;
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of material actions. Entries cannot be edited or deleted by application roles." />
      <Card>
        <FilterBar>
          <div><label className="mb-1 block text-xs text-muted" htmlFor="action">Action contains</label><Input id="action" name="action" defaultValue={action} placeholder="e.g. role." /></div>
          <div>
            <label className="mb-1 block text-xs text-muted" htmlFor="entity">Entity</label>
            <Select id="entity" name="entity" defaultValue={entity ?? ""}>
              <option value="">All</option>
              {ENTITY_TYPES.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
          </div>
          <Button variant="secondary" type="submit">Apply</Button>
        </FilterBar>
        {error ? <p className="p-4 text-sm text-danger">Could not load the audit log.</p> : <AuditTable rows={(data ?? []) as unknown as AuditRow[]} />}
        <Pager page={page} total={count ?? 0} pageSize={PAGE_SIZE} basePath="/admin/audit" params={{ action, entity }} />
      </Card>
    </>
  );
}
