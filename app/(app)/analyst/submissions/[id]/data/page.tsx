import { Card } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Notice } from "@/components/ui/states";
import { ActionButton } from "@/components/forms/action-form";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { requestReanalysis } from "../../../actions";
import { LineItemsTable, type LineItem } from "./line-items-table";

export default async function DataReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const { view = "review" } = await searchParams;
  const { supabase, canWork } = await loadAnalystSubmission(id);
  const [{ data: items }, { data: revisions }] = await Promise.all([
    supabase.from("financial_line_items")
      .select("id, statement_type, original_label, raw_value, parsed_value, normalized_value, normalized_category, mapping_status, confidence_score, source_sheet, source_cell_reference, source_page_number, source_table_reference, source_row, source_column, extraction_method, is_subtotal, financial_periods(period_label, sort_order), documents(original_filename)")
      .eq("submission_id", id).order("source_row").limit(5000),
    supabase.from("line_item_revisions").select("line_item_id, created_at, reason, previous, next, profiles(full_name, email), financial_line_items!inner(submission_id)")
      .eq("financial_line_items.submission_id", id).order("created_at", { ascending: false }),
  ]);
  const revByItem = new Map<string, LineItem["revisions"]>();
  for (const r of revisions ?? []) {
    const p = r.profiles as unknown as { full_name: string | null; email: string } | null;
    const list = revByItem.get(r.line_item_id) ?? [];
    list.push({ at: r.created_at, by: p?.full_name ?? p?.email ?? "—", reason: r.reason, previous: r.previous as Record<string, unknown>, next: r.next as Record<string, unknown> });
    revByItem.set(r.line_item_id, list);
  }
  const rows: LineItem[] = (items ?? []).map((i) => {
    const period = i.financial_periods as unknown as { period_label: string } | null;
    const reference = i.source_cell_reference ? `${i.source_sheet ?? "Sheet"}!${i.source_cell_reference}`
      : i.source_page_number ? `p.${i.source_page_number} ${i.source_table_reference ?? ""} r${i.source_row}c${i.source_column}`
      : i.source_row ? `row ${i.source_row}, col ${i.source_column}` : "Coordinates unavailable";
    return {
      id: i.id, statement_type: i.statement_type, original_label: i.original_label, period_label: period?.period_label ?? "—", raw_value: i.raw_value,
      parsed_value: i.parsed_value, normalized_value: i.normalized_value, normalized_category: i.normalized_category, mapping_status: i.mapping_status,
      confidence_score: i.confidence_score, reference, document: (i.documents as unknown as { original_filename: string } | null)?.original_filename ?? "",
      extraction_method: i.extraction_method, is_subtotal: i.is_subtotal, revisions: revByItem.get(i.id) ?? [],
    };
  });
  const count = (f: (r: LineItem) => boolean) => rows.filter(f).length;
  const base = `/analyst/submissions/${id}/data`;
  return (
    <div className="space-y-4">
      <Notice>Raw labels and values are exactly as extracted. Corrections change only the normalised category/value and are versioned with a reason. Run <b>Recalculate</b> after corrections to refresh metrics.</Notice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkTabs active={view} tabs={[
          { key: "review", label: "Needs review", href: `${base}?view=review`, count: count((r) => ["needs_review", "unmapped"].includes(r.mapping_status)) },
          { key: "income_statement", label: "Income statement", href: `${base}?view=income_statement`, count: count((r) => r.statement_type === "income_statement") },
          { key: "balance_sheet", label: "Balance sheet", href: `${base}?view=balance_sheet`, count: count((r) => r.statement_type === "balance_sheet") },
          { key: "cash_flow", label: "Cash flow", href: `${base}?view=cash_flow`, count: count((r) => r.statement_type === "cash_flow") },
          { key: "supporting", label: "Schedules", href: `${base}?view=supporting`, count: count((r) => r.statement_type === "supporting") },
          { key: "all", label: "All", href: `${base}?view=all`, count: rows.length },
        ]} />
        {canWork ? <ActionButton action={requestReanalysis} fields={{ submissionId: id }} label="Recalculate analysis" variant="primary" /> : null}
      </div>
      <Card><LineItemsTable items={rows} canWork={canWork} filter={view} /></Card>
    </div>
  );
}
