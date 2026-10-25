import { createClient } from "@/lib/supabase/server";
import { MetricCard } from "@/components/financial/metric-card";
import { ChartCard } from "@/components/charts/chart-card";
import { BarsChart, LinesChart } from "@/components/charts/charts";
import { EmptyState, Notice } from "@/components/ui/states";
import { PreliminaryBadge } from "@/components/ui/status-badge";
import { loadSnapshot } from "@/lib/financial/metrics-data";
import { METRICS } from "@/lib/financial/metric-definitions";
import { formatMetric } from "@/lib/financial/format-metric";
import { UNIT_LABEL } from "@/lib/utilities/format";

/** Company view of automated, unreviewed metrics. Internal analyst artefacts (flags, adjustments, valuations) are excluded by RLS. */
export async function CompanyAnalyticsTab({ submissionId, currency, unit, version }: { submissionId: string; currency: string; unit: string; version: number }) {
  if (!version) return <EmptyState title="Preliminary analytics are not available yet" description="Metrics appear after your documents have been processed." />;
  const supabase = await createClient();
  const snap = await loadSnapshot(supabase, submissionId, version);
  const { count: unreviewed } = await supabase.from("financial_line_items").select("id", { count: "exact", head: true }).eq("submission_id", submissionId).in("mapping_status", ["needs_review", "unmapped"]);
  const units = `${currency} ${UNIT_LABEL[unit] ?? ""}`;
  const card = (key: string) => {
    const l = snap.latest(key);
    return <MetricCard label={METRICS[key].label} value={l?.cell.value != null ? formatMetric(l.cell.value, METRICS[key].format, currency, unit) : null}
      sublabel={l?.period.label} status={l?.cell.status as never} unavailableReason={l?.cell.reason ?? "Not calculated from the available data."} />;
  };
  const rows = (keys: string[]) => snap.periods.map((p) => ({ period: p.label, ...Object.fromEntries(keys.map((k) => [k, snap.get(k, p.id)?.value ?? null])) }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><PreliminaryBadge /><span className="text-xs text-muted">Automated analysis v{version} · {units}</span></div>
      <Notice tone="warning" title="Preliminary — not a due diligence conclusion">
        These figures are calculated automatically from extracted data and have not been reviewed by an analyst.{unreviewed ? ` ${unreviewed} extracted value(s) are unmapped or awaiting review and are excluded.` : ""} Approved findings are provided only in published reports.
      </Notice>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {card("revenue")}{card("revenue_growth")}{card("gross_margin")}{card("ebitda")}{card("ebitda_margin")}{card("net_working_capital")}{card("operating_cash_flow")}{card("free_cash_flow")}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Revenue" subtitle={units} table={{ headers: ["Period", "Revenue"], rows: snap.series("revenue").map((r) => [r.period, formatMetric(r.value, "amount", currency, unit)]) }}>
          <BarsChart data={rows(["revenue"])} series={[{ key: "revenue", label: "Revenue" }]} currency={currency} unit={unit} />
        </ChartCard>
        <ChartCard title="Margins" subtitle="% of revenue" table={{ headers: ["Period", "Gross", "EBITDA"], rows: snap.periods.map((p) => [p.label, formatMetric(snap.get("gross_margin", p.id)?.value, "percent"), formatMetric(snap.get("ebitda_margin", p.id)?.value, "percent")]) }}>
          <LinesChart data={rows(["gross_margin", "ebitda_margin"])} series={[{ key: "gross_margin", label: "Gross margin" }, { key: "ebitda_margin", label: "EBITDA margin" }]} />
        </ChartCard>
      </div>
    </div>
  );
}
