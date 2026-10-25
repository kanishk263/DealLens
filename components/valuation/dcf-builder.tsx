"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { Notice } from "@/components/ui/states";
import { MetricCard } from "@/components/financial/metric-card";
import { valueDcf, type DcfInput } from "@/lib/valuation/dcf";
import { formatAmount, formatPercent } from "@/lib/utilities/format";
import { saveValuationModel } from "@/app/(app)/analyst/submissions/[id]/valuation/actions";
import { SensitivityTable } from "./sensitivity-table";

type Row = "revenueGrowth" | "ebitdaMargin" | "daPctRevenue" | "capexPctRevenue" | "nwcPctRevenue";
const ROWS: [Row, string][] = [["revenueGrowth", "Revenue growth %"], ["ebitdaMargin", "EBITDA margin %"], ["daPctRevenue", "D&A % revenue"], ["capexPctRevenue", "Capex % revenue"], ["nwcPctRevenue", "NWC % revenue"]];

export function DcfBuilder({ submissionId, initial, unit, canWork, provenance }: { submissionId: string; initial: DcfInput; unit: string; canWork: boolean; provenance: string[] }) {
  const [input, setInput] = useState<DcfInput>(initial);
  const [name, setName] = useState("DCF — base case");
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const result = useMemo(() => valueDcf(input), [input]);
  const amt = (v: number | null | undefined) => formatAmount(v ?? null, input.currency, unit);

  function setYears(n: number) {
    const years = Math.max(1, Math.min(15, Math.round(n) || 1));
    const fit = (arr: number[]) => Array.from({ length: years }, (_, i) => arr[i] ?? arr[arr.length - 1] ?? 0);
    setInput((s) => ({ ...s, years, revenueGrowth: fit(s.revenueGrowth), ebitdaMargin: fit(s.ebitdaMargin), daPctRevenue: fit(s.daPctRevenue), capexPctRevenue: fit(s.capexPctRevenue), nwcPctRevenue: fit(s.nwcPctRevenue) }));
  }
  const setCell = (row: Row, i: number, pct: string) => setInput((s) => ({ ...s, [row]: s[row].map((v, j) => (j === i ? Number(pct) / 100 : v)) }));
  const pctField = (key: "taxRate" | "wacc" | "terminalGrowth", label: string, hint?: string) => (
    <Field label={label} htmlFor={key} hint={hint}><Input id={key} type="number" step="0.1" value={+(input[key] * 100).toFixed(4)} onChange={(e) => setInput((s) => ({ ...s, [key]: Number(e.target.value) / 100 }))} /></Field>
  );

  async function save() {
    setSaving(true);
    const res = await saveValuationModel({ method: "dcf", submissionId, modelName: name, comments, input });
    setSaving(false);
    if (res.ok) { toast.success(res.message ?? "Saved"); router.refresh(); } else toast.error(res.error);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Assumptions" description="UFCF = EBIT × (1 − tax) + D&A − Capex − ΔNWC. Terminal value: Gordon Growth on final-year UFCF." />
        <CardBody className="space-y-4">
          {provenance.length ? <Notice>Pre-filled from the latest analysis: {provenance.join("; ")}. Override as needed; every input is stored with the model.</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label={`Base revenue (${input.baseYearLabel})`} htmlFor="baseRevenue"><Input id="baseRevenue" type="number" value={input.baseRevenue} onChange={(e) => setInput((s) => ({ ...s, baseRevenue: Number(e.target.value) }))} /></Field>
            <Field label="Base NWC" htmlFor="baseNwc"><Input id="baseNwc" type="number" value={input.baseNetWorkingCapital} onChange={(e) => setInput((s) => ({ ...s, baseNetWorkingCapital: Number(e.target.value) }))} /></Field>
            <Field label="Forecast years" htmlFor="years"><Input id="years" type="number" min={1} max={15} value={input.years} onChange={(e) => setYears(Number(e.target.value))} /></Field>
            {pctField("wacc", "WACC %")}
            {pctField("terminalGrowth", "Terminal growth %", "Must be below WACC")}
            {pctField("taxRate", "Tax rate %")}
            <Field label="Net debt" htmlFor="netDebt" hint="Blank = unknown"><Input id="netDebt" type="number" value={input.netDebt ?? ""} onChange={(e) => setInput((s) => ({ ...s, netDebt: e.target.value === "" ? null : Number(e.target.value) }))} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={input.midYear} onChange={(e) => setInput((s) => ({ ...s, midYear: e.target.checked }))} />Mid-year convention</label>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead><tr><th className="pr-3 text-left text-xs text-muted">Per year (%)</th>{Array.from({ length: input.years }, (_, i) => <th key={i} className="px-1 text-xs text-muted">Y{i + 1}</th>)}</tr></thead>
              <tbody>
                {ROWS.map(([key, label]) => (
                  <tr key={key}>
                    <th scope="row" className="py-1 pr-3 text-left font-normal">{label}</th>
                    {input[key].map((v, i) => <td key={i} className="px-1 py-1"><Input aria-label={`${label} year ${i + 1}`} className="h-8 w-20 text-right" type="number" step="0.1" value={+(v * 100).toFixed(4)} onChange={(e) => setCell(key, i, e.target.value)} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      {result.errors.length ? <Notice tone="danger" title="Invalid assumptions">{result.errors.join(" ")}</Notice> : null}
      {result.warnings.length ? <Notice tone="warning" title="Warnings">{result.warnings.join(" ")}</Notice> : null}
      {result.valid ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Enterprise value (base)" value={amt(result.enterpriseValue)} sublabel={`WACC ${formatPercent(input.wacc)} · g ${formatPercent(input.terminalGrowth)}`} />
            <MetricCard label="PV of forecast UFCF" value={amt(result.sumPvForecast)} />
            <MetricCard label="PV of terminal value" value={amt(result.pvTerminalValue)} sublabel={`${formatPercent(result.terminalValueShare)} of EV`} />
            <MetricCard label="Net debt" value={input.netDebt === null ? null : amt(input.netDebt)} unavailableReason="Not provided" />
            <MetricCard label="Implied equity value" value={result.bridge?.equityValue == null ? null : amt(result.bridge.equityValue)} unavailableReason={result.bridge?.reason} formula="EV − net debt − other bridge items" />
          </div>
          <Card>
            <CardHeader title="Forecast" description={`${input.currency} ${unit} · ${input.midYear ? "mid-year" : "end-of-year"} discounting`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle text-xs text-muted"><tr><th className="px-3 py-2 text-left">Line</th>{result.years.map((y) => <th key={y.year} className="px-3 py-2 text-right">{y.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {([["Revenue", "revenue"], ["EBITDA", "ebitda"], ["D&A", "da"], ["EBIT", "ebit"], ["Taxes", "taxes"], ["NOPAT", "nopat"], ["Capex", "capex"], ["Change in NWC", "changeInNwc"], ["Unlevered FCF", "ufcf"], ["Discount factor", "discountFactor"], ["Present value", "presentValue"]] as const).map(([label, k]) => (
                    <tr key={k} className={k === "ufcf" ? "font-semibold" : ""}><th scope="row" className="px-3 py-1.5 text-left font-normal">{label}</th>
                      {result.years.map((y) => <td key={y.year} className="tabular px-3 py-1.5 text-right">{k === "discountFactor" ? y[k].toFixed(4) : formatAmount(y[k], undefined, unit)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><CardHeader title="Sensitivity" /><CardBody><SensitivityTable {...result.sensitivity} currency={input.currency} unit={unit} baseWacc={input.wacc} baseG={input.terminalGrowth} /></CardBody></Card>
            <Card><CardHeader title="Scenarios" description="Low: WACC +1pp, g −0.5pp · High: WACC −1pp, g +0.5pp" /><CardBody>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                {(["low", "base", "high"] as const).map((k) => <div key={k}><dt className="capitalize text-muted">{k}</dt><dd className="tabular font-semibold">{amt(result.scenarios.enterpriseValue[k])}</dd><dd className="text-xs text-muted">Equity {amt(result.scenarios.equityValue[k])}</dd></div>)}
              </dl>
              <p className="mt-3 text-xs text-muted">Analytical estimate only — not a guarantee of transaction price or investment return.</p>
            </CardBody></Card>
          </div>
        </>
      ) : null}
      {canWork ? (
        <Card><CardHeader title="Save as new model version" /><CardBody className="grid gap-3 sm:grid-cols-3">
          <Field label="Model name" htmlFor="dcfName"><Input id="dcfName" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Analyst comments" htmlFor="dcfComments" className="sm:col-span-2"><Textarea id="dcfComments" value={comments} onChange={(e) => setComments(e.target.value)} className="min-h-10" /></Field>
          <div><Button onClick={save} disabled={saving || !result.valid}>{saving ? "Saving…" : "Save version"}</Button></div>
        </CardBody></Card>
      ) : null}
    </div>
  );
}
