import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialSnapshot } from "./metrics-data";
import type { SourceRef, TableCell } from "@/components/financial/metric-table";

/** Builds serialisable cells and the line-item references they cite, for the given metric keys. */
export async function tableData(supabase: SupabaseClient, snap: FinancialSnapshot, keys: string[]) {
  const cells: Record<string, TableCell> = {};
  const ids = new Set<string>();
  for (const k of keys) for (const p of snap.periods) {
    const c = snap.get(k, p.id);
    if (c) { cells[`${k}|${p.id}`] = c; c.lineItemIds.forEach((i) => ids.add(i)); }
  }
  const sources: Record<string, SourceRef> = {};
  const list = [...ids];
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await supabase.from("financial_line_items")
      .select("id, original_label, normalized_value, source_sheet, source_cell_reference, source_page_number, source_table_reference, source_row, source_column, documents(original_filename)")
      .in("id", list.slice(i, i + 200));
    for (const li of data ?? []) {
      sources[li.id] = {
        label: li.original_label, value: li.normalized_value,
        document: (li.documents as unknown as { original_filename: string } | null)?.original_filename ?? "",
        reference: li.source_cell_reference ? `${li.source_sheet}!${li.source_cell_reference}` : li.source_page_number ? `p.${li.source_page_number} r${li.source_row}c${li.source_column}`
          : li.source_row ? `row ${li.source_row}, col ${li.source_column}` : "coordinates unavailable",
      };
    }
  }
  return { cells, sources, keys: keys.filter((k) => snap.keys.has(k)) };
}
