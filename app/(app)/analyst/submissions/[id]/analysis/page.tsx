import { Card, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { EmptyState, Notice } from "@/components/ui/states";
import { PreliminaryBadge } from "@/components/ui/status-badge";
import { MetricCard } from "@/components/financial/metric-card";
import { MetricTable } from "@/components/financial/metric-table";
import { ChartCard } from "@/components/charts/chart-card";
import { BarsChart, LinesChart, SeverityBars, Waterfall, type WaterfallStep } from "@/components/charts/charts";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { loadSnapshot, type FinancialSnapshot } from "@/lib/financial/metrics-data";
import { tableData } from "@/lib/financial/sources";
import { METRICS } from "@/lib/financial/metric-definitions";
import { formatMetric } from "@/lib/financial/format-metric";
import { buildBridge, type Adjustment } from "@/lib/financial/ebitda";
import { UNIT_LABEL } from "@/lib/utilities/format";
import { AdjustmentsPanel, type AdjustmentView } from "./adjustments-panel";

const TABS = [
  ["overview", "Overview"], ["revenue", "Revenue & growth"], ["profitability", "Profitability"], ["ebitda", "EBITDA adjustments"],
  ["working-capital", "Working capital"], ["debt", "Debt & leverage"], ["cash-flow", "Cash flow"],
] as const;

export default async function AnalysisStudio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const { sub, supabase, canWork, ctx } = await loadAnalystSubmission(id);
  const base = `/analyst/submissions/${id}/analysis`;
  const tabs = TABS.map(([key, label]) => ({ key, label, href: `${base}?tab=${key}` }));
  if (sub.current_analysis_version === 0) return <><LinkTabs tabs={tabs} active={tab} /><EmptyState title="No analysis yet" description="Metrics appear after documents are processed." /></>;

  const snap = await loadSnapshot(supabase, id, sub.current_analysis_version);
  const cur = sub.reporting_currency as string;
  const unit = sub.reporting_unit as string;
  const units = `${cur} ${UNIT_LABEL[unit] ?? ""}`.trim();
  const fmt = (key: string, v: number | null | undefined) => formatMetric(v, METRICS[key]?.format ?? "amount", cur, unit);
  const table = async (keys: string[]) => {
    const t = await tableData(supabase, snap, keys);
    return <MetricTable keys={t.keys} periods={snap.periods} cells={t.cells} sources={t.sources} currency={cur} unit={unit} />;
  };
  const rows = (keys: string[]) => snap.periods.map((p) => ({ period: p.label, ...Object.fromEntries(keys.map((k) => [k, snap.get(k, p.id)?.value ?? null])) }));
  const dataTable = (keys: string[]) => ({ headers: ["Period", ...keys.map((k) => METRICS[k]?.label ?? k)], rows: snap.periods.map((p) => [p.label, ...keys.map((k) => fmt(k, snap.get(k, p.id)?.value))]) });
  const card = (key: string, label?: string) => {
    const l = snap.latest(key);
    return <MetricCard label={label ?? METRICS[key]?.label ?? key} value={l?.cell.value != null ? fmt(key, l.cell.value) : null} status={l?.cell.status as never}
      sublabel={l ? `${l.period.label}${l.cell.inputs.basis ? ` · ${String(l.cell.inputs.basis)}` : ""}` : undefined}
      unavailableReason={l?.cell.reason ?? (l ? null : "Not calculated from the available data.")} formula={METRICS[key]?.formula} />;
  };

  const { data: adjRows } = await supabase.from("ebitda_adjustments").select("*, proposer:profiles!ebitda_adjustments_proposed_by_fkey(full_name), reviewer:profiles!ebitda_adjustments_reviewed_by_fkey(full_name)").eq("submission_id", id).order("created_at");
  const adjustments = (adjRows ?? []) as (Adjustment & Record<string, unknown>)[];
  const bridge = buildBridge(snap.periods, Object.fromEntries(snap.periods.map((p) => [p.id, { value: snap.get("ebitda", p.id)?.value ?? null, basis: (snap.get("ebitda", p.id)?.inputs.basis as string) ?? null }])), adjustments, cur);
  const latestBridge = [...bridge].reverse().find((b) => b.adjustedEbitda !== null);

  let body: React.ReactNode = null;
  if (tab === "overview") {
    const { data: flags } = await supabase.from("red_flags").select("severity").eq("submission_id", id).eq("is_active", true).neq("review_status", "dismissed");
    const sev = ["critical", "high", "medium", "low", "informational"].map((s) => ({ severity: s, count: (flags ?? []).filter((f) => f.severity === s).length })).filter((s) => s.count > 0);
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {card("revenue")}{card("revenue_growth")}{card("ebitda")}{card("ebitda_margin")}
          <MetricCard label="Adjusted EBITDA" value={latestBridge ? fmt("ebitda", latestBridge.adjustedEbitda) : null} sublabel={latestBridge ? `${latestBridge.periodLabel} · ${latestBridge.approvedItems.length} approved adjustment(s)` : undefined}
            unavailableReason="EBITDA is unavailable." formula="Reported/calculated EBITDA + approved adjustments" />
          {card("net_debt")}{card("net_debt_to_ebitda")}{card("net_working_capital")}{card("operating_cash_flow")}{card("free_cash_flow")}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Revenue" subtitle={`${units} · actual periods`} table={dataTable(["revenue"])}><BarsChart data={rows(["revenue"])} series={[{ key: "revenue", label: "Revenue" }]} currency={cur} unit={unit} /></ChartCard>
          <ChartCard title="Margins" subtitle="% of revenue" table={dataTable(["gross_margin", "ebitda_margin", "net_margin"])}>
            <LinesChart data={rows(["gross_margin", "ebitda_margin", "net_margin"])} series={[{ key: "gross_margin", label: "Gross margin" }, { key: "ebitda_margin", label: "EBITDA margin" }, { key: "net_margin", label: "Net margin" }]} />
          </ChartCard>
          <ChartCard title="Active red flags by severity" subtitle="Dismissed flags excluded" note="Red flags indicate matters requiring investigation, not evidence of misconduct.">
            {sev.length ? <SeverityBars counts={sev} /> : <p className="text-sm text-muted">No active red flags.</p>}
          </ChartCard>
          <ChartCard title="Cash flow" subtitle={units} table={dataTable(["operating_cash_flow", "capex", "free_cash_flow"])}>
            <BarsChart data={rows(["operating_cash_flow", "capex", "free_cash_flow"])} series={[{ key: "operating_cash_flow", label: "Operating cash flow" }, { key: "capex", label: "Capex" }, { key: "free_cash_flow", label: "Free cash flow" }]} currency={cur} unit={unit} />
          </ChartCard>
        </div>
      </div>
    );
  } else if (tab === "revenue") {
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">{card("revenue")}{card("revenue_growth")}{card("revenue_cagr")}</div>
        <ChartCard title="Revenue trend" subtitle={`${units} · growth is calculated only between comparable periods of the same length`} table={dataTable(["revenue", "revenue_growth"])}>
          <BarsChart data={rows(["revenue"])} series={[{ key: "revenue", label: "Revenue" }]} currency={cur} unit={unit} />
        </ChartCard>
        <Card><CardHeader title="Revenue metrics" />{await table(["revenue", "revenue_growth", "revenue_cagr", "revenue_vs_budget", "revenue_vs_forecast", "top_customer_share", "top5_customer_share"])}</Card>
        {!snap.keys.has("top_customer_share") ? <Notice>Customer concentration requires a revenue-by-customer schedule whose rows have been confirmed in the financial data review.</Notice> : null}
      </div>
    );
  } else if (tab === "profitability") {
    const last = snap.periods.at(-1);
    const v = (k: string) => (last ? snap.get(k, last.id)?.value ?? null : null);
    const steps: WaterfallStep[] = [];
    const revenue = v("revenue"), gp = v("gross_profit"), ebitda = v("ebitda"), ebit = v("ebit"), ni = v("net_income");
    if (revenue !== null && gp !== null && ebitda !== null && ebit !== null) {
      steps.push({ label: "Revenue", value: revenue, kind: "total" }, { label: "Cost of sales", value: revenue - gp, kind: "decrease" }, { label: "Gross profit", value: gp, kind: "total" },
        { label: "Operating costs", value: gp - ebitda, kind: gp >= ebitda ? "decrease" : "increase" }, { label: "EBITDA", value: ebitda, kind: "total" },
        { label: "D&A", value: ebitda - ebit, kind: "decrease" }, { label: "EBIT", value: ebit, kind: "total" });
      if (ni !== null) steps.push({ label: "Interest & tax", value: ebit - ni, kind: ebit >= ni ? "decrease" : "increase" }, { label: "Net income", value: ni, kind: "total" });
    }
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">{card("gross_margin")}{card("ebitda_margin")}{card("ebit_margin")}{card("net_margin")}</div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title={`Profitability waterfall · ${last?.label ?? ""}`} subtitle={units} note={steps.length ? "Operating costs are derived as gross profit − EBITDA (the bridge closes by construction); see the table for line-level detail." : undefined}>
            {steps.length ? <Waterfall steps={steps} currency={cur} unit={unit} /> : <p className="text-sm text-muted">Needs revenue, gross profit, EBITDA and EBIT for the latest period.</p>}
          </ChartCard>
          <ChartCard title="EBITDA" subtitle={`${units} · margin shown in the adjacent chart (no dual axes)`} table={dataTable(["ebitda", "ebitda_margin"])}>
            <BarsChart data={rows(["ebitda"])} series={[{ key: "ebitda", label: "EBITDA" }]} currency={cur} unit={unit} />
          </ChartCard>
          <ChartCard title="Margin comparison" subtitle="% of revenue" className="lg:col-span-2" table={dataTable(["gross_margin", "ebitda_margin", "ebit_margin", "net_margin"])}>
            <LinesChart data={rows(["gross_margin", "ebitda_margin", "ebit_margin", "net_margin"])} series={[{ key: "gross_margin", label: "Gross" }, { key: "ebitda_margin", label: "EBITDA" }, { key: "ebit_margin", label: "EBIT" }, { key: "net_margin", label: "Net" }]} />
          </ChartCard>
        </div>
        <Card><CardHeader title="Profitability metrics" description="Reported and calculated EBITDA are shown separately; the headline EBITDA states its basis." />
          {await table(["gross_profit", "gross_profit_calculated", "gross_margin", "gross_margin_change", "ebitda_reported", "ebitda_calculated", "ebitda", "ebitda_margin", "ebitda_margin_change", "ebitda_growth", "ebit", "ebit_margin", "net_income", "net_margin", "net_income_growth", "interest_coverage"])}
        </Card>
      </div>
    );
  } else if (tab === "ebitda") {
    body = <AdjustmentsPanel submissionId={id} canWork={canWork} currentUserId={ctx.userId} currency={cur} unit={unit}
      periods={snap.periods.map((p) => ({ id: p.id, label: p.label }))} bridge={bridge}
      adjustments={adjustments.map((a) => ({ ...(a as unknown as AdjustmentView), proposer: (a.proposer as { full_name: string | null } | null)?.full_name ?? null, reviewerName: (a.reviewer as { full_name: string | null } | null)?.full_name ?? null }))} />;
  } else if (tab === "working-capital") {
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">{card("net_working_capital")}{card("trade_working_capital")}{card("dso")}{card("cash_conversion_cycle")}</div>
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Working-capital days" subtitle="Days · average balances where a prior period exists" table={dataTable(["dso", "dio", "dpo", "cash_conversion_cycle"])}>
            <LinesChart format="days" data={rows(["dso", "dio", "dpo"])} series={[{ key: "dso", label: "DSO" }, { key: "dio", label: "DIO" }, { key: "dpo", label: "DPO" }]} />
          </ChartCard>
          <ChartCard title="Working capital" subtitle={units} table={dataTable(["net_working_capital", "trade_working_capital"])}>
            <BarsChart data={rows(["net_working_capital", "trade_working_capital"])} series={[{ key: "net_working_capital", label: "Net working capital" }, { key: "trade_working_capital", label: "Trade working capital" }]} currency={cur} unit={unit} />
          </ChartCard>
        </div>
        <Notice>Net working capital is the accounting measure (current assets − current liabilities). Operating working capital excludes cash and short-term debt. Trade working capital uses receivables, inventory and payables only.</Notice>
        <Card><CardHeader title="Working-capital metrics" />{await table(["net_working_capital", "operating_working_capital", "trade_working_capital", "dso", "dio", "dpo", "cash_conversion_cycle"])}</Card>
      </div>
    );
  } else if (tab === "debt") {
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">{card("gross_debt")}{card("net_debt")}{card("net_debt_to_ebitda")}{card("interest_coverage")}</div>
        <ChartCard title="Debt and net debt" subtitle={`${units} · borrowings only; leases and other liabilities are not assumed to be debt`} table={dataTable(["gross_debt", "cash", "net_debt"])}>
          <BarsChart data={rows(["gross_debt", "cash", "net_debt"])} series={[{ key: "gross_debt", label: "Gross debt" }, { key: "cash", label: "Cash" }, { key: "net_debt", label: "Net debt" }]} currency={cur} unit={unit} />
        </ChartCard>
        <Card><CardHeader title="Leverage" description="Leverage multiples are not calculated when EBITDA is zero, negative, missing or not annual." />{await table(["gross_debt", "cash", "net_debt", "debt_to_ebitda", "net_debt_to_ebitda", "interest_coverage"])}</Card>
      </div>
    );
  } else if (tab === "cash-flow") {
    body = (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">{card("operating_cash_flow")}{card("capex")}{card("free_cash_flow")}{card("ocf_to_ebitda")}</div>
        <ChartCard title="Cash flows" subtitle={units} table={dataTable(["operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "free_cash_flow"])}>
          <BarsChart data={rows(["operating_cash_flow", "investing_cash_flow", "financing_cash_flow"])} series={[{ key: "operating_cash_flow", label: "Operating" }, { key: "investing_cash_flow", label: "Investing" }, { key: "financing_cash_flow", label: "Financing" }]} currency={cur} unit={unit} />
        </ChartCard>
        <ChartCard title="Cash conversion" subtitle="% of EBITDA" table={dataTable(["ocf_to_ebitda", "fcf_conversion"])}>
          <LinesChart data={rows(["ocf_to_ebitda", "fcf_conversion"])} series={[{ key: "ocf_to_ebitda", label: "OCF / EBITDA" }, { key: "fcf_conversion", label: "FCF / EBITDA" }]} />
        </ChartCard>
        <Notice>Free cash flow is defined here as operating cash flow less capital expenditure. Other definitions (e.g. after lease payments or interest) exist and may be more appropriate for a specific transaction.</Notice>
        <Card><CardHeader title="Cash-flow metrics" />{await table(["operating_cash_flow", "investing_cash_flow", "financing_cash_flow", "capex", "free_cash_flow", "ocf_to_ebitda", "fcf_conversion"])}</Card>
      </div>
    );
  }
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted"><PreliminaryBadge /><span>Analysis v{snap.version} · formula version v1 · {units}</span></div>
      <LinkTabs tabs={tabs} active={tab} />
      {snap.periods.length === 0 ? <EmptyState title="No actual periods identified" /> : body}
    </>
  );
}

export type { FinancialSnapshot };
