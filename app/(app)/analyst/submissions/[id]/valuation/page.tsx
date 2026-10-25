import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { EmptyState, Notice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Input } from "@/components/ui/form-controls";
import { ChartCard } from "@/components/charts/chart-card";
import { ValuationRange } from "@/components/charts/charts";
import { DcfBuilder } from "@/components/valuation/dcf-builder";
import { ComparablesBuilder } from "@/components/valuation/comparables-builder";
import { loadAnalystSubmission } from "@/lib/database/submission-context";
import { loadSnapshot } from "@/lib/financial/metrics-data";
import { buildBridge, type Adjustment } from "@/lib/financial/ebitda";
import { valueDcf, type DcfInput, type DcfOutput } from "@/lib/valuation/dcf";
import { valueComparables, type ComparablesInput, type ComparablesOutput } from "@/lib/valuation/comparables";
import { ENGINE_VERSION } from "@/lib/valuation/common";
import { formatAmount, formatDateTime } from "@/lib/utilities/format";
import { reviewValuationModel } from "./actions";

function scenarioOf(method: string, outputs: unknown) {
  if (method === "dcf") return (outputs as DcfOutput).scenarios.enterpriseValue;
  return (outputs as ComparablesOutput).impliedEnterpriseValue;
}

/** Re-runs the engine on stored inputs and compares with stored outputs. */
function reproduce(method: string, inputs: unknown, outputs: unknown, engine: string): { ok: boolean; note: string } {
  if (engine !== ENGINE_VERSION) return { ok: false, note: `Saved with ${engine}; current engine is ${ENGINE_VERSION}.` };
  const fresh = method === "dcf" ? valueDcf(inputs as DcfInput).scenarios.enterpriseValue : valueComparables(inputs as ComparablesInput).impliedEnterpriseValue;
  const stored = scenarioOf(method, outputs);
  const same = (["low", "base", "high"] as const).every((k) => (fresh[k] === null && stored[k] === null) || Math.abs((fresh[k] ?? 0) - (stored[k] ?? 0)) < 1e-6);
  return same ? { ok: true, note: "Reproduced from stored inputs" } : { ok: false, note: "Stored outputs differ from a fresh calculation" };
}

export default async function ValuationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "models" } = await searchParams;
  const { sub, supabase, canWork, ctx } = await loadAnalystSubmission(id);
  const base = `/analyst/submissions/${id}/valuation`;
  const cur = sub.reporting_currency as string;
  const unit = sub.reporting_unit as string;
  const tabs = [{ key: "models", label: "Saved models & range", href: `${base}?tab=models` }, { key: "dcf", label: "Discounted cash flow", href: `${base}?tab=dcf` }, { key: "comparables", label: "Comparable companies", href: `${base}?tab=comparables` }];

  const snap = sub.current_analysis_version ? await loadSnapshot(supabase, id, sub.current_analysis_version) : null;
  const latest = (k: string) => snap?.latest(k)?.cell.value ?? null;
  const latestPeriod = snap?.periods.at(-1);
  let body: React.ReactNode;

  if (tab === "dcf") {
    const revenue = latest("revenue");
    if (!revenue || !latestPeriod) body = <EmptyState title="Base-year revenue is not available" description="The DCF needs at least revenue for the latest actual period." />;
    else {
      const ebitda = latest("ebitda"), ebit = latest("ebit"), capex = latest("capex"), twc = latest("trade_working_capital") ?? latest("net_working_capital");
      const growth = latest("revenue_cagr") ?? latest("revenue_growth") ?? 0.03;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const years = 5;
      const g = clamp(growth, -0.2, 0.3);
      const margin = ebitda !== null ? ebitda / revenue : 0.15;
      const da = ebitda !== null && ebit !== null ? clamp((ebitda - ebit) / revenue, 0, 0.5) : 0.03;
      const initial: DcfInput = {
        currency: cur, baseYearLabel: latestPeriod.label, baseRevenue: revenue, baseNetWorkingCapital: twc ?? 0, years,
        revenueGrowth: Array.from({ length: years }, (_, i) => +(g - (g - 0.03) * (i / (years - 1))).toFixed(4)),
        ebitdaMargin: Array(years).fill(+margin.toFixed(4)), daPctRevenue: Array(years).fill(+da.toFixed(4)),
        capexPctRevenue: Array(years).fill(+(capex !== null ? clamp(capex / revenue, 0, 0.8) : 0.03).toFixed(4)),
        nwcPctRevenue: Array(years).fill(+(twc !== null ? twc / revenue : 0.1).toFixed(4)),
        taxRate: 0.25, wacc: 0.1, terminalGrowth: 0.02, midYear: false, netDebt: latest("net_debt"), otherBridgeItems: [],
      };
      const provenance = [`base revenue ${latestPeriod.label}`, ebitda !== null ? "EBITDA margin from latest EBITDA" : "EBITDA margin default 15%",
        capex !== null ? "capex % from latest capex" : "capex default 3%", twc !== null ? "NWC from trade working capital" : "NWC default 10%",
        "growth fades linearly to 3%", "tax 25%, WACC 10% and terminal growth 2% are illustrative defaults to be replaced by the analyst"];
      body = <DcfBuilder submissionId={id} initial={initial} unit={unit} canWork={canWork} provenance={provenance} />;
    }
  } else if (tab === "comparables") {
    const { data: adj } = await supabase.from("ebitda_adjustments").select("*").eq("submission_id", id);
    const bridge = snap && latestPeriod ? buildBridge([{ id: latestPeriod.id, label: latestPeriod.label }], { [latestPeriod.id]: { value: latest("ebitda"), basis: null } }, (adj ?? []) as Adjustment[], cur) : [];
    const adjusted = bridge[0]?.approvedItems.length ? bridge[0].adjustedEbitda : null;
    const initial: ComparablesInput = {
      currency: cur, multiple: "ev_ebitda", targetMetricValue: adjusted ?? latest("ebitda"), targetMetricLabel: "EBITDA", netDebt: latest("net_debt"), otherBridgeItems: [],
      comparables: [{ name: "", revenue: null, ebitda: null, enterpriseValue: null, currency: cur, source: "", included: true }],
    };
    body = <ComparablesBuilder submissionId={id} initial={initial} unit={unit} canWork={canWork} targets={{ ebitda: latest("ebitda"), adjusted, revenue: latest("revenue") }} />;
  } else {
    const { data: models } = await supabase.from("valuation_models").select("*, author:profiles!valuation_models_created_by_fkey(full_name), reviewer:profiles!valuation_models_reviewed_by_fkey(full_name)")
      .eq("submission_id", id).order("created_at", { ascending: false });
    const latestByName = new Map<string, NonNullable<typeof models>[number]>();
    for (const m of models ?? []) if (!latestByName.has(m.model_name)) latestByName.set(m.model_name, m);
    const ranges = [...latestByName.values()].map((m) => ({ label: `${m.model_name} v${m.model_version}`, s: scenarioOf(m.valuation_method, m.calculation_outputs) }))
      .filter((r) => r.s.low !== null && r.s.base !== null && r.s.high !== null).map((r) => ({ label: r.label, low: r.s.low!, base: r.s.base!, high: r.s.high! }));
    body = (models ?? []).length === 0 ? <EmptyState title="No valuation models saved" description="Build a DCF or comparable-company model and save it as a version." /> : (
      <div className="space-y-6">
        {ranges.length ? <ChartCard title="Valuation range (enterprise value)" subtitle={`${cur} ${unit} · latest version of each model · low–high with base case`}
          table={{ headers: ["Model", "Low", "Base", "High"], rows: ranges.map((r) => [r.label, formatAmount(r.low, cur, unit), formatAmount(r.base, cur, unit), formatAmount(r.high, cur, unit)]) }}
          note="Analytical estimates, not guarantees of transaction price or investment return."><ValuationRange rows={ranges} currency={cur} unit={unit} /></ChartCard> : null}
        <Card>
          <CardHeader title="Model versions" description="Every save is an immutable version with its inputs, assumptions, outputs and engine version." />
          <ul className="divide-y divide-border">
            {(models ?? []).map((m) => {
              const s = scenarioOf(m.valuation_method, m.calculation_outputs);
              const rep = reproduce(m.valuation_method, m.calculation_inputs, m.calculation_outputs, m.engine_version);
              const mine = m.created_by === ctx.userId;
              return (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{m.model_name} <span className="text-muted">v{m.model_version} · {m.valuation_method === "dcf" ? "DCF" : "Comparables"}</span></p>
                    <p className="tabular">EV {formatAmount(s.low, cur, unit)} – {formatAmount(s.high, cur, unit)} · base {formatAmount(s.base, cur, unit)}</p>
                    <p className="text-xs text-muted">By {(m.author as { full_name: string | null } | null)?.full_name ?? "—"} · {formatDateTime(m.created_at)} · {m.engine_version}{m.analyst_comments ? ` · “${m.analyst_comments}”` : ""}</p>
                    {m.review_notes ? <p className="text-xs text-muted">Review: {m.review_notes} — {(m.reviewer as { full_name: string | null } | null)?.full_name}</p> : null}
                    <Badge tone={rep.ok ? "positive" : "warning"} className="mt-1">{rep.note}</Badge>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={m.review_status} />
                    {canWork && mine && m.review_status === "draft" ? (
                      <ActionForm action={reviewValuationModel}>{(p) => <><input type="hidden" name="modelId" value={m.id} /><input type="hidden" name="status" value="pending_review" /><SubmitButton pending={p} size="sm" variant="secondary">Submit for review</SubmitButton></>}</ActionForm>
                    ) : null}
                    {ctx.roles.includes("finance_reviewer") && !mine && ["draft", "pending_review"].includes(m.review_status) ? (
                      <ActionForm action={reviewValuationModel} className="flex items-center gap-1">{(p) => <>
                        <input type="hidden" name="modelId" value={m.id} />
                        <Input name="notes" placeholder="Notes" className="h-8 w-36" aria-label="Review notes" />
                        <button name="status" value="approved" disabled={p} className="rounded-md bg-accent px-2 py-1 text-xs text-white">Approve</button>
                        <button name="status" value="rejected" disabled={p} className="rounded-md border border-border px-2 py-1 text-xs">Reject</button></>}
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    );
  }
  return (
    <>
      <LinkTabs tabs={tabs} active={tab} />
      <div className="mb-4"><Notice>Valuations are analytical estimates based on stated assumptions. They are not guarantees of transaction price or investment return. Enterprise value and equity value are shown separately; the equity bridge uses net debt plus any explicit bridge items.</Notice></div>
      {body}
      {!snap ? <Card className="mt-4"><CardBody className="text-sm text-muted">No analysis available yet.</CardBody></Card> : null}
    </>
  );
}
