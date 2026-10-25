import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MetricCell {
  value: number | null; status: string; reason: string | null; inputs: Record<string, unknown>; lineItemIds: string[];
}
export interface PeriodCol { id: string; label: string; type: string; end: string | null }
export interface FinancialSnapshot {
  version: number;
  periods: PeriodCol[];
  get: (key: string, periodId: string) => MetricCell | undefined;
  series: (key: string) => { period: string; periodId: string; value: number | null }[];
  latest: (key: string) => { period: PeriodCol; cell: MetricCell } | undefined;
  keys: Set<string>;
}

/** Loads the latest analysis version's metrics for actual periods (RLS applies to the caller). */
export async function loadSnapshot(supabase: SupabaseClient, submissionId: string, version: number): Promise<FinancialSnapshot> {
  const [{ data: periods }, { data: metrics }] = await Promise.all([
    supabase.from("financial_periods").select("id, period_label, period_type, period_end, sort_order, scenario").eq("submission_id", submissionId).eq("scenario", "actual").order("sort_order"),
    supabase.from("financial_metrics").select("financial_period_id, metric_key, metric_value, metric_status, status_reason, calculation_inputs, source_line_item_ids")
      .eq("submission_id", submissionId).eq("analysis_version", version).limit(5000),
  ]);
  const cols: PeriodCol[] = (periods ?? []).map((p) => ({ id: p.id, label: p.period_label, type: p.period_type, end: p.period_end }));
  const map = new Map<string, MetricCell>();
  const keys = new Set<string>();
  for (const m of metrics ?? []) {
    keys.add(m.metric_key);
    map.set(`${m.metric_key}|${m.financial_period_id}`, {
      value: m.metric_value === null ? null : Number(m.metric_value), status: m.metric_status, reason: m.status_reason,
      inputs: (m.calculation_inputs ?? {}) as Record<string, unknown>, lineItemIds: m.source_line_item_ids ?? [],
    });
  }
  const get = (key: string, pid: string) => map.get(`${key}|${pid}`);
  return {
    version, periods: cols, keys, get,
    series: (key) => cols.map((p) => ({ period: p.label, periodId: p.id, value: get(key, p.id)?.value ?? null })),
    latest: (key) => {
      for (let i = cols.length - 1; i >= 0; i--) {
        const cell = get(key, cols[i].id);
        if (cell) return { period: cols[i], cell };
      }
      return undefined;
    },
  };
}
