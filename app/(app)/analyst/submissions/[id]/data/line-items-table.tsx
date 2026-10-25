"use client";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { CATEGORY_GROUPS, categoryLabel } from "@/lib/financial/taxonomy";
import { formatDateTime, humanize } from "@/lib/utilities/format";
import { confirmMappings, updateLineItem } from "../../../actions";

export interface LineItem {
  id: string; statement_type: string; original_label: string; period_label: string; raw_value: string | null; parsed_value: number | null;
  normalized_value: number | null; normalized_category: string | null; mapping_status: string; confidence_score: number | null;
  reference: string; document: string; extraction_method: string; is_subtotal: boolean;
  revisions: { at: string; by: string; reason: string; previous: Record<string, unknown>; next: Record<string, unknown> }[];
}

const num = (v: number | null) => (v === null || v === undefined ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(v)));

export function LineItemsTable({ items, canWork, filter }: { items: LineItem[]; canWork: boolean; filter: string }) {
  const [editing, setEditing] = useState<LineItem | null>(null);
  const shown = useMemo(() => filter === "all" ? items : filter === "review" ? items.filter((i) => ["needs_review", "unmapped"].includes(i.mapping_status)) : items.filter((i) => i.statement_type === filter), [items, filter]);
  const reviewable = shown.filter((i) => i.mapping_status === "needs_review" && i.normalized_category);
  const columns = useMemo<ColumnDef<LineItem, unknown>[]>(() => [
    { accessorKey: "original_label", header: "Source label", cell: ({ row }) => <span className={row.original.is_subtotal ? "font-medium" : ""}>{row.original.original_label}</span> },
    { accessorKey: "period_label", header: "Period" },
    { accessorKey: "raw_value", header: "Raw value", cell: ({ getValue }) => <span className="tabular font-mono text-xs">{String(getValue() ?? "—")}</span> },
    { accessorKey: "normalized_value", header: "Normalised", cell: ({ getValue }) => <span className="tabular">{num(getValue() as number | null)}</span> },
    { accessorKey: "normalized_category", header: "Category", cell: ({ getValue }) => categoryLabel(getValue() as string | null) },
    { accessorKey: "mapping_status", header: "Mapping", cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: "confidence_score", header: "Confidence", cell: ({ getValue }) => getValue() === null ? "—" : `${Math.round(Number(getValue()) * 100)}%` },
    { accessorKey: "reference", header: "Source", cell: ({ row }) => <span className="text-xs text-muted" title={row.original.document}>{row.original.reference}</span> },
    { accessorKey: "statement_type", header: "Statement", cell: ({ getValue }) => humanize(getValue() as string) },
    { accessorKey: "extraction_method", header: "Method", cell: ({ getValue }) => <span className="text-xs text-muted">{String(getValue())}</span> },
    { id: "actions", header: "", enableSorting: false, enableHiding: false, cell: ({ row }) => (
      <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}>{canWork ? "Review" : "History"}</Button>
    ) },
  ], [canWork]);

  return (
    <>
      {canWork && reviewable.length > 0 ? (
        <ActionForm action={confirmMappings} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-sm">
          {(pending) => (
            <>
              {reviewable.map((i) => <input key={i.id} type="hidden" name="lineItemId" value={i.id} />)}
              <span className="text-muted">{reviewable.length} proposed mapping(s) in this view need confirmation.</span>
              <SubmitButton pending={pending} size="sm" variant="secondary" confirm={`Confirm ${reviewable.length} proposed mappings as shown?`}>Confirm all shown</SubmitButton>
            </>
          )}
        </ActionForm>
      ) : null}
      <DataTable columns={columns} data={shown} searchPlaceholder="Search labels, categories, periods…" initialHidden={["statement_type", "extraction_method"]} pageSize={50} emptyMessage="No line items in this view" />
      {editing ? (
        <Modal open onOpenChange={(o) => !o && setEditing(null)} wide title={editing.original_label} description={`${editing.period_label} · ${editing.document} · ${editing.reference}`}>
          <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted">Raw value (source)</dt><dd className="font-mono">{editing.raw_value ?? "—"}</dd></div>
            <div><dt className="text-muted">Parsed</dt><dd>{num(editing.parsed_value)}</dd></div>
            <div><dt className="text-muted">Normalised</dt><dd>{num(editing.normalized_value)}</dd></div>
          </dl>
          {canWork ? (
            <ActionForm action={updateLineItem} onSuccess={() => setEditing(null)} className="space-y-3">
              {(pending) => (
                <>
                  <input type="hidden" name="lineItemId" value={editing.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Category" htmlFor="category">
                      <Select id="category" name="category" defaultValue={editing.normalized_category ?? ""}>
                        <option value="">— none —</option>
                        {CATEGORY_GROUPS.map((g) => <optgroup key={g.statement} label={g.label}>{Object.entries(g.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>)}
                      </Select>
                    </Field>
                    <Field label="Decision" htmlFor="mappingStatus">
                      <Select id="mappingStatus" name="mappingStatus" defaultValue="analyst_confirmed">
                        <option value="analyst_confirmed">Confirm mapping</option><option value="analyst_mapped">Map to selected category</option>
                        <option value="excluded">Exclude from calculations</option><option value="unmapped">Mark as unmapped</option>
                      </Select>
                    </Field>
                    <Field label="Normalised value" htmlFor="normalizedValue" hint="Leave as is unless correcting a sign or unit. The raw value is never changed.">
                      <Input id="normalizedValue" name="normalizedValue" defaultValue={editing.normalized_value ?? ""} />
                    </Field>
                  </div>
                  <Field label="Reason (recorded in the audit trail)" htmlFor="reason"><Textarea id="reason" name="reason" required minLength={3} /></Field>
                  <SubmitButton pending={pending}>Save correction</SubmitButton>
                </>
              )}
            </ActionForm>
          ) : null}
          <h3 className="mt-6 text-sm font-semibold">Review history</h3>
          {editing.revisions.length === 0 ? <p className="text-sm text-muted">No analyst changes. Values are as extracted.</p> : (
            <ul className="mt-2 space-y-2 text-xs">
              {editing.revisions.map((r, i) => (
                <li key={i} className="rounded-md border border-border p-2">
                  <p className="font-medium">{formatDateTime(r.at)} · {r.by}</p>
                  <p className="text-muted">{categoryLabel(r.previous.normalized_category as string)} ({String(r.previous.mapping_status)}, {num(r.previous.normalized_value as number)}) → {categoryLabel(r.next.normalized_category as string)} ({String(r.next.mapping_status)}, {num(r.next.normalized_value as number)})</p>
                  <p>Reason: {r.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}
    </>
  );
}
